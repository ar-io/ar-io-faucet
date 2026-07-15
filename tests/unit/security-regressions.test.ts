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

// Focused regression tests for the four security fixes hardened in
// `fix: close TOCTOU faucet drain and harden claim auth`:
//
//   (1) concurrent double-claim — one atomic nonce reservation wins under
//       concurrency, so exactly ONE transfer executes for a single JWT.
//   (2) rate-limit key — an attacker-supplied X-Forwarded-For neither creates
//       unbounded buckets nor keys on the first character; a spoofed XFF does
//       not get a private bucket.
//   (3) JWT expiry — a token whose `exp` (in SECONDS) is in the past is rejected
//       by verification.
//   (4) minQty floor — a qty below the per-claim minimum is rejected before any
//       transfer.
//
// All external boundaries are mocked: no devnet RPC, no api.github.com, no
// Docker. The Solana Connection is a plain stub; JWTs are signed/verified with
// the real `jsonwebtoken` in-process; the rate-limit key derivation is a pure
// function exercised directly.

import assert from 'node:assert';
import { describe, it, mock } from 'node:test';
import {
	ACCOUNT_SIZE,
	AccountLayout,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddress,
	getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import jwt from 'jsonwebtoken';
import { performClaim } from '../../src/claim.js';
import { NodeTokenCache } from '../../src/cache/token-cache.js';
import { SolanaTokenFaucet } from '../../src/faucet/solana-token-faucet.js';
import { clientId } from '../../src/middleware/rate-limiter.js';
import type { TokenPayload } from '../../src/types.js';

// Stub anti-sybil store: the per-githubId slot was reserved at the OAuth
// callback, so during the claim it reports the slot as still held.
const githubStoreAlwaysHeld = { has: () => true };

const DECIMALS = 6;

// Encode a real SPL token account buffer so @solana/spl-token's unpackAccount
// succeeds and returns the requested amount (mirrors what a live getAccountInfo
// would return for an existing ATA).
function encodeTokenAccount({
	mint,
	owner,
	amount,
}: {
	mint: PublicKey;
	owner: PublicKey;
	amount: bigint;
}): Buffer {
	const data = Buffer.alloc(ACCOUNT_SIZE);
	AccountLayout.encode(
		{
			mint,
			owner,
			amount,
			delegateOption: 0,
			delegate: PublicKey.default,
			state: 1,
			isNativeOption: 0,
			isNative: 0n,
			delegatedAmount: 0n,
			closeAuthorityOption: 0,
			closeAuthority: PublicKey.default,
		},
		data,
	);
	return data;
}

function accountInfo(data: Buffer) {
	return {
		data,
		owner: TOKEN_PROGRAM_ID,
		lamports: 1_000_000,
		executable: false,
		rentEpoch: 0,
	};
}

type AccountMap = Map<string, ReturnType<typeof accountInfo> | null>;

// A mock Connection: getAccountInfo returns per-address stubs; send/confirm are
// counted so we can assert exactly how many transfers were dispatched.
function makeConnection(accounts: AccountMap) {
	const sendTransaction = mock.fn(
		// biome-ignore lint/suspicious/noExplicitAny: transaction arg typed loosely
		async (_transaction: any, _signers?: any, _opts?: any) =>
			'MOCK_SIGNATURE_11111111111111',
	);
	const confirmTransaction = mock.fn(
		// biome-ignore lint/suspicious/noExplicitAny: web3 confirm arg
		async (_arg?: any, _commitment?: any) => ({ value: { err: null } }),
	);
	const connection = {
		async getAccountInfo(address: PublicKey) {
			return accounts.get(address.toBase58()) ?? null;
		},
		sendTransaction,
		confirmTransaction,
	};
	return { connection, sendTransaction, confirmTransaction };
}

// Real jsonwebtoken as the auth signer so expiry (exp in seconds) is enforced by
// the actual library, not a stub.
const jwtSigner = {
	// biome-ignore lint/suspicious/noExplicitAny: jsonwebtoken signature
	sign: (payload: any, secret: any, opts: any) =>
		jwt.sign(payload, secret, opts),
	// biome-ignore lint/suspicious/noExplicitAny: jsonwebtoken signature
	verify: (token: any, secret: any, opts: any) =>
		jwt.verify(token, secret, opts),
};

function buildFaucet({
	accounts,
	faucetKeypair,
	mint,
	cache,
	signer = { sign: () => 'tok', verify: () => ({}) },
	maxQty = 1_000_000,
	minQty = 100,
	defaultQty = 500,
}: {
	accounts: AccountMap;
	faucetKeypair: Keypair;
	mint: PublicKey;
	cache: ConstructorParameters<typeof SolanaTokenFaucet>[0]['cache'];
	// biome-ignore lint/suspicious/noExplicitAny: signer shape varies per test
	signer?: any;
	maxQty?: number;
	minQty?: number;
	defaultQty?: number;
}) {
	const { connection, sendTransaction } = makeConnection(accounts);
	const faucet = new SolanaTokenFaucet({
		cache,
		// biome-ignore lint/suspicious/noExplicitAny: mock connection
		connection: connection as any,
		faucetKeypair,
		mint,
		decimals: DECIMALS,
		tokenId: 'solana-devnet',
		authTokenSigner: signer,
		authTokenSecret: 'test-secret',
		commitment: 'confirmed',
		maxQty,
		minQty,
		defaultQty,
	});
	return { faucet, sendTransaction };
}

// A minimal koa-ctx stand-in for performClaim. Captures status/body writes.
function makeCtx() {
	return {
		status: 200,
		// biome-ignore lint/suspicious/noExplicitAny: koa body is untyped
		body: undefined as any,
	};
}

// ---------------------------------------------------------------------------
// (1) Concurrent double-claim: one atomic reservation wins under concurrency.
// ---------------------------------------------------------------------------
describe('regression (1): concurrent double-claim on the same JWT', () => {
	async function fundedAccounts(faucetKeypair: Keypair, mint: PublicKey) {
		const recipient = Keypair.generate().publicKey;
		const recipientAta = await getAssociatedTokenAddress(mint, recipient);
		const faucetAta = await getAssociatedTokenAddress(
			mint,
			faucetKeypair.publicKey,
		);
		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000_000n,
				}),
			),
		);
		accounts.set(
			recipientAta.toBase58(),
			accountInfo(
				encodeTokenAccount({ mint, owner: recipient, amount: 0n }),
			),
		);
		return { accounts, recipient: recipient.toBase58() };
	}

	it('fires N concurrent claims sharing one nonce and dispatches exactly ONE transfer', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const { accounts, recipient } = await fundedAccounts(faucetKeypair, mint);

		// The production NodeTokenCache backs the atomic reservation.
		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet, sendTransaction } = buildFaucet({
			accounts,
			faucetKeypair,
			mint,
			cache,
		});

		// One shared JWT payload => one shared nonce for all concurrent claims.
		const payload: TokenPayload = {
			issuer: faucetKeypair.publicKey.toBase58(),
			processId: 'solana-devnet',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
			nonce: 'shared-nonce-concurrent',
			githubId: 4242,
		};

		const N = 8;
		const ctxs = Array.from({ length: N }, () => makeCtx());
		await Promise.all(
			ctxs.map((ctx) =>
				performClaim(
					ctx,
					faucet,
					payload,
					{ recipient, qty: 500 },
					githubStoreAlwaysHeld,
				),
			),
		);

		// Exactly one transfer reached the chain despite N concurrent claims.
		assert.strictEqual(
			sendTransaction.mock.callCount(),
			1,
			'exactly one on-chain transfer must execute for a shared JWT',
		);

		// Exactly one ctx got a success body; the rest were rejected as replays.
		const successes = ctxs.filter(
			(c) => c.body && c.body.status === 'success',
		);
		const replays = ctxs.filter((c) => c.status === 409);
		assert.strictEqual(successes.length, 1, 'exactly one claim succeeds');
		assert.strictEqual(
			replays.length,
			N - 1,
			'all other concurrent claims are rejected as already-used',
		);
	});

	it('reserveNonce is set-if-absent: the second reservation of a nonce loses', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet } = buildFaucet({
			accounts: new Map(),
			faucetKeypair,
			mint,
			cache,
		});
		const payload: TokenPayload = {
			issuer: faucetKeypair.publicKey.toBase58(),
			processId: 'solana-devnet',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
			nonce: 'nonce-once',
		};
		assert.strictEqual(faucet.reserveNonce(payload), true);
		assert.strictEqual(faucet.reserveNonce(payload), false);
	});
});

