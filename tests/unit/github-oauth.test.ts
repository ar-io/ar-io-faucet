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

// Unit tests for the required GitHub OAuth gate:
//   (a) CSRF/state single-use consume (NodeStateStore)
//   (b) account-age rejection (GitHubOAuthClient.assertAccountOldEnough)
//   (c) per-account claim limiting (GithubClaimStore)
//   (d) code-exchange / user-fetch against a MOCKED GitHub API (global.fetch).
//
// The GitHub API is never hit: global.fetch is replaced with a stub per test.

import assert from 'node:assert';
import { afterEach, describe, it, mock } from 'node:test';
import { GitHubOAuthClient } from '../../src/auth/github-oauth.js';
import {
	GithubClaimStore,
	NodeStateStore,
} from '../../src/auth/state-store.js';

const DAY_MS = 86_400_000;

function makeClient(overrides: Partial<Record<string, unknown>> = {}) {
	return new GitHubOAuthClient({
		clientId: 'client-id',
		clientSecret: 'client-secret',
		callbackUrl: 'https://faucet.example/api/auth/github/callback',
		apiBaseUrl: 'https://api.github.test',
		authorizeUrl: 'https://github.test/login/oauth/authorize',
		tokenUrl: 'https://github.test/login/oauth/access_token',
		minAccountAgeDays: 30,
		...(overrides as Record<string, never>),
	});
}

// Install a fetch stub that returns a queued sequence of responses.
function stubFetch(
	handlers: Array<
		(url: string, init?: RequestInit) => { status: number; body: unknown }
	>,
) {
	let call = 0;
	const fn = mock.fn(async (url: string, init?: RequestInit) => {
		const handler = handlers[Math.min(call, handlers.length - 1)];
		call += 1;
		const { status, body } = handler(url, init);
		return {
			ok: status >= 200 && status < 300,
			status,
			json: async () => body,
		} as unknown as Response;
	});
	// biome-ignore lint/suspicious/noExplicitAny: test override of global fetch
	(globalThis as any).fetch = fn;
	return fn;
}

const realFetch = globalThis.fetch;
afterEach(() => {
	globalThis.fetch = realFetch;
});

describe('NodeStateStore (CSRF/state)', () => {
	it('consume() returns the bound payload exactly once (single-use)', () => {
		const store = new NodeStateStore({ ttlSeconds: 600 });
		const state = store.generateState('solana-devnet');
		assert.strictEqual(store.consume(state), 'solana-devnet');
		// replaying the same state is rejected
		assert.strictEqual(store.consume(state), null);
	});

	it('consume() rejects an unknown/forged state value', () => {
		const store = new NodeStateStore({ ttlSeconds: 600 });
		assert.strictEqual(store.consume('forged-state-value'), null);
	});

	it('generateState defaults payload to "true" when none provided', () => {
		const store = new NodeStateStore({ ttlSeconds: 600 });
		const state = store.generateState();
		assert.strictEqual(store.consume(state), 'true');
	});

	it('rejects a state that has expired (TTL elapsed)', () => {
		const store = new NodeStateStore({ ttlSeconds: 1 });
		const state = store.generateState('solana-devnet');
		// force-expire by reaching into the underlying cache TTL
		// biome-ignore lint/suspicious/noExplicitAny: access private cache for TTL manipulation
		const cache = (store as any).cache;
		cache.ttl(state, -1); // set to already-expired
		assert.strictEqual(store.consume(state), null);
	});
});

describe('GithubClaimStore (per-account claim limiting)', () => {
	it('has() is false before a claim and true after record()', () => {
		const store = new GithubClaimStore({ ttlSeconds: 3600 });
		assert.strictEqual(store.has(42), false);
		store.record(42);
		assert.strictEqual(store.has(42), true);
	});

	it('normalizes numeric and string github ids to the same key', () => {
		const store = new GithubClaimStore({ ttlSeconds: 3600 });
		store.record(42);
		assert.strictEqual(store.has('42'), true);
	});

	it('does not limit a different github id', () => {
		const store = new GithubClaimStore({ ttlSeconds: 3600 });
		store.record(42);
		assert.strictEqual(store.has(99), false);
	});

	it('clears the limit once the TTL window elapses', () => {
		const store = new GithubClaimStore({ ttlSeconds: 1 });
		store.record(42);
		assert.strictEqual(store.has(42), true);
		// biome-ignore lint/suspicious/noExplicitAny: access private cache for TTL manipulation
		const cache = (store as any).cache;
		cache.ttl('42', -1);
		assert.strictEqual(store.has(42), false);
	});
});

describe('GitHubOAuthClient.assertAccountOldEnough (account-age gate)', () => {
	it('accepts an account older than the minimum age', () => {
		const client = makeClient();
		const old = new Date(Date.now() - 400 * DAY_MS).toISOString();
		assert.doesNotThrow(() => client.assertAccountOldEnough(old));
	});

	it('rejects an account younger than the minimum age', () => {
		const client = makeClient();
		const young = new Date(Date.now() - 5 * DAY_MS).toISOString();
		assert.throws(
			() => client.assertAccountOldEnough(young),
			/GitHub account too new/,
		);
	});

	it('rejects at exactly one day under the threshold', () => {
		const client = makeClient({ minAccountAgeDays: 30 });
		const created = new Date(Date.now() - 29 * DAY_MS).toISOString();
		assert.throws(
			() => client.assertAccountOldEnough(created),
			/min 30 days/,
		);
	});

	it('rejects an unparseable created_at value', () => {
		const client = makeClient();
		assert.throws(
			() => client.assertAccountOldEnough('not-a-date'),
			/Unable to determine GitHub account age/,
		);
	});
});

