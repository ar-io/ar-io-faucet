import type { JWKInterface } from '@dha-team/arbundles/node';
import { message, result } from '@permaweb/aoconnect';
import * as config from '../config.js';
import { arweave } from '../system.js';
import type { TokenCache } from '../types.js';

export interface TokenFaucet {
	request(recipient: string): Promise<string>;
	verify(token: string): Promise<boolean>;
	mint({ token, qty }: { token: string; qty?: number }): Promise<{
		id: string;
		status: string;
		error?: string;
	}>;
}

export class AoTokenFaucet implements TokenFaucet {
	// dependencies
	private readonly cache: TokenCache;
	private readonly wallet: JWKInterface;
	private tokenDurationMs: number;
	private processId: string;
	private defaultQty: number;
	constructor({
		cache,
		processId,
		wallet = config.WALLET,
		tokenDurationMs = config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS * 1000,
		defaultQty = config.DEFAULT_FAUCET_TOKEN_TRANSFER_QTY,
	}: {
		cache: TokenCache;
		processId: string;
		wallet?: JWKInterface;
		tokenDurationMs?: number;
		defaultQty?: number;
	}) {
		this.cache = cache;
		this.wallet = wallet;
		this.tokenDurationMs = tokenDurationMs;
		this.processId = processId;
		this.defaultQty = defaultQty;
	}

	async request(recipient: string): Promise<string> {
		const payload = {
			address: this.wallet.n,
			processId: this.processId,
			recipient: recipient,
			issuedAt: Date.now(),
			expiresAt: Date.now() + this.tokenDurationMs,
			nonce:
				Math.random().toString(36).substring(2, 15) +
				Math.random().toString(36).substring(2, 15),
		};

		const payloadString = JSON.stringify(payload);
		const signature = await arweave.crypto.sign(
			this.wallet,
			Buffer.from(payloadString),
		);
		const token = Buffer.from(
			JSON.stringify({
				payload: payloadString,
				signature: Buffer.from(signature).toString('base64'),
			}),
		).toString('base64url');

		// set it in our inflight token map
		this.cache.set(payload.nonce, { ...payload, used: false });

		return token;
	}

	async verify(token: string): Promise<boolean> {
		const tokenData = JSON.parse(Buffer.from(token, 'base64').toString('utf8'));
		const { payload: payloadString, signature } = tokenData;

		const payload = JSON.parse(payloadString);
		const isValid = await arweave.crypto.verify(
			this.wallet.n,
			Buffer.from(payloadString),
			Buffer.from(signature, 'base64'),
		);
		const isExpired = payload.expiresAt < Date.now();
		const isUsed = (await this.cache.get(payload.nonce))?.used ?? false;

		return isValid && !isExpired && !isUsed;
	}

	async mint({
		token,
		qty,
	}: {
		token: string;
		qty?: number;
	}): Promise<{ id: string; status: string; error?: string }> {
		const isValid = await this.verify(token);
		if (!isValid) {
			throw new Error('Invalid token');
		}

		const { payload: payloadString } = JSON.parse(
			Buffer.from(token, 'base64').toString('utf8'),
		);
		const { recipient, nonce } = JSON.parse(payloadString);

		// assuming token follows token spec, transfer should work
		const msgId = await message({
			process: this.processId,
			tags: [
				{ name: 'Action', value: 'Transfer' },
				{ name: 'Recipient', value: recipient },
				{
					name: 'Quantity',
					value: qty?.toString() ?? this.defaultQty.toString(),
				},
			],
			data: JSON.stringify({
				recipient,
				qty,
			}),
		});

		// check the result
		const transferResult = await result({
			message: msgId,
			process: this.processId,
		});

		// if no error, delete the token from the cache
		if (transferResult.Error === undefined) {
			this.cache.delete(nonce);
		}

		return {
			id: msgId,
			status: transferResult.Error ? 'error' : 'success',
			error: transferResult.Error,
		};
	}
}