// ---------------------------------------------------------------------------
// (1b) Confirm-timeout double-claim: a send/confirm failure is POST-broadcast
//      (the tx may have landed on-chain), so the nonce must NOT be released — a
//      subsequent claim reusing the same nonce/JWT is rejected. A PRE-broadcast
//      validation error DOES release the nonce so a corrected retry can proceed.
// ---------------------------------------------------------------------------
describe('regression (1b): confirm-timeout must not release the nonce', () => {
	function fundedAccountsSync(faucetKeypair: Keypair, mint: PublicKey) {
		const recipient = Keypair.generate();
		const faucetAta = getAssociatedTokenAddressSync(
			mint,
			faucetKeypair.publicKey,
		).toBase58();
		const recipientAta = getAssociatedTokenAddressSync(
			mint,
			recipient.publicKey,
		).toBase58();
		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta,
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000_000n,
				}),
			),
		);
		accounts.set(
			recipientAta,
			accountInfo(
				encodeTokenAccount({ mint, owner: recipient.publicKey, amount: 0n }),
			),
		);
		return { accounts, recipient: recipient.publicKey.toBase58() };
	}

	// Build a faucet whose Connection confirms transactions by REJECTING (mirrors
	// sendAndConfirmTransaction throwing on a blockhash/confirm timeout even though
	// the tx may have landed on-chain).
	function buildFaucetConfirmTimeout({
		accounts,
		faucetKeypair,
		mint,
		cache,
	}: {
		accounts: AccountMap;
		faucetKeypair: Keypair;
		mint: PublicKey;
		cache: ConstructorParameters<typeof SolanaTokenFaucet>[0]['cache'];
	}) {
		const sendTransaction = mock.fn(
			// biome-ignore lint/suspicious/noExplicitAny: transaction arg typed loosely
			async (_transaction: any, _signers?: any, _opts?: any) =>
				'MOCK_SIGNATURE_11111111111111',
		);
		const confirmTransaction = mock.fn(
			// biome-ignore lint/suspicious/noExplicitAny: web3 confirm arg
			async (_arg?: any, _commitment?: any): Promise<{ value: unknown }> => {
				throw new Error(
					'Transaction was not confirmed in 30.00 seconds. It is unknown if it succeeded or failed.',
				);
			},
		);
		const connection = {
			async getAccountInfo(address: PublicKey) {
				return accounts.get(address.toBase58()) ?? null;
			},
			sendTransaction,
			confirmTransaction,
		};
		const faucet = new SolanaTokenFaucet({
			cache,
			// biome-ignore lint/suspicious/noExplicitAny: mock connection
			connection: connection as any,
			faucetKeypair,
			mint,
			decimals: DECIMALS,
			tokenId: 'solana-devnet',
			authTokenSigner: { sign: () => 'tok', verify: () => ({}) },
			authTokenSecret: 'test-secret',
			commitment: 'confirmed',
			maxQty: 1_000_000,
			minQty: 100,
			defaultQty: 500,
		});
		return { faucet, sendTransaction };
	}

	it('(a) does NOT release the nonce on a send/confirm timeout; a retry with the same nonce is rejected (no second transfer)', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const { accounts, recipient } = fundedAccountsSync(faucetKeypair, mint);

		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet, sendTransaction } = buildFaucetConfirmTimeout({
			accounts,
			faucetKeypair,
			mint,
			cache,
		});

		const payload: TokenPayload = {
			issuer: faucetKeypair.publicKey.toBase58(),
			processId: 'solana-devnet',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
			nonce: 'confirm-timeout-nonce',
			githubId: 4242,
		};

		// First claim: transfer is broadcast, confirmation times out.
		const ctx1 = makeCtx();
		await performClaim(
			ctx1,
			faucet,
			payload,
			{ recipient, qty: 500 },
			githubStoreAlwaysHeld,
		);

		// Surfaced as a distinct pending/unknown status, NOT a hard failure.
		assert.strictEqual(ctx1.status, 202, 'timeout is surfaced as pending (202)');
		assert.strictEqual(ctx1.body.status, 'pending');
		assert.strictEqual(
			sendTransaction.mock.callCount(),
			1,
			'the transfer was broadcast exactly once',
		);

		// The nonce must still be burned: a retry with the SAME token is a replay.
		const ctx2 = makeCtx();
		await performClaim(
			ctx2,
			faucet,
			payload,
			{ recipient, qty: 500 },
			githubStoreAlwaysHeld,
		);

		assert.strictEqual(
			ctx2.status,
			409,
			'a replay of the same nonce after a confirm timeout is rejected',
		);
		assert.deepStrictEqual(ctx2.body, { error: 'Token already used' });
		assert.strictEqual(
			sendTransaction.mock.callCount(),
			1,
			'no SECOND on-chain transfer is dispatched after a confirm timeout',
		);
	});

	it('(b) DOES release the nonce on a pre-broadcast validation error, so a corrected retry can proceed', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const { accounts, recipient } = fundedAccountsSync(faucetKeypair, mint);

		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		// Happy-path connection (send + confirm both succeed) so the corrected
		// retry actually lands.
		const { faucet, sendTransaction } = buildFaucet({
			accounts,
			faucetKeypair,
			mint,
			cache,
		});

		const payload: TokenPayload = {
			issuer: faucetKeypair.publicKey.toBase58(),
			processId: 'solana-devnet',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 3600,
			nonce: 'prebroadcast-error-nonce',
			githubId: 4242,
		};

		// First claim: pre-broadcast validation error (recipient is not a valid
		// Solana address). This is thrown as BadRequestError before any broadcast.
		const ctx1 = makeCtx();
		await assert.rejects(
			() =>
				performClaim(
					ctx1,
					faucet,
					payload,
					{ recipient: 'not-a-valid-address', qty: 500 },
					githubStoreAlwaysHeld,
				),
			/Invalid Solana recipient address/,
		);
		assert.strictEqual(
			sendTransaction.mock.callCount(),
			0,
			'a pre-broadcast validation error never dispatches a transfer',
		);

		// The nonce was released, so a corrected retry with the SAME token proceeds.
		const ctx2 = makeCtx();
		await performClaim(
			ctx2,
			faucet,
			payload,
			{ recipient, qty: 500 },
			githubStoreAlwaysHeld,
		);

		assert.strictEqual(
			ctx2.body?.status,
			'success',
			'a corrected retry with the same token succeeds after the nonce is released',
		);
		assert.strictEqual(
			sendTransaction.mock.callCount(),
			1,
			'the corrected retry dispatches exactly one transfer',
		);
	});
});

