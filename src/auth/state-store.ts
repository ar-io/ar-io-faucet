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
import crypto from 'node:crypto';
import NodeCache from 'node-cache';

/**
 * CSRF state store for the GitHub OAuth flow. Backed by NodeCache with a TTL so
 * stale/replayed state values are rejected. State values are single-use
 * (consume() removes them).
 */
export class NodeStateStore {
	private cache: NodeCache;

	constructor({ ttlSeconds }: { ttlSeconds: number }) {
		this.cache = new NodeCache({
			checkperiod: 0,
			useClones: false,
			stdTTL: ttlSeconds,
		});
	}

	// Generate a random state value, optionally binding a payload (e.g. tokenId)
	// so the callback knows which faucet the flow targets.
	generateState(payload: string = 'true'): string {
		const state = crypto.randomUUID();
		this.cache.set(state, payload);
		return state;
	}

	// Return the bound payload and delete the state (one-time use). Returns null
	// if the state is unknown or expired.
	consume(state: string): string | null {
		const value = this.cache.get<string>(state);
		if (value === undefined) {
			return null;
		}
		this.cache.del(state);
		return value;
	}
}

/**
 * Per-GitHub-id anti-sybil store: records that a GitHub account has claimed
 * within the current rate-limit window. Keyed by String(githubId), TTL =
 * GLOBAL_RATE_LIMIT_WINDOW_SECONDS.
 */
export class GithubClaimStore {
	private cache: NodeCache;

	constructor({ ttlSeconds }: { ttlSeconds: number }) {
		this.cache = new NodeCache({
			checkperiod: 0,
			useClones: false,
			stdTTL: ttlSeconds,
		});
	}

	has(githubId: number | string): boolean {
		return this.cache.has(String(githubId));
	}

	record(githubId: number | string): void {
		this.cache.set(String(githubId), true);
	}
}
