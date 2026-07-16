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
import fs from 'node:fs';

// server config
export const PORT = +(process.env.PORT || 3000);

// token config
export const DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS = +(
	(process.env.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS || 3600) // 1 hour
);
// DEPRECATED / unused. The nonce cache is no longer bounded by a max key count:
// a bounded NodeCache THROWS on the overflowing set(), which could leave a
// consumed nonce unrecorded after a successful transfer and enable replay.
// In-flight nonces are naturally bounded by the token TTL instead. Retained only
// to avoid breaking any deployment that still sets this env var.
export const DEFAULT_FAUCET_TOKEN_CACHE_SIZE = +(
	(process.env.DEFAULT_FAUCET_TOKEN_CACHE_SIZE || 100) // 100 tokens
);
export const DEFAULT_FAUCET_TOKEN_TRANSFER_QTY = +(
	(process.env.DEFAULT_FAUCET_TOKEN_TRANSFER_QTY || 2_500_000_000) // 2.5k ARIO
);
export const DEFAULT_MIN_FAUCET_TOKEN_TRANSFER_QTY = +(
	(process.env.DEFAULT_MIN_FAUCET_TOKEN_TRANSFER_QTY || 10_000_000) // 10 ARIO
);
export const DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY = +(
	(process.env.DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY || 2_500_000_000) // 2.5k ARIO
);

// frontend config
export const ENABLE_SELF_HOSTED_FRONTEND =
	process.env.ENABLE_SELF_HOSTED_FRONTEND !== 'false';
export const FRONT_END_URL =
	process.env.FRONT_END_URL || `http://localhost:${PORT}`;

// Browser origins allowed to call the API with credentials (cookies). Needed
// when the frontend (e.g. faucet.ar.io) is a separate origin from this backend
// (e.g. faucet.services.ar-io.dev). Comma-separated; defaults to FRONT_END_URL.
export const CORS_ALLOWED_ORIGINS = (
	process.env.CORS_ALLOWED_ORIGINS || FRONT_END_URL
)
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);

// wallet config
export const WALLET_FILE = process.env.WALLET_FILE;
export const WALLET = WALLET_FILE
	? fs.readFileSync(WALLET_FILE, 'utf8')
	: process.env.WALLET;

// solana config
export const SOLANA_RPC_URL =
	process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';
export const SOLANA_TOKEN_MINT = process.env.SOLANA_TOKEN_MINT;
export const SOLANA_FAUCET_SECRET_KEY_FILE =
	process.env.SOLANA_FAUCET_SECRET_KEY_FILE;
export const SOLANA_FAUCET_SECRET_KEY = SOLANA_FAUCET_SECRET_KEY_FILE
	? fs.readFileSync(SOLANA_FAUCET_SECRET_KEY_FILE, 'utf8').trim()
	: process.env.SOLANA_FAUCET_SECRET_KEY;
export const SOLANA_TOKEN_ID = process.env.SOLANA_TOKEN_ID || 'solana-devnet';
export const SOLANA_TOKEN_DECIMALS = process.env.SOLANA_TOKEN_DECIMALS
	? +process.env.SOLANA_TOKEN_DECIMALS
	: undefined;
export const SOLANA_COMMITMENT = process.env.SOLANA_COMMITMENT || 'confirmed';

// Optional Slack Incoming Webhook for claim + low-balance notifications. When
// unset, Slack notifications are disabled. Treat the URL as a secret.
export const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

// Optional low-balance alert threshold in BASE units (scaled by token decimals).
// When set, a Slack alert fires after a claim if the faucet's remaining token
// balance falls below it. Requires SLACK_WEBHOOK_URL.
export const SLACK_LOW_BALANCE_THRESHOLD = process.env
	.SLACK_LOW_BALANCE_THRESHOLD
	? +process.env.SLACK_LOW_BALANCE_THRESHOLD
	: undefined;

// auth token signing config (HS256 service JWT)
export const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET;

// Explicit dev profile. Must be opted into (DEV_PROFILE=true) to silence the
// startup refusal when the GitHub OAuth anti-sybil gate is disabled. Never set
// this in production.
export const DEV_PROFILE = process.env.DEV_PROFILE === 'true';

// github oauth config
export const GITHUB_OAUTH_ENABLED =
	process.env.GITHUB_OAUTH_ENABLED !== 'false';
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
export const GITHUB_OAUTH_CALLBACK_URL = process.env.GITHUB_OAUTH_CALLBACK_URL;
export const GITHUB_MIN_ACCOUNT_AGE_DAYS = +(
	process.env.GITHUB_MIN_ACCOUNT_AGE_DAYS || 30
);
export const GITHUB_OAUTH_STATE_TTL_SECONDS = +(
	process.env.GITHUB_OAUTH_STATE_TTL_SECONDS || 600
);
export const GITHUB_API_BASE_URL =
	process.env.GITHUB_API_BASE_URL || 'https://api.github.com';
export const GITHUB_OAUTH_AUTHORIZE_URL =
	process.env.GITHUB_OAUTH_AUTHORIZE_URL ||
	'https://github.com/login/oauth/authorize';
export const GITHUB_OAUTH_TOKEN_URL =
	process.env.GITHUB_OAUTH_TOKEN_URL ||
	'https://github.com/login/oauth/access_token';

