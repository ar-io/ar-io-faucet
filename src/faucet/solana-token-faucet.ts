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
import {
	TokenAccountNotFoundError,
	createAssociatedTokenAccountInstruction,
	createTransferCheckedInstruction,
	getAccount,
	getAssociatedTokenAddress,
} from '@solana/spl-token';
import {
	type Commitment,
	type Connection,
	type Keypair,
	PublicKey,
	Transaction,
	sendAndConfirmTransaction,
} from '@solana/web3.js';
import * as config from '../config.js';
import { BadRequestError } from '../errors.js';
import type { TokenCache, TokenFaucet, TokenPayload } from '../types.js';

export class SolanaTokenFaucet implements TokenFaucet {
	// dependencies
	private readonly cache: TokenCache;
	private readonly connection: Connection;
	private readonly faucetKeypair: Keypair;
	private readonly mint: PublicKey;
	private readonly decimals: number;
	private readonly tokenId: string;
	private readonly commitment: Commitment;
	// biome-ignore lint/suspicious/noExplicitAny: External library typing
	private readonly authTokenSigner: any;
	private readonly authTokenSecret: string;
	private readonly tokenDurationMs: number;
	private readonly maxQty: number;
	private readonly minQty: number;
	private readonly defaultQty: number;

	private readonly issuer: string;
	// JWT audience claim. Scopes the claim token to this faucet's process/token
	// id so a token minted for one faucet can't be replayed against another.
	private readonly audience: string;

	constructor({
		cache,
		connection,
		faucetKeypair,
		mint,
		decimals,
		tokenId,
		authTokenSigner,
		authTokenSecret,
		commitment = config.SOLANA_COMMITMENT as Commitment,
		tokenDurationMs = config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS * 1000,
		maxQty = config.DEFAULT_MAX_FAUCET_TOKEN_TRANSFER_QTY,
		minQty = config.DEFAULT_MIN_FAUCET_TOKEN_TRANSFER_QTY,
		defaultQty = config.DEFAULT_FAUCET_TOKEN_TRANSFER_QTY,
	}: {
		cache: TokenCache;
		connection: Connection;
		faucetKeypair: Keypair;
		mint: PublicKey;
		decimals: number;
		tokenId: string;
		// biome-ignore lint/suspicious/noExplicitAny: External library typing
		authTokenSigner: any;
		authTokenSecret: string;
		commitment?: Commitment;
		tokenDurationMs?: number;
		maxQty?: number;
		minQty?: number;
		defaultQty?: number;
	}) {
		this.cache = cache;
		this.connection = connection;
		this.faucetKeypair = faucetKeypair;
		this.mint = mint;
		this.decimals = decimals;
		this.tokenId = tokenId;
		this.authTokenSigner = authTokenSigner;
		this.authTokenSecret = authTokenSecret;
		this.commitment = commitment;
		this.tokenDurationMs = tokenDurationMs;
		this.maxQty = maxQty;
		this.minQty = minQty;
		this.defaultQty = defaultQty;
		this.issuer = this.faucetKeypair.publicKey.toBase58();
		this.audience = this.tokenId;
	}

	// Token lifetime in whole seconds (jsonwebtoken expects seconds).
	private tokenDurationSeconds(): number {
		return Math.floor(this.tokenDurationMs / 1000);
	}

	private generateNonce(): string {
		return (
			Math.random().toString(36).substring(2, 15) +
			Math.random().toString(36).substring(2, 15)
		);
	}

	private async getFaucetAta(): Promise<PublicKey> {
		return getAssociatedTokenAddress(this.mint, this.faucetKeypair.publicKey);
	}

	// Read the faucet's on-chain SPL balance (base units). 0 if ATA missing.
	private async getFaucetBalance(): Promise<bigint> {
		const faucetAta = await this.getFaucetAta();
		try {
			const account = await getAccount(
				this.connection,
				faucetAta,
				this.commitment,
			);
			return account.amount;
		} catch (error) {
			if (error instanceof TokenAccountNotFoundError) {
				return 0n;
			}
			throw error;
		}
	}

	private signPayload(payload: TokenPayload): {
		token: string;
		expiresAt: number;
	} {
		// jsonwebtoken works in SECONDS. iat/exp on the payload are already stored
		// in seconds (see requestAuthToken*). We pass iss/aud explicitly and let
		// the library manage iat/exp via the claims present on the payload so its
		// built-in expiry (jwt.verify) actually fires.
		const token = this.authTokenSigner.sign(payload, this.authTokenSecret, {
			algorithm: 'HS256',
			issuer: this.issuer,
			audience: this.audience,
		});
		return { token, expiresAt: payload.exp };
	}

	async requestAuthToken(): Promise<{ token: string; expiresAt: number }> {
		// Solana has no "dryrun balance" concept — check the faucet ATA on-chain.
		const balance = await this.getFaucetBalance();
		if (balance < BigInt(this.minQty)) {
			throw new Error(
				`Faucet wallet (${this.issuer}) has insufficient balance. Please try again later.`,
			);
		}

		// iat/exp in SECONDS (jsonwebtoken unit) so library-side expiry works.
		const nowSeconds = Math.floor(Date.now() / 1000);
		const payload: TokenPayload = {
			issuer: this.issuer,
			processId: this.tokenId,
			iat: nowSeconds,
			exp: nowSeconds + this.tokenDurationSeconds(),
			nonce: this.generateNonce(),
		};

		return this.signPayload(payload);
	}

