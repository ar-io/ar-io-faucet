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
	constructor({ ttlSeconds }: { ttlSeconds: number }) {
		// NOTE: no `maxKeys` cap. A bounded NodeCache THROWS on the set() that
		// overflows it, which — if it happened while recording a consumed nonce
		// after a successful on-chain transfer — would leave the nonce unrecorded
		// and open the door to replay. In-flight nonces are naturally bounded by
		// the token TTL (stdTTL) + rate limits, so eviction-by-TTL is sufficient.
		this.cache = new NodeCache({
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

	// Atomic set-if-absent. Synchronous by design: the has()-check and the set()
	// happen in a single critical section with no await in between, so two
	// concurrent claims carrying the same nonce cannot both observe it as absent.
	// Returns true if this caller reserved the nonce, false if it was already
	// present (i.e. already reserved/consumed → reject the claim as a replay).
	reserve(nonce: string, token: TokenPayload): boolean {
		if (this.cache.has(nonce)) {
			return false;
		}
		this.cache.set(nonce, token);
		return true;
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