// ---------------------------------------------------------------------------
// (2) Rate-limit key: attacker XFF is not turned into unlimited buckets and is
//     never keyed on the first character.
// ---------------------------------------------------------------------------
describe('regression (2): rate-limit client-id key derivation', () => {
	it('ignores attacker-supplied X-Forwarded-For when the proxy is NOT trusted', () => {
		// Two requests from the SAME socket ip but DIFFERENT spoofed XFF headers
		// must map to the SAME bucket key (the socket ip), otherwise an attacker
		// mints unlimited buckets by rotating XFF.
		const a = clientId(
			{ ip: '10.0.0.5', headers: { 'x-forwarded-for': '1.1.1.1' } },
			false,
		);
		const b = clientId(
			{ ip: '10.0.0.5', headers: { 'x-forwarded-for': '9.9.9.9' } },
			false,
		);
		assert.strictEqual(a, '10.0.0.5');
		assert.strictEqual(b, '10.0.0.5');
		assert.strictEqual(a, b, 'spoofed XFF must not create a private bucket');
	});

	it('does NOT key on the first character of X-Forwarded-For (the old xff[0] bug)', () => {
		// Regression for `xff?.[0]`: two DIFFERENT client ips that share a first
		// character must NOT collapse into one bucket. With the fix, when the
		// proxy is trusted, ctx.ip (parsed by koa from XFF) is authoritative and
		// the two keys differ.
		const k1 = clientId(
			{ ip: '1.2.3.4', headers: { 'x-forwarded-for': '1.2.3.4' } },
			true,
		);
		const k2 = clientId(
			{ ip: '1.9.9.9', headers: { 'x-forwarded-for': '1.9.9.9' } },
			true,
		);
		assert.strictEqual(k1, '1.2.3.4');
		assert.strictEqual(k2, '1.9.9.9');
		assert.notStrictEqual(
			k1,
			k2,
			'clients sharing a first character must not share a bucket',
		);
		// And the key is a full ip, never a single character.
		assert.ok(k1.length > 1);
	});

	it('trusted-proxy fallback parses the FIRST comma-separated IP, not the first char', () => {
		// Defensive path: proxy trusted but ctx.ip empty -> parse leading XFF ip.
		const key = clientId(
			{ ip: '', headers: { 'x-forwarded-for': '203.0.113.7, 70.41.3.18' } },
			true,
		);
		assert.strictEqual(key, '203.0.113.7');
	});
});

