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

// Unit tests for the Solana SPL transfer path in SolanaTokenFaucet.
//
// The RPC is NEVER hit: @solana/spl-token's getAccount() and web3.js's
// sendAndConfirmTransaction() both funnel through the injected Connection
// (connection.getAccountInfo / connection.sendTransaction /
// connection.confirmTransaction), so mocking those methods on a plain object
// fully controls behaviour without touching devnet. Real Keypair/PublicKey are
// used so instruction building and address derivation are exercised for real.

import assert from 'node:assert';
import { beforeEach, describe, it, mock } from 'node:test';
import {
	ACCOUNT_SIZE,
	AccountLayout,
	TOKEN_PROGRAM_ID,
	getAssociatedTokenAddress,
} from '@solana/spl-token';
import { Keypair, PublicKey } from '@solana/web3.js';
import { SolanaTokenFaucet } from '../../src/faucet/solana-token-faucet.js';
import type { TokenCache, TokenPayload } from '../../src/types.js';

const DECIMALS = 6;

// Build a real, parseable SPL token account buffer so unpackAccount() in
// @solana/spl-token succeeds and returns the amount we want. This is what a
// live getAccountInfo() would return for an existing ATA.
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
			state: 1, // Initialized
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

// Minimal in-memory TokenCache used for nonce single-use tracking.
function makeCache(): TokenCache & { store: Map<string, TokenPayload> } {
	const store = new Map<string, TokenPayload>();
	return {
		store,
		async get(nonce) {
			return store.get(nonce) ?? null;
		},
		async set(nonce, token) {
			store.set(nonce, token);
		},
		reserve(nonce, token) {
			if (store.has(nonce)) {
				return false;
			}
			store.set(nonce, token);
			return true;
		},
		async delete(nonce) {
			store.delete(nonce);
		},
		async clear() {
			store.clear();
		},
		async size() {
			return store.size;
		},
	};
}

// A mock Connection whose getAccountInfo returns per-address stubs, and whose
// send/confirm methods record what they were called with.
type AccountMap = Map<string, ReturnType<typeof accountInfo> | null>;

