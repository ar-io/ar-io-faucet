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
import { z } from 'zod';
import * as config from './config.js';

export interface TokenPayload {
	issuer: string;
	// `processId` is retained for request/response compatibility; for the Solana
	// build it carries the faucet `tokenId` (SOLANA_TOKEN_ID) instead of an AO id.
	processId: string;
	iat: number;
	exp: number;
	nonce: string;
	// Initiating browser session id. Bound into the claim JWT and matched against
	// the `faucet_sid` cookie at claim time so a leaked token can't be replayed
	// from a different session. Optional for API/non-browser clients.
	sid?: string;
	// GitHub-bound claim credentials (optional for back-compat)
	githubId?: number | string;
	githubLogin?: string;
	githubAccountCreatedAt?: string;
}

export interface TokenCache {
	get(nonce: string): Promise<TokenPayload | null>;
	set(nonce: string, token: TokenPayload): Promise<void>;
	// Atomic, synchronous set-if-absent. Returns true if the caller reserved the
	// nonce, false if it was already present. Used to burn a nonce BEFORE the
	// transfer so concurrent claims sharing a nonce cannot all pass.
	reserve(nonce: string, token: TokenPayload): boolean;
	delete(nonce: string): Promise<void>;
	clear(): Promise<void>;
	size(): Promise<number>;
}

// Shared faucet contract implemented by the (Solana) token faucet. Kept here so
// system.ts and router.ts depend on the interface rather than a concrete faucet.
export interface TokenFaucet {
	requestAuthToken(): Promise<{
		token: string;
		expiresAt: number;
	}>;
	requestAuthTokenForGithub(params: {
		githubId: number | string;
		githubLogin: string;
		githubAccountCreatedAt: string;
		sid?: string;
	}): Promise<{
		token: string;
		expiresAt: number;
	}>;
	verifyAuthToken({ token }: { token: string }): Promise<{
		valid: boolean;
		payload: TokenPayload;
	}>;
	claim(params: {
		qty?: number;
		recipient: string;
		githubId?: number | string;
	}): Promise<{
		id: string;
		status: string;
	}>;
}

// A Solana address is base58 and, when decoded, 32 bytes. Length in base58
// characters is 32..44. Actual on-curve validity is enforced at claim time via
// `new PublicKey(recipient)`.
const SolanaAddressSchema = z
	.string()
	.min(32, 'Recipient must be a valid Solana address')
	.max(44, 'Recipient must be a valid Solana address')
	.regex(
		/^[1-9A-HJ-NP-Za-km-z]+$/,
		'Recipient must be a valid base58 Solana address',
	);

export const AuthTokenRequestSchema = z.object({
	processId: z.string().min(1, 'Process ID is required'),
});

export const CaptchaRequestSchema = z.object({
	processId: z.string().min(1, 'Process ID is required'),
	captchaResponse: z.string().min(1, 'Captcha response is required'),
});

// qty must be a positive integer within the faucet's max. The per-claim floor
// (minQty) is enforced at claim time in the faucet since it depends on runtime
// config that can be overridden per-faucet instance.
const QtySchema = z
	.number()
	.int('Quantity must be an integer')
	.positive('Quantity must be greater than 0')
	.max(
		config.DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY,
		`Quantity must be less than or equal to ${config.DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY}`,
	);

export const ClaimRequestSchema = z.object({
	processId: z.string().min(1, 'Process ID is required'),
	recipient: SolanaAddressSchema,
	qty: QtySchema,
	captchaResponse: z.string().min(1, 'Captcha response is required'),
});

export const AsyncClaimRequestSchema = z.object({
	processId: z.string().min(1, 'Process ID is required'),
	recipient: SolanaAddressSchema,
	qty: QtySchema,
});

export type AuthTokenRequest = z.infer<typeof AuthTokenRequestSchema>;
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;
export type AsyncClaimRequest = z.infer<typeof AsyncClaimRequestSchema>;