// ---------------------------------------------------------------------------
// (3) JWT expiry: a token past its exp (in seconds) is rejected.
// ---------------------------------------------------------------------------
describe('regression (3): expired JWT is rejected by verification', () => {
	it('verifyAuthToken throws for a token whose exp (seconds) is in the past', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet } = buildFaucet({
			accounts: new Map(),
			faucetKeypair,
			mint,
			cache,
			signer: jwtSigner,
		});

		const issuer = faucetKeypair.publicKey.toBase58();
		const nowSeconds = Math.floor(Date.now() / 1000);
		// exp is 60s in the PAST, in seconds (the unit jsonwebtoken enforces).
		const expiredPayload = {
			issuer,
			processId: 'solana-devnet',
			iat: nowSeconds - 120,
			exp: nowSeconds - 60,
			nonce: 'expired-nonce',
			githubId: 7,
		};
		const expiredToken = jwt.sign(expiredPayload, 'test-secret', {
			algorithm: 'HS256',
			issuer,
			audience: 'solana-devnet',
		});

		// The real jwt.verify rejects an expired token (TokenExpiredError).
		await assert.rejects(
			() => faucet.verifyAuthToken({ token: expiredToken }),
			/jwt expired/i,
		);
	});

	it('accepts a NON-expired, github-bound token (positive control)', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet } = buildFaucet({
			accounts: new Map(),
			faucetKeypair,
			mint,
			cache,
			signer: jwtSigner,
		});

		const issuer = faucetKeypair.publicKey.toBase58();
		const nowSeconds = Math.floor(Date.now() / 1000);
		const token = jwt.sign(
			{
				issuer,
				processId: 'solana-devnet',
				iat: nowSeconds,
				exp: nowSeconds + 3600,
				nonce: 'fresh-nonce',
				githubId: 7,
			},
			'test-secret',
			{ algorithm: 'HS256', issuer, audience: 'solana-devnet' },
		);

		const { valid } = await faucet.verifyAuthToken({ token });
		assert.strictEqual(valid, true);
	});
});