	async requestAuthTokenForGithub({
		githubId,
		githubLogin,
		githubAccountCreatedAt,
		sid,
	}: {
		githubId: number | string;
		githubLogin: string;
		githubAccountCreatedAt: string;
		sid?: string;
	}): Promise<{ token: string; expiresAt: number }> {
		const balance = await this.getFaucetBalance();
		if (balance < BigInt(this.minQty)) {
			throw new Error(
				`Faucet wallet (${this.issuer}) has insufficient balance. Please try again later.`,
			);
		}

		// iat/exp in SECONDS (jsonwebtoken unit) so library-side expiry works.
		const nowSeconds = Math.floor(Date.now() / 1000);
		const payload: TokenPayload = {
			issuer: this.issuer,
			processId: this.tokenId,
			iat: nowSeconds,
			exp: nowSeconds + this.tokenDurationSeconds(),
			nonce: this.generateNonce(),
			sid,
			githubId,
			githubLogin,
			githubAccountCreatedAt,
		};

		return this.signPayload(payload);
	}

	async verifyAuthToken({ token }: { token: string }): Promise<{
		valid: boolean;
		payload: TokenPayload;
	}> {
		// jwt.verify enforces exp (now that iat/exp are in seconds) and validates
		// the iss/aud claims; it throws on failure. verifyAuthTokenSafe() in the
		// router catches that and reports valid=false.
		const payload = this.authTokenSigner.verify(token, this.authTokenSecret, {
			algorithms: ['HS256'],
			issuer: this.issuer,
			audience: this.audience,
		}) as TokenPayload;

		const isCorrectIssuer = payload.issuer === this.issuer;
		// Manual expiry check kept as defense-in-depth, in the SAME unit (seconds)
		// as the signed claim.
		const isExpired = payload.exp < Math.floor(Date.now() / 1000);
		const isInCache = await this.cache.get(payload.nonce);
		const hasGithubId =
			payload.githubId !== undefined &&
			payload.githubId !== null &&
			payload.githubId !== '';

		return {
			valid: isCorrectIssuer && !isExpired && !isInCache && !!hasGithubId,
			payload,
		};
	}

	async claim({
		qty = this.defaultQty,
		recipient,
	}: {
		qty?: number;
		recipient: string;
		githubId?: number | string;
	}): Promise<{ id: string; status: string }> {
		// 1. validate recipient is a real Solana address
		let recipientPubkey: PublicKey;
		try {
			recipientPubkey = new PublicKey(recipient);
		} catch {
			throw new BadRequestError('Invalid Solana recipient address');
		}

		// 2. qty bounds check
		if (!Number.isInteger(qty) || qty <= 0) {
			throw new BadRequestError('Quantity must be a positive integer');
		}
		// enforce the documented per-claim floor (minQty)
		if (qty < this.minQty) {
			throw new BadRequestError(
				`Quantity must be greater than or equal to min quantity of ${this.minQty}`,
			);
		}
		if (qty > this.maxQty) {
			throw new BadRequestError(
				`Quantity must be less than or equal to max quantity of ${this.maxQty}`,
			);
		}
		if (qty > Number.MAX_SAFE_INTEGER) {
			throw new BadRequestError('Quantity exceeds maximum safe integer');
		}

		const qtyBase = BigInt(qty);

		// 3. re-check faucet balance
		const faucetAta = await this.getFaucetAta();
		const faucetBalance = await this.getFaucetBalance();
		if (faucetBalance < qtyBase) {
			throw new Error(
				`Faucet wallet (${this.issuer}) has insufficient balance to transfer ${qty} tokens. Please try again later.`,
			);
		}

		// 4. derive recipient ATA
		const recipientAta = await getAssociatedTokenAddress(
			this.mint,
			recipientPubkey,
			false,
		);

		// 5. optional recipient-balance cap (preserve AO behavior)
		let recipientAtaExists = true;
		try {
			const recipientAccount = await getAccount(
				this.connection,
				recipientAta,
				this.commitment,
			);
			if (recipientAccount.amount > BigInt(this.maxQty)) {
				throw new BadRequestError(
					`Recipient (${recipient}) already has more than the maximum quantity of tokens allowed (${this.maxQty}). Please try again later.`,
				);
			}
		} catch (error) {
			if (error instanceof TokenAccountNotFoundError) {
				recipientAtaExists = false;
			} else {
				throw error;
			}
		}

		// 6. build the transaction
		const transaction = new Transaction();

		if (!recipientAtaExists) {
			transaction.add(
				createAssociatedTokenAccountInstruction(
					this.faucetKeypair.publicKey,
					recipientAta,
					recipientPubkey,
					this.mint,
				),
			);
		}

		transaction.add(
			createTransferCheckedInstruction(
				faucetAta,
				this.mint,
				recipientAta,
				this.faucetKeypair.publicKey,
				qtyBase,
				this.decimals,
			),
		);

		// 7. send + confirm
		let signature: string;
		try {
			signature = await sendAndConfirmTransaction(
				this.connection,
				transaction,
				[this.faucetKeypair],
				{ commitment: this.commitment },
			);
		} catch (error) {
			throw new Error(
				`Failed to transfer tokens: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}

		return { id: signature, status: 'success' };
	}

	// Atomically RESERVE a token's nonce BEFORE dispatching the transfer, so the
	// same JWT cannot be replayed by concurrent claims (single-use enforcement).
	// This is the load-bearing anti-replay primitive: the underlying
	// cache.reserve() does has()+set() in one synchronous critical section with
	// no await in between, so of N concurrent claims sharing a nonce exactly one
	// wins. Returns true if reserved, false if the nonce was already burned.
	reserveNonce(payload: TokenPayload): boolean {
		return this.cache.reserve(payload.nonce, payload);
	}

	// Roll back a nonce reservation. Only call on a DEFINITIVE transfer failure so
	// a legitimate user can retry with the same token before it expires.
	async releaseNonce(payload: TokenPayload): Promise<void> {
		await this.cache.delete(payload.nonce);
	}
}
