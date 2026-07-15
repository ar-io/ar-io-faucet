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
import { getMint } from '@solana/spl-token';
import { type Commitment, Connection, PublicKey } from '@solana/web3.js';
import jwt from 'jsonwebtoken';
import { GitHubOAuthClient } from './auth/github-oauth.js';
import { GithubClaimStore, NodeStateStore } from './auth/state-store.js';
import { NodeTokenCache } from './cache/token-cache.js';
import { hCaptchaVerifier } from './captcha/hcaptcha.js';
import * as config from './config.js';
import { loadFaucetKeypair } from './faucet/keypair.js';
import { SolanaTokenFaucet } from './faucet/solana-token-faucet.js';
import type { TokenFaucet } from './types.js';

// validate required env vars before wiring anything up
config.assertRequiredConfig();

export const captcha = config.CAPTCHA_SECRET_KEY
	? new hCaptchaVerifier({
			secretKey: config.CAPTCHA_SECRET_KEY as string,
			siteVerifyUrl: config.CAPTCHA_SITE_VERIFY_URL as string,
		})
	: undefined;

// solana connection + faucet keypair
export const connection = new Connection(config.SOLANA_RPC_URL, {
	commitment: config.SOLANA_COMMITMENT as Commitment,
});

const faucetKeypair = loadFaucetKeypair(
	config.SOLANA_FAUCET_SECRET_KEY as string,
);

const mint = new PublicKey(config.SOLANA_TOKEN_MINT as string);

// resolve token decimals from chain unless explicitly configured
const decimals =
	config.SOLANA_TOKEN_DECIMALS ?? (await getMint(connection, mint)).decimals;

export const walletAddress = faucetKeypair.publicKey.toBase58();

export const supportedProcesses = new Map<string, TokenFaucet>([
	[
		config.SOLANA_TOKEN_ID,
		new SolanaTokenFaucet({
			cache: new NodeTokenCache({
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			connection,
			faucetKeypair,
			mint,
			decimals,
			tokenId: config.SOLANA_TOKEN_ID,
			authTokenSigner: jwt,
			authTokenSecret: config.AUTH_TOKEN_SECRET as string,
		}),
	],
]);

// github oauth gate (only wired when enabled)
export const githubOAuth = config.GITHUB_OAUTH_ENABLED
	? new GitHubOAuthClient({
			clientId: config.GITHUB_CLIENT_ID as string,
			clientSecret: config.GITHUB_CLIENT_SECRET as string,
			callbackUrl: config.GITHUB_OAUTH_CALLBACK_URL as string,
			apiBaseUrl: config.GITHUB_API_BASE_URL,
			authorizeUrl: config.GITHUB_OAUTH_AUTHORIZE_URL,
			tokenUrl: config.GITHUB_OAUTH_TOKEN_URL,
			minAccountAgeDays: config.GITHUB_MIN_ACCOUNT_AGE_DAYS,
		})
	: undefined;

export const stateStore = new NodeStateStore({
	ttlSeconds: config.GITHUB_OAUTH_STATE_TTL_SECONDS,
});

// per-githubId anti-sybil store (one claim per GitHub id per rate-limit window)
export const githubClaimStore = new GithubClaimStore({
	ttlSeconds: config.GLOBAL_RATE_LIMIT_WINDOW_SECONDS,
});
