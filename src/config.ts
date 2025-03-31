import fs from 'node:fs';
import type { JWKInterface } from '@dha-team/arbundles';

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

// wallet config
export const WALLET_FILE = process.env.WALLET_FILE;
export const WALLET: JWKInterface = JSON.parse(
	WALLET_FILE
		? fs.readFileSync(WALLET_FILE, 'utf8')
		: process.env.WALLET || '{}',
);

if (!WALLET) {
	throw new Error('WALLET is not set');
}

// logging config
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_FORMAT = process.env.LOG_FORMAT || 'json';

// rate limiting config
export const RATE_LIMIT_WINDOW_MS = +(
	(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000) // 1 minute
);
export const RATE_LIMIT_THRESHOLD = +(process.env.RATE_LIMIT_THRESHOLD || 10); // 10 requests per 1 minute
