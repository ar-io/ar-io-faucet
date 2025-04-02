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
import NodeCache from 'node-cache';
import type { TokenCache, TokenPayload } from '../types.js';

export class NodeTokenCache implements TokenCache {
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

	async get(nonce: string): Promise<TokenPayload | null> {
		return this.cache.get(nonce) ?? null;
	}

	async set(nonce: string, token: TokenPayload): Promise<void> {
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