// session / cookie config for the browser claim flow. The claim JWT is
// delivered to the browser via an HttpOnly cookie (not a URL fragment) so it
// does not leak through history / Referer / logs, and is bound to the session
// that initiated the OAuth flow.
export const CLAIM_TOKEN_COOKIE = 'faucet_claim_token';
export const SESSION_COOKIE = 'faucet_sid';
// Secure flag on cookies. Defaults on; set COOKIE_SECURE=false only for local
// plain-HTTP development.
export const COOKIE_SECURE = process.env.COOKIE_SECURE !== 'false';
// SameSite policy for the session + claim-token cookies. Default 'lax' (safe for
// a same-origin / same-site frontend). Set to 'none' when the frontend is a
// DIFFERENT site from this backend (e.g. frontend faucet.ar.io, backend
// faucet.services.ar-io.dev — different registrable domains), so the credentialed
// cross-site fetch actually sends the cookie. 'none' REQUIRES COOKIE_SECURE=true.
const _sameSite = (process.env.COOKIE_SAMESITE || 'lax').toLowerCase();
export const COOKIE_SAMESITE: 'lax' | 'strict' | 'none' =
	_sameSite === 'none' || _sameSite === 'strict' ? _sameSite : 'lax';

// proxy trust. Koa only honours X-Forwarded-For when app.proxy is true. Enable
// this ONLY when the faucet sits behind a known, trusted reverse proxy that sets
// the header, otherwise clients can spoof their source IP and bypass rate limits.
export const TRUST_PROXY = process.env.TRUST_PROXY === 'true';

// logging config
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_FORMAT = process.env.LOG_FORMAT || 'json';

// rate limiting config
export const GLOBAL_RATE_LIMIT_WINDOW_SECONDS = +(
	(process.env.GLOBAL_RATE_LIMIT_WINDOW_SECONDS || 28800) // 8 hours
);
export const GLOBAL_RATE_LIMIT_THRESHOLD = +(
	process.env.GLOBAL_RATE_LIMIT_THRESHOLD || 10
); // 10 requests per 1 hour
export const CAPTCHA_RATE_LIMIT_WINDOW_SECONDS = +(
	process.env.CAPTCHA_RATE_LIMIT_WINDOW_SECONDS || 3600
); // 1 hour
export const CAPTCHA_RATE_LIMIT_THRESHOLD = +(
	process.env.CAPTCHA_RATE_LIMIT_THRESHOLD || 1
); // 1 requests per 1 hour

// captcha config
export const REQUIRE_CAPTCHA_VERIFICATION =
	process.env.REQUIRE_CAPTCHA_VERIFICATION !== 'false';
export const CAPTCHA_SITE_VERIFY_URL = process.env.CAPTCHA_SITE_VERIFY_URL;
export const CAPTCHA_SITE_KEY = process.env.CAPTCHA_SITE_KEY;
export const CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY;

// startup validation for required Solana + GitHub vars
export function assertRequiredConfig(): void {
	const missing: string[] = [];

	if (!SOLANA_TOKEN_MINT) {
		missing.push('SOLANA_TOKEN_MINT');
	}
	if (!SOLANA_FAUCET_SECRET_KEY) {
		missing.push('SOLANA_FAUCET_SECRET_KEY (or SOLANA_FAUCET_SECRET_KEY_FILE)');
	}
	if (!AUTH_TOKEN_SECRET) {
		missing.push('AUTH_TOKEN_SECRET');
	}
	if (GITHUB_OAUTH_ENABLED) {
		if (!GITHUB_CLIENT_ID) {
			missing.push('GITHUB_CLIENT_ID');
		}
		if (!GITHUB_CLIENT_SECRET) {
			missing.push('GITHUB_CLIENT_SECRET');
		}
		if (!GITHUB_OAUTH_CALLBACK_URL) {
			missing.push('GITHUB_OAUTH_CALLBACK_URL');
		}
	}

	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables: ${missing.join(', ')}`,
		);
	}

	// (a) DEPLOYMENT FOOTGUN: disabling the GitHub OAuth gate drops the
	// per-githubId anti-sybil slot and the session-bound nonce guarantees, so the
	// faucet is trivially drainable. Refuse to boot unless an operator explicitly
	// opts into a dev profile (DEV_PROFILE=true), in which case emit a loud warning.
	if (!GITHUB_OAUTH_ENABLED) {
		if (!DEV_PROFILE) {
			throw new Error(
				'GITHUB_OAUTH_ENABLED=false disables the anti-sybil / nonce guarantees and is refused in production. ' +
					'Set DEV_PROFILE=true to run without the GitHub gate for local development only.',
			);
		}
		// biome-ignore lint/suspicious/noConsole: startup guard runs before the logger
		console.warn(
			'[SECURITY WARNING] GITHUB_OAUTH_ENABLED=false: the GitHub anti-sybil gate is DISABLED. ' +
				'Nonce/anti-sybil protections are dropped and the faucet is drainable. ' +
				'This is only safe under an explicit dev profile (DEV_PROFILE=true). NEVER run this in production.',
		);
	}

	// (b) DEPLOYMENT FOOTGUN: with TRUST_PROXY=true koa honours X-Forwarded-For for
	// IP rate limiting. If the fronting proxy APPENDS to (rather than OVERWRITES)
	// an attacker-supplied XFF, the client can spoof its source IP and bypass the
	// per-IP rate limits. Warn loudly so operators verify their proxy config.
	if (TRUST_PROXY) {
		// biome-ignore lint/suspicious/noConsole: startup guard runs before the logger
		console.warn(
			'[SECURITY WARNING] TRUST_PROXY=true: X-Forwarded-For is trusted for IP rate limiting. ' +
				'Ensure the fronting reverse proxy OVERWRITES (does not append to) X-Forwarded-For — ' +
				'otherwise clients can spoof their source IP and bypass rate limits.',
		);
	}
}
