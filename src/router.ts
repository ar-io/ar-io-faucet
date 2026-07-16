/**
 * AR.IO Gateway
 * Copyright (C) 2022-2023 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
import crypto from 'node:crypto';
import rateLimit from 'koa-ratelimit';
import Router from 'koa-router';
import { performClaim } from './claim.js';
import * as config from './config.js';
import { BadRequestError } from './errors.js';
import {
	captcha,
	githubClaimStore,
	githubOAuth,
	stateStore,
	supportedProcesses,
} from './system.js';
import {
	AsyncClaimRequestSchema,
	CaptchaRequestSchema,
	ClaimRequestSchema,
	type TokenFaucet,
	type TokenPayload,
} from './types.js';

const router = new Router();

// health check endpoint
router.get('/healthcheck', async (ctx) => {
	ctx.body = { status: 'ok' };
});

// route to request auth URL for satisfying captcha
router.get('/api/captcha/url', async (ctx) => {
	const { 'process-id': processId } = ctx.query as {
		'process-id': string;
	};

	if (!processId) {
		throw new BadRequestError('Process ID is required');
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	// return the URL and temporary token
	ctx.body = {
		processId,
		captchaUrl: `${config.FRONT_END_URL}/captcha?process-id=${processId}`,
	};
});

router.get('/captcha', async (ctx) => {
	const { 'process-id': processId } = ctx.query as {
		'process-id': string;
	};

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	// render the captcha page with the token
	await ctx.render('captcha', {
		captchaSiteKey: config.CAPTCHA_SITE_KEY,
		processId,
	});
});

// verify a captcha response and return an auth token good for 1 hour
router.post(
	'/api/captcha/verify',
	rateLimit({
		driver: 'memory',
		db: new Map(),
		duration: config.CAPTCHA_RATE_LIMIT_WINDOW_SECONDS * 1000,
		max: config.CAPTCHA_RATE_LIMIT_THRESHOLD, // 1 request per window
		disableHeader: false,
	}),
	async (ctx) => {
		const parsedCaptchaRequest = CaptchaRequestSchema.safeParse(
			ctx.request.body,
		);
		if (!parsedCaptchaRequest.success) {
			ctx.status = 400;
			ctx.body = { error: parsedCaptchaRequest.error.message };
			return;
		}

		const { processId, captchaResponse } = parsedCaptchaRequest.data;

		const faucet = supportedProcesses.get(processId);
		if (!faucet) {
			throw new BadRequestError('Process not supported.');
		}

		if (config.REQUIRE_CAPTCHA_VERIFICATION && captcha) {
			const captchaResult = await captcha.verifyCaptchaResponse({
				captchaResponse,
				remoteip: ctx.ip,
			});

			if (!captchaResult) {
				throw new BadRequestError('Captcha verification failed');
			}
		}

		// A captcha-only token is NOT claim-capable when the GitHub gate is
		// enabled: it carries no githubId, so verifyAuthToken() reports it as
		// invalid for claiming. Claim-capable tokens are only issued by the
		// GitHub OAuth callback below.
		const token = await faucet.requestAuthToken();
		ctx.body = {
			status: 'success',
			token: token.token,
			expiresAt: token.expiresAt,
		};
	},
);

// verify an existing auth token
router.get('/api/token/verify', async (ctx) => {
	const authorization = ctx.request.headers.authorization;
	if (!authorization) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}

	const authToken = authorization.split(' ')[1];

	const { 'process-id': processId } = ctx.query as {
		'process-id': string;
	};

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	const { valid, payload } = await verifyAuthTokenSafe(faucet, authToken);
	ctx.body = { valid, expiresAt: payload?.exp };
});

// begin the GitHub OAuth flow: generate CSRF state (bound to the tokenId) and
// redirect to GitHub's authorize URL.
router.get('/api/auth/github/login', async (ctx) => {
	if (!config.GITHUB_OAUTH_ENABLED || !githubOAuth) {
		throw new BadRequestError('GitHub OAuth is not enabled');
	}

	const { 'process-id': processId } = ctx.query as {
		'process-id': string;
	};

	if (!processId) {
		throw new BadRequestError('Process ID is required');
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	// establish (or reuse) an initiating browser session id. It is set as an
	// HttpOnly cookie and bound into the OAuth state so the claim token issued at
	// the callback can be bound to THIS session.
	const sid = getOrCreateSessionId(ctx);

	// bind the target tokenId (processId) + session id into the state value
	const state = stateStore.generateState({ processId, sid });
	ctx.redirect(githubOAuth.buildAuthorizeUrl(state));
});

// GitHub OAuth callback: validate state, exchange code, enforce account age +
// per-github anti-sybil, then issue a GitHub-bound claim-capable JWT.
router.get('/api/auth/github/callback', async (ctx) => {
	if (!config.GITHUB_OAUTH_ENABLED || !githubOAuth) {
		throw new BadRequestError('GitHub OAuth is not enabled');
	}

	const { code, state } = ctx.query as { code?: string; state?: string };

	if (!code || !state) {
		throw new BadRequestError('Missing code or state');
	}

	// 1. one-time state consume (CSRF/replay protection)
	const stateValue = stateStore.consume(state);
	if (!stateValue) {
		throw new BadRequestError('Invalid or expired OAuth state');
	}
	const { processId, sid: stateSid } = stateValue;

	// bind the flow to the initiating browser session: the session cookie set at
	// login must still match the sid embedded in the state.
	const cookieSid = ctx.cookies.get(config.SESSION_COOKIE);
	if (!cookieSid || cookieSid !== stateSid) {
		throw new BadRequestError('Session mismatch for OAuth callback');
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	// 2. exchange the code for an access token
	const accessToken = await githubOAuth.exchangeCode(code);

	// 3. fetch the user profile
	const user = await githubOAuth.fetchUser(accessToken);

	// 4. account-age gate
	githubOAuth.assertAccountOldEnough(user.created_at);

	// 5. per-githubId anti-sybil. RESERVE the slot atomically (set-if-absent) so
	// two concurrent callbacks for the same GitHub account can't both mint a
	// claim-capable token. This is the identity-gate reservation; the claim path
	// additionally burns the per-JWT nonce. Roll back only if token issuance
	// below fails.
	if (!githubClaimStore.reserve(user.id)) {
		ctx.status = 429;
		ctx.body = {
			error: 'Already claimed for this GitHub account this window',
		};
		return;
	}

	// 6. issue the GitHub-bound claim-capable JWT, bound to the initiating session
	let token: { token: string; expiresAt: number };
	try {
		token = await faucet.requestAuthTokenForGithub({
			githubId: user.id,
			githubLogin: user.login,
			githubAccountCreatedAt: user.created_at,
			sid: stateSid,
		});
	} catch (error) {
		// token issuance failed (e.g. insufficient faucet balance) — release the
		// reservation so the user can retry.
		githubClaimStore.release(user.id);
		throw error;
	}

	// 7. respond. If a self-hosted frontend is enabled, deliver the claim token
	// via an HttpOnly + Secure + SameSite=Lax cookie scoped to /api (NOT the URL
	// fragment) so it never leaks through history / Referer / logs, then redirect
	// back to the frontend without any secret in the URL. Otherwise return JSON
	// for API clients (which manage the token themselves).
	if (config.ENABLE_SELF_HOSTED_FRONTEND) {
		setClaimTokenCookie(ctx, token.token, token.expiresAt);
		ctx.redirect(
			`${config.FRONT_END_URL}/?process-id=${encodeURIComponent(
				processId,
			)}&github=1&gh_user=${encodeURIComponent(user.login)}`,
		);
		return;
	}

	ctx.body = {
		status: 'success',
		token: token.token,
		expiresAt: token.expiresAt,
	};
});

// claim tokens to a recipient using an authorization token
router.post('/api/claim/async', async (ctx) => {
	// accept the claim token from the HttpOnly cookie (browser flow) or the
	// Authorization header (API clients).
	const authToken = getClaimToken(ctx);
	if (!authToken) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}

	// parse the request body
	const claimRequest = AsyncClaimRequestSchema.safeParse(ctx.request.body);
	if (!claimRequest.success) {
		throw new BadRequestError(claimRequest.error.message);
	}

	const { recipient, qty, processId } = claimRequest.data;
	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	const { valid, payload } = await verifyAuthTokenSafe(faucet, authToken);
	if (!valid || !payload) {
		ctx.status = 401;
		ctx.body = { error: 'Invalid token' };
		return;
	}

	if (!sessionBindingOk(ctx, payload)) {
		ctx.status = 401;
		ctx.body = { error: 'Session mismatch for claim token' };
		return;
	}

	await performClaim(
		ctx,
		faucet,
		payload,
		{ recipient, qty },
		githubClaimStore,
	);
});

// claim tokens to a recipient using a captcha response. When the GitHub gate is
// enabled, this path ALSO requires the GitHub-bound JWT (in addition to
// hCaptcha) so it cannot be used to bypass the identity gate.
router.post('/api/claim/sync', async (ctx) => {
	const claimRequest = ClaimRequestSchema.safeParse(ctx.request.body);
	if (!claimRequest.success) {
		throw new BadRequestError(claimRequest.error.message);
	}

	const { recipient, qty, processId, captchaResponse } = claimRequest.data;

	if (config.REQUIRE_CAPTCHA_VERIFICATION && captcha) {
		if (!captchaResponse) {
			throw new BadRequestError('Captcha response is required');
		}
		const captchaResult = await captcha.verifyCaptchaResponse({
			captchaResponse,
			remoteip: ctx.ip,
		});
		if (!captchaResult) {
			throw new BadRequestError('Captcha verification failed');
		}
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	let payload: TokenPayload | undefined;

	if (config.GITHUB_OAUTH_ENABLED) {
		// require the GitHub-bound JWT in addition to hCaptcha. The token comes
		// from the HttpOnly cookie (browser flow) or Authorization header (API).
		const authToken = getClaimToken(ctx);
		if (!authToken) {
			ctx.status = 401;
			ctx.body = { error: 'Unauthorized' };
			return;
		}
		const verified = await verifyAuthTokenSafe(faucet, authToken);
		if (!verified.valid || !verified.payload) {
			ctx.status = 401;
			ctx.body = { error: 'Invalid token' };
			return;
		}
		if (!sessionBindingOk(ctx, verified.payload)) {
			ctx.status = 401;
			ctx.body = { error: 'Session mismatch for claim token' };
			return;
		}
		payload = verified.payload;
	}

	await performClaim(
		ctx,
		faucet,
		payload,
		{ recipient, qty },
		githubClaimStore,
	);
});

export default router;

// Read the claim JWT: prefer the HttpOnly cookie set by the OAuth callback
// (browser flow), fall back to the Authorization: Bearer header (API clients).
// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
function getClaimToken(ctx: any): string | undefined {
	const cookieToken = ctx.cookies.get(config.CLAIM_TOKEN_COOKIE);
	if (cookieToken) {
		return cookieToken;
	}
	const authorization = ctx.request.headers.authorization;
	return authorization ? authorization.split(' ')[1] : undefined;
}

// Enforce the session binding: if the JWT carries a `sid` (browser-issued
// tokens do), the request must present a matching `faucet_sid` cookie. Tokens
// without a `sid` (pure API clients) are exempt so header-based automation keeps
// working.
// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
function sessionBindingOk(ctx: any, payload: TokenPayload): boolean {
	if (!payload.sid) {
		return true;
	}
	return ctx.cookies.get(config.SESSION_COOKIE) === payload.sid;
}

// Get the initiating session id from the `faucet_sid` cookie, minting one (and
// setting the cookie) if absent. HttpOnly + SameSite=Lax so it survives the
// OAuth redirect round-trip but isn't script-readable.
// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
function getOrCreateSessionId(ctx: any): string {
	const existing = ctx.cookies.get(config.SESSION_COOKIE);
	if (existing) {
		return existing;
	}
	const sid = crypto.randomUUID();
	ctx.cookies.set(config.SESSION_COOKIE, sid, {
		httpOnly: true,
		secure: config.COOKIE_SECURE,
		sameSite: config.COOKIE_SAMESITE,
		path: '/',
		maxAge: config.GITHUB_OAUTH_STATE_TTL_SECONDS * 1000,
	});
	return sid;
}

// Deliver the claim JWT to the browser via an HttpOnly + Secure + SameSite=Lax
// cookie scoped to /api. Lifetime is minimized to the token's own expiry.
// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
function setClaimTokenCookie(ctx: any, token: string, expiresAt: number): void {
	// expiresAt is in seconds (JWT exp); convert to a ms-from-now maxAge.
	const maxAge = Math.max(0, expiresAt * 1000 - Date.now());
	ctx.cookies.set(config.CLAIM_TOKEN_COOKIE, token, {
		httpOnly: true,
		secure: config.COOKIE_SECURE,
		sameSite: config.COOKIE_SAMESITE,
		path: '/api',
		maxAge,
	});
}

// verify a token without throwing (JWT verify throws on invalid tokens); an
// invalid/expired token should surface as valid=false, not a 503.
async function verifyAuthTokenSafe(
	faucet: TokenFaucet,
	token: string,
): Promise<{ valid: boolean; payload?: TokenPayload }> {
	try {
		return await faucet.verifyAuthToken({ token });
	} catch {
		return { valid: false };
	}
}
