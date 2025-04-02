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

// frontend config
export const DISABLE_SELF_HOSTED_FRONTEND =
	process.env.DISABLE_SELF_HOSTED_FRONTEND === 'true';

// wallet config
export const WALLET_FILE = process.env.WALLET_FILE;
export const WALLET = WALLET_FILE
	? fs.readFileSync(WALLET_FILE, 'utf8')
	: process.env.WALLET;

// logging config
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_FORMAT = process.env.LOG_FORMAT || 'json';

// rate limiting config
export const RATE_LIMIT_WINDOW_SECONDS = +(
	(process.env.RATE_LIMIT_WINDOW_SECONDS || 3600) // 1 hour
);
export const RATE_LIMIT_THRESHOLD = +(process.env.RATE_LIMIT_THRESHOLD || 10); // 10 requests per 1 hour

// captcha config
export const DISABLE_CAPTCHA_VERIFICATION =
	process.env.DISABLE_CAPTCHA_VERIFICATION === 'true';
export const CAPTCHA_SITE_VERIFY_URL = process.env.CAPTCHA_SITE_VERIFY_URL;
export const CAPTCHA_SECRET_KEY = process.env.CAPTCHA_SECRET_KEY;

if (
	DISABLE_CAPTCHA_VERIFICATION &&
	(!CAPTCHA_SITE_VERIFY_URL || !CAPTCHA_SECRET_KEY)
) {
	throw new Error(
		'CAPTCHA_SECRET_KEY and CAPTCHA_SITE_VERIFY_URL must be set if DISABLE_CAPTCHA_VERIFICATION is false',
	);
}
