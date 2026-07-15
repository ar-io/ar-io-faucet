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
import rateLimit from 'koa-ratelimit';
import Router from 'koa-router';
import * as config from './config.js';
import { BadRequestError } from './errors.js';
import { SolanaTokenFaucet } from './faucet/solana-token-faucet.js';
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

	// bind the target tokenId (processId) into the state value
	const state = stateStore.generateState(processId);
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
	const processId = stateStore.consume(state);
	if (!processId) {
		throw new BadRequestError('Invalid or expired OAuth state');
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

	// 5. per-githubId anti-sybil (enforced again at claim time)
	if (githubClaimStore.has(user.id)) {
		ctx.status = 429;
		ctx.body = {
			error: 'Already claimed for this GitHub account this window',
		};
		return;
	}

	// 6. issue the GitHub-bound claim-capable JWT
	const token = await faucet.requestAuthTokenForGithub({
		githubId: user.id,
		githubLogin: user.login,
		githubAccountCreatedAt: user.created_at,
	});

	// 7. respond. If a self-hosted frontend is enabled, redirect back with the
	// token in the URL fragment; otherwise return JSON for API clients.
	if (config.ENABLE_SELF_HOSTED_FRONTEND) {
		ctx.redirect(
			`${config.FRONT_END_URL}/#token=${encodeURIComponent(
				token.token,
			)}&expiresAt=${token.expiresAt}&process-id=${encodeURIComponent(
				processId,
			)}`,
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
	const authorization = ctx.request.headers.authorization;
	if (!authorization) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}

	const authToken = authorization.split(' ')[1];

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

	await performClaim(ctx, faucet, payload, { recipient, qty });
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
		// require the GitHub-bound JWT in addition to hCaptcha
		const authorization = ctx.request.headers.authorization;
		if (!authorization) {
			ctx.status = 401;
			ctx.body = { error: 'Unauthorized' };
			return;
		}
		const authToken = authorization.split(' ')[1];
		const verified = await verifyAuthTokenSafe(faucet, authToken);
		if (!verified.valid || !verified.payload) {
			ctx.status = 401;
			ctx.body = { error: 'Invalid token' };
			return;
		}
		payload = verified.payload;
	}

	await performClaim(ctx, faucet, payload, { recipient, qty });
});

export default router;

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

// shared claim execution: enforce per-githubId anti-sybil (when a github-bound
// payload is present), run the transfer, then burn the token nonce so the same
// JWT cannot be replayed.
async function performClaim(
	// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
	ctx: any,
	faucet: TokenFaucet,
	payload: TokenPayload | undefined,
	{ recipient, qty }: { recipient: string; qty: number },
): Promise<void> {
	const githubId = payload?.githubId;

	// per-githubId anti-sybil: one claim per GitHub id per rate-limit window
	if (githubId !== undefined && githubClaimStore.has(githubId)) {
		ctx.status = 429;
		ctx.body = {
			error: 'Already claimed for this GitHub account this window',
		};
		return;
	}

	const { id, status } = await faucet.claim({
		recipient,
		qty,
		githubId,
	});

	// record anti-sybil + burn the token nonce on success
	if (githubId !== undefined) {
		githubClaimStore.record(githubId);
	}
	if (payload) {
		await (faucet as SolanaTokenFaucet).consumeNonce(payload);
	}

	ctx.body = { id, status };
}
