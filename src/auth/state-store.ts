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

// Value bound into an OAuth state entry: which faucet the flow targets plus the
// initiating browser session id, so the issued claim token can be bound to the
// session that started the flow (defends against token injection / CSRF).
export interface OAuthStateValue {
	processId: string;
	// initiating session id (matches the `faucet_sid` cookie set at login)
	sid: string;
}

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

	// Generate a random state value, binding the target faucet (processId) and
	// the initiating session id so the callback can (a) route to the right faucet
	// and (b) bind the issued token to the session that started the flow.
	generateState(value: OAuthStateValue): string {
		const state = crypto.randomUUID();
		this.cache.set(state, value);
		return state;
	}

	// Return the bound value and delete the state (one-time use). Returns null
	// if the state is unknown or expired.
	consume(state: string): OAuthStateValue | null {
		const value = this.cache.get<OAuthStateValue>(state);
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

	// Atomic, synchronous set-if-absent. Returns true if this caller reserved the
	// githubId, false if it was already reserved/recorded. Used to claim the
	// per-githubId slot BEFORE the transfer so concurrent claims sharing a
	// githubId cannot all pass. The has()-check and set() run in a single
	// critical section with no await in between.
	reserve(githubId: number | string): boolean {
		if (this.cache.has(String(githubId))) {
			return false;
		}
		this.cache.set(String(githubId), true);
		return true;
	}

	// Roll back a reservation. Only call on a definitive transfer failure so a
	// legitimate user can retry within the window.
	release(githubId: number | string): void {
		this.cache.del(String(githubId));
	}
}
