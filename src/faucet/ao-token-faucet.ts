import type { JWKInterface } from '@dha-team/arbundles/node';
import { createDataItemSigner } from '@permaweb/aoconnect';
import * as config from '../config.js';
import { arweave } from '../system.js';
import type { TokenCache } from '../types.js';

export interface TokenFaucet {
	request({
		recipient,
		qty,
	}: {
		recipient: string;
		qty?: number;
	}): Promise<string>;
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
	private maxQty: number;
	private defaultQty: number;
	// biome-ignore lint/suspicious/noExplicitAny: External library typing
	private ao: any;
	private signer: (...args: unknown[]) => unknown;

	constructor({
		cache,
		processId,
		wallet,
		tokenDurationMs = config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS * 1000,
		maxQty = config.DEFAULT_FAUCET_TOKEN_TRANSFER_QTY,
		defaultQty = config.DEFAULT_FAUCET_TOKEN_TRANSFER_QTY,
		ao,
	}: {
		cache: TokenCache;
		ao: unknown;
		processId: string;
		wallet: JWKInterface;
		tokenDurationMs?: number;
		maxQty?: number;
		defaultQty?: number;
	}) {
		this.cache = cache;
		this.wallet = wallet;
		this.ao = ao;
		this.tokenDurationMs = tokenDurationMs;
		this.processId = processId;
		this.maxQty = maxQty;
		this.defaultQty = defaultQty;
		this.signer = createDataItemSigner(wallet);
	}

	async request({
		recipient,
		qty,
	}: {
		recipient: string;
		qty?: number;
	}): Promise<string> {
		if (qty && qty > this.maxQty) {
			throw new Error(
				`Quantity must be less than or equal to max quantity of ${this.maxQty}`,
			);
		}

		// TODO: check the managing wallet has the required balance - this could be reduced into a stateful value that ensures the wallet is never overdrawn
		// TODO: add captcha support with a third party integration like cloudflare or google reCAPTCHA to verify proof of human interaction

		const payload = {
			address: this.wallet.n,
			processId: this.processId,
			qty: qty ?? this.defaultQty,
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
	}: {
		token: string;
	}): Promise<{ id: string; status: string; error?: string }> {
		const isValid = await this.verify(token);
		if (!isValid) {
			throw new Error('Invalid token');
		}

		const { payload: payloadString } = JSON.parse(
			Buffer.from(token, 'base64').toString('utf8'),
		);
		const { recipient, qty, nonce } = JSON.parse(payloadString);

		// assuming token follows token spec, transfer should work
		const msgId = await this.ao.message({
			process: this.processId,
			signer: this.signer,
			tags: [
				{ name: 'Action', value: 'Transfer' },
				{ name: 'Recipient', value: recipient },
				{
					name: 'Quantity',
					value: qty.toString(),
				},
			],
		});

		// check the result
		const transferResult = await this.ao.result({
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