function makeConnection(accounts: AccountMap) {
	const sendTransaction = mock.fn(
		// biome-ignore lint/suspicious/noExplicitAny: Transaction arg typed loosely for test inspection
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

async function makeFaucet({
	accounts,
	faucetKeypair,
	mint,
	maxQty = 1_000_000,
	minQty = 100,
	cache = makeCache(),
}: {
	accounts: AccountMap;
	faucetKeypair: Keypair;
	mint: PublicKey;
	maxQty?: number;
	minQty?: number;
	cache?: TokenCache;
}) {
	const { connection, sendTransaction, confirmTransaction } =
		makeConnection(accounts);
	const faucet = new SolanaTokenFaucet({
		cache,
		// biome-ignore lint/suspicious/noExplicitAny: mock connection
		connection: connection as any,
		faucetKeypair,
		mint,
		decimals: DECIMALS,
		tokenId: 'solana-devnet',
		authTokenSigner: { sign: () => 'tok', verify: () => ({}) },
		authTokenSecret: 'secret',
		commitment: 'confirmed',
		maxQty,
		minQty,
		defaultQty: 500,
	});
	return { faucet, sendTransaction, confirmTransaction, cache };
}

describe('SolanaTokenFaucet.claim (SPL transfer)', () => {
	let faucetKeypair: Keypair;
	let mint: PublicKey;
	let faucetAta: PublicKey;

	beforeEach(async () => {
		faucetKeypair = Keypair.generate();
		mint = Keypair.generate().publicKey;
		faucetAta = await getAssociatedTokenAddress(mint, faucetKeypair.publicKey);
	});

	it('transfers when recipient ATA already exists (no create instruction)', async () => {
		const recipient = Keypair.generate().publicKey;
		const recipientAta = await getAssociatedTokenAddress(mint, recipient);

		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000n,
				}),
			),
		);
		accounts.set(
			recipientAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: recipient,
					amount: 0n,
				}),
			),
		);

		const { faucet, sendTransaction, confirmTransaction } = await makeFaucet({
			accounts,
			faucetKeypair,
			mint,
		});

		const result = await faucet.claim({
			qty: 500,
			recipient: recipient.toBase58(),
		});

		assert.strictEqual(result.status, 'success');
		assert.strictEqual(result.id, 'MOCK_SIGNATURE_11111111111111');
		assert.strictEqual(sendTransaction.mock.callCount(), 1);
		assert.strictEqual(confirmTransaction.mock.callCount(), 1);

		// Only the transfer instruction should be present (ATA already exists).
		const tx = sendTransaction.mock.calls[0].arguments[0];
		assert.strictEqual(tx.instructions.length, 1);
		// The transfer instruction targets the SPL token program.
		assert.ok(tx.instructions[0].programId.equals(TOKEN_PROGRAM_ID));
	});

	it('adds a create-ATA instruction when recipient ATA is missing', async () => {
		const recipient = Keypair.generate().publicKey;
		const recipientAta = await getAssociatedTokenAddress(mint, recipient);

		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000n,
				}),
			),
		);
		// recipient ATA absent -> getAccountInfo returns null -> TokenAccountNotFoundError
		accounts.set(recipientAta.toBase58(), null);

		const { faucet, sendTransaction } = await makeFaucet({
			accounts,
			faucetKeypair,
			mint,
		});

		const result = await faucet.claim({
			qty: 500,
			recipient: recipient.toBase58(),
		});
		assert.strictEqual(result.status, 'success');

		const tx = sendTransaction.mock.calls[0].arguments[0];
		// create-ATA instruction + transfer instruction
		assert.strictEqual(tx.instructions.length, 2);
	});

	it('rejects an invalid Solana recipient address (never sends)', async () => {
		const accounts: AccountMap = new Map();
		const { faucet, sendTransaction } = await makeFaucet({
			accounts,
			faucetKeypair,
			mint,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 500, recipient: 'not-a-real-address' }),
			/Invalid Solana recipient address/,
		);
		assert.strictEqual(sendTransaction.mock.callCount(), 0);
	});

	it('rejects a non-positive / non-integer quantity', async () => {
		const recipient = Keypair.generate().publicKey.toBase58();
		const { faucet } = await makeFaucet({
			accounts: new Map(),
			faucetKeypair,
			mint,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 0, recipient }),
			/positive integer/,
		);
		await assert.rejects(
			() => faucet.claim({ qty: 1.5, recipient }),
			/positive integer/,
		);
	});

	it('rejects a quantity above maxQty', async () => {
		const recipient = Keypair.generate().publicKey.toBase58();
		const { faucet } = await makeFaucet({
			accounts: new Map(),
			faucetKeypair,
			mint,
			maxQty: 1000,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 5000, recipient }),
			/max quantity/,
		);
	});

	it('rejects when the faucet ATA balance is below the requested qty', async () => {
		const recipient = Keypair.generate().publicKey;
		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 100n, // less than requested 500
				}),
			),
		);

		const { faucet, sendTransaction } = await makeFaucet({
			accounts,
			faucetKeypair,
			mint,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 500, recipient: recipient.toBase58() }),
			/insufficient balance/,
		);
		assert.strictEqual(sendTransaction.mock.callCount(), 0);
	});

	it('treats a missing faucet ATA as a zero balance (insufficient)', async () => {
		const recipient = Keypair.generate().publicKey;
		const accounts: AccountMap = new Map(); // faucet ATA absent -> 0n
		const { faucet } = await makeFaucet({
			accounts,
			faucetKeypair,
			mint,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 500, recipient: recipient.toBase58() }),
			/insufficient balance/,
		);
	});

	it('rejects when the recipient already holds more than maxQty', async () => {
		const recipient = Keypair.generate().publicKey;
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
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: recipient,
					// above maxQty (1_000_000)
					amount: 5_000_000n,
				}),
			),
		);

		const { faucet, sendTransaction } = await makeFaucet({
			accounts,
			faucetKeypair,
			mint,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 500, recipient: recipient.toBase58() }),
			/already has more than the maximum/,
		);
		assert.strictEqual(sendTransaction.mock.callCount(), 0);
	});

	it('surfaces a send/confirm failure as a transfer error', async () => {
		const recipient = Keypair.generate().publicKey;
		const recipientAta = await getAssociatedTokenAddress(mint, recipient);

		const accounts: AccountMap = new Map();
		accounts.set(
			faucetAta.toBase58(),
			accountInfo(
				encodeTokenAccount({
					mint,
					owner: faucetKeypair.publicKey,
					amount: 10_000n,
				}),
			),
		);
		accounts.set(
			recipientAta.toBase58(),
			accountInfo(encodeTokenAccount({ mint, owner: recipient, amount: 0n })),
		);

		const { connection } = makeConnection(accounts);
		// Force the RPC send to blow up.
		connection.sendTransaction = mock.fn(async () => {
			throw new Error('blockhash not found');
		});

		const faucet = new SolanaTokenFaucet({
			cache: makeCache(),
			// biome-ignore lint/suspicious/noExplicitAny: mock connection
			connection: connection as any,
			faucetKeypair,
			mint,
			decimals: DECIMALS,
			tokenId: 'solana-devnet',
			authTokenSigner: { sign: () => 'tok', verify: () => ({}) },
			authTokenSecret: 'secret',
			maxQty: 1_000_000,
			minQty: 100,
			defaultQty: 500,
		});

		await assert.rejects(
			() => faucet.claim({ qty: 500, recipient: recipient.toBase58() }),
			/Failed to transfer tokens: blockhash not found/,
		);
	});
});

describe('SolanaTokenFaucet nonce single-use (reserveNonce)', () => {
	it('reserves the nonce so verifyAuthToken later sees it as replayed', async () => {
		const faucetKeypair = Keypair.generate();
		const mint = Keypair.generate().publicKey;
		const cache = makeCache();

		const faucet = new SolanaTokenFaucet({
			cache,
			// biome-ignore lint/suspicious/noExplicitAny: mock connection
			connection: makeConnection(new Map()).connection as any,
			faucetKeypair,
			mint,
			decimals: DECIMALS,
			tokenId: 'solana-devnet',
			authTokenSigner: { sign: () => 'tok', verify: () => ({}) },
			authTokenSecret: 'secret',
			maxQty: 1_000_000,
			minQty: 100,
			defaultQty: 500,
		});

		const payload: TokenPayload = {
			issuer: faucetKeypair.publicKey.toBase58(),
			processId: 'solana-devnet',
			iat: Date.now(),
			exp: Date.now() + 60_000,
			nonce: 'nonce-abc',
			githubId: 42,
		};

		assert.strictEqual(await cache.get('nonce-abc'), null);
		// first reservation wins
		assert.strictEqual(faucet.reserveNonce(payload), true);
		assert.notStrictEqual(await cache.get('nonce-abc'), null);
		// a concurrent/replayed reservation of the same nonce is rejected
		assert.strictEqual(faucet.reserveNonce(payload), false);
	});
});