// ---------------------------------------------------------------------------
// (4) minQty floor: a qty below minQty is rejected before any transfer.
// ---------------------------------------------------------------------------
describe('regression (4): qty below minQty is rejected', () => {
	it('rejects a qty under the per-claim minimum and never sends', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const faucetAta = await getAssociatedTokenAddress(
			mint,
			faucetKeypair.publicKey,
		);
		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000_000n,
				}),
			),
		);

		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet, sendTransaction } = buildFaucet({
			accounts,
			faucetKeypair,
			mint,
			cache,
			minQty: 100,
			maxQty: 1_000_000,
		});

		const recipient = Keypair.generate().publicKey.toBase58();
		await assert.rejects(
			() => faucet.claim({ qty: 50, recipient }),
			/min quantity of 100/,
		);
		assert.strictEqual(
			sendTransaction.mock.callCount(),
			0,
			'a sub-minimum qty must never dispatch a transfer',
		);
	});

	it('accepts a qty exactly at minQty (boundary, positive control)', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const recipient = Keypair.generate().publicKey;
		const faucetAta = await getAssociatedTokenAddress(
			mint,
			faucetKeypair.publicKey,
		);
		const recipientAta = await getAssociatedTokenAddress(mint, recipient);
		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000_000n,
				}),
			),
		);
		accounts.set(
			recipientAta.toBase58(),
			accountInfo(encodeTokenAccount({ mint, owner: recipient, amount: 0n })),
		);

		const cache = new NodeTokenCache({ ttlSeconds: 3600 });
		const { faucet, sendTransaction } = buildFaucet({
			accounts,
			faucetKeypair,
			mint,
			cache,
			minQty: 100,
			maxQty: 1_000_000,
		});

		const result = await faucet.claim({
			qty: 100,
			recipient: recipient.toBase58(),
		});
		assert.strictEqual(result.status, 'success');
		assert.strictEqual(sendTransaction.mock.callCount(), 1);
	});
});
