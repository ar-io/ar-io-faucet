import type { InFlightTokenPayload, TokenCache } from '../types.js';
import NodeCache from 'node-cache';

export class InMemoryTokenCache implements TokenCache {
	private cache: NodeCache;
	constructor({
		maxSize,
		ttlSeconds,
	}: { maxSize: number; ttlSeconds: number }) {
		this.cache = new NodeCache({
			maxKeys: maxSize,
			checkperiod: 0,
			useClones: false,
			stdTTL: ttlSeconds,
		});
	}

	async get(nonce: string): Promise<InFlightTokenPayload | null> {
		return this.cache.get(nonce) ?? null;
	}

	async set(nonce: string, token: InFlightTokenPayload): Promise<void> {
		this.cache.set(nonce, token);
	}

	async delete(nonce: string): Promise<void> {
		this.cache.del(nonce);
	}

	async clear(): Promise<void> {
		this.cache.flushAll();
	}

	async size(): Promise<number> {
		return this.cache.getStats().ksize;
	}
}

// TODO: LMDB Token Cache
// TODO: Redis Token Cache
// TODO: Postgres Token Cache
// TODO: SQLite Token Cache
// TODO: File System Token Cache
