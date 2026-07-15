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
export const DEFAULT_FAUCET_TOKEN_CACHE_SIZE = +(
	(process.env.DEFAULT_FAUCET_TOKEN_CACHE_SIZE || 100) // 100 tokens
);
export const DEFAULT_FAUCET_TOKEN_TRANSFER_QTY = +(
	(process.env.DEFAULT_FAUCET_TOKEN_TRANSFER_QTY || 10_000_000_000) // 10k ARIO
);
export const DEFAULT_MIN_FAUCET_TOKEN_TRANSFER_QTY = +(
	(process.env.DEFAULT_MIN_FAUCET_TOKEN_TRANSFER_QTY || 10_000_000) // 10 ARIO
);
export const DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY = +(
	(process.env.DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY || 10_000_000_000) // 10k ARIO
);

// frontend config
export const ENABLE_SELF_HOSTED_FRONTEND =
	process.env.ENABLE_SELF_HOSTED_FRONTEND !== 'false';
export const FRONT_END_URL =
	process.env.FRONT_END_URL || `http://localhost:${PORT}`;

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

// auth token signing config (HS256 service JWT)
export const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET;

// github oauth config
export const GITHUB_OAUTH_ENABLED =
	process.env.GITHUB_OAUTH_ENABLED !== 'false';
export const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID;
export const GITHUB_CLIENT_SECRET = process.env.GITHUB_CLIENT_SECRET;
export const GITHUB_OAUTH_CALLBACK_URL =
	process.env.GITHUB_OAUTH_CALLBACK_URL;
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

// logging config
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_FORMAT = process.env.LOG_FORMAT || 'json';

// rate limiting config
export const GLOBAL_RATE_LIMIT_WINDOW_SECONDS = +(
	(process.env.GLOBAL_RATE_LIMIT_WINDOW_SECONDS || 3600) // 1 hour
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
}