describe('GitHubOAuthClient.buildAuthorizeUrl', () => {
	it('embeds the state and read:user scope', () => {
		const client = makeClient();
		const url = new URL(client.buildAuthorizeUrl('state-123'));
		assert.strictEqual(url.searchParams.get('state'), 'state-123');
		assert.strictEqual(url.searchParams.get('scope'), 'read:user');
		assert.strictEqual(url.searchParams.get('client_id'), 'client-id');
		assert.strictEqual(
			url.searchParams.get('redirect_uri'),
			'https://faucet.example/api/auth/github/callback',
		);
	});
});

describe('GitHubOAuthClient.exchangeCode (mocked GitHub API)', () => {
	it('returns the access token on success', async () => {
		stubFetch([() => ({ status: 200, body: { access_token: 'gho_abc' } })]);
		const client = makeClient();
		assert.strictEqual(await client.exchangeCode('code-1'), 'gho_abc');
	});

	it('throws on a non-2xx token response', async () => {
		stubFetch([() => ({ status: 401, body: {} })]);
		const client = makeClient();
		await assert.rejects(
			() => client.exchangeCode('code-1'),
			/Failed to exchange GitHub OAuth code/,
		);
	});

	it('throws when the token response omits access_token', async () => {
		stubFetch([
			() => ({
				status: 200,
				body: { error: 'bad_verification_code', error_description: 'nope' },
			}),
		]);
		const client = makeClient();
		await assert.rejects(
			() => client.exchangeCode('code-1'),
			/Failed to obtain GitHub access token: nope/,
		);
	});
});

describe('GitHubOAuthClient.fetchUser (mocked GitHub API)', () => {
	it('returns id/login/created_at on success', async () => {
		stubFetch([
			() => ({
				status: 200,
				body: {
					id: 12345,
					login: 'octocat',
					created_at: '2015-01-01T00:00:00Z',
				},
			}),
		]);
		const client = makeClient();
		const user = await client.fetchUser('gho_abc');
		assert.deepStrictEqual(user, {
			id: 12345,
			login: 'octocat',
			created_at: '2015-01-01T00:00:00Z',
		});
	});

	it('throws on a non-2xx user response', async () => {
		stubFetch([() => ({ status: 403, body: {} })]);
		const client = makeClient();
		await assert.rejects(
			() => client.fetchUser('gho_abc'),
			/Failed to fetch GitHub user/,
		);
	});

	it('throws on an incomplete user profile (missing created_at)', async () => {
		stubFetch([
			() => ({ status: 200, body: { id: 1, login: 'octocat' } }),
		]);
		const client = makeClient();
		await assert.rejects(
			() => client.fetchUser('gho_abc'),
			/Incomplete GitHub user profile/,
		);
	});
});

describe('GitHub OAuth gate end-to-end (units composed, GitHub API mocked)', () => {
	it('a fresh account passes state + exchange + fetch + age + first claim, then is limited', async () => {
		const stateStore = new NodeStateStore({ ttlSeconds: 600 });
		const claimStore = new GithubClaimStore({ ttlSeconds: 3600 });
		const client = makeClient();

		// begin flow: bind processId into state
		const state = stateStore.generateState('solana-devnet');

		// mocked GitHub API: token exchange then user lookup
		stubFetch([
			() => ({ status: 200, body: { access_token: 'gho_abc' } }),
			() => ({
				status: 200,
				body: {
					id: 777,
					login: 'octocat',
					created_at: new Date(Date.now() - 365 * DAY_MS).toISOString(),
				},
			}),
		]);

		// callback: consume state (CSRF)
		const processId = stateStore.consume(state);
		assert.strictEqual(processId, 'solana-devnet');

		const accessToken = await client.exchangeCode('code-xyz');
		const user = await client.fetchUser(accessToken);
		assert.doesNotThrow(() => client.assertAccountOldEnough(user.created_at));

		// first claim allowed
		assert.strictEqual(claimStore.has(user.id), false);
		claimStore.record(user.id);

		// second attempt in the same window is limited
		assert.strictEqual(claimStore.has(user.id), true);
	});

	it('a replayed state is rejected before any GitHub call', async () => {
		const stateStore = new NodeStateStore({ ttlSeconds: 600 });
		const fetchFn = stubFetch([() => ({ status: 200, body: {} })]);

		const state = stateStore.generateState('solana-devnet');
		assert.strictEqual(stateStore.consume(state), 'solana-devnet');
		// forged replay
		assert.strictEqual(stateStore.consume(state), null);
		// no GitHub API traffic happened for the replay path
		assert.strictEqual(fetchFn.mock.callCount(), 0);
	});

	it('a too-young account is rejected after the mocked user fetch', async () => {
		const client = makeClient();
		stubFetch([
			() => ({ status: 200, body: { access_token: 'gho_abc' } }),
			() => ({
				status: 200,
				body: {
					id: 888,
					login: 'newbie',
					created_at: new Date(Date.now() - 3 * DAY_MS).toISOString(),
				},
			}),
		]);

		const accessToken = await client.exchangeCode('code');
		const user = await client.fetchUser(accessToken);
		assert.throws(
			() => client.assertAccountOldEnough(user.created_at),
			/GitHub account too new/,
		);
	});
});
