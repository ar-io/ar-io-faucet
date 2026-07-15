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
// MANUAL / opt-in suite (`yarn test:e2e`) — NOT run in CI. It builds and runs the
// Docker image (needs a Docker runtime) AND the token-issuance path requires a
// FUNDED faucet wallet on a real Solana network (the ported code balance-checks
// before issuing a claim token). CI runs `yarn test` = `test:unit` (mocked,
// hermetic). Run this locally against a funded devnet wallet + real mint.
import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

const context = process.cwd();

// Deterministic-enough test fixtures. The faucet only needs a parseable secret
// key + a base58 mint at boot; no on-chain transfer is exercised in these tests.
const TOKEN_ID = 'solana-devnet';
const FAUCET_SECRET_KEY = bs58.encode(Keypair.generate().secretKey);
const TOKEN_MINT = Keypair.generate().publicKey.toBase58();
const AUTH_TOKEN_SECRET = 'test-auth-token-secret';

describe('faucet api', async () => {
	let container: StartedTestContainer;
	let apiUrl: string;

	before(async () => {
		const builtContainer =
			await GenericContainer.fromDockerfile(context).build();

		container = await builtContainer
			.withExposedPorts(3000)
			.withEnvironment({
				REQUIRE_CAPTCHA_VERIFICATION: 'false',
				CAPTCHA_RATE_LIMIT_THRESHOLD: '1000',
				// solana faucet config
				SOLANA_TOKEN_ID: TOKEN_ID,
				SOLANA_TOKEN_MINT: TOKEN_MINT,
				SOLANA_TOKEN_DECIMALS: '6',
				SOLANA_FAUCET_SECRET_KEY: FAUCET_SECRET_KEY,
				AUTH_TOKEN_SECRET,
				// disable the github gate for the non-oauth tests; DEV_PROFILE opts
				// past the startup guard that refuses to boot with the gate off
				GITHUB_OAUTH_ENABLED: 'false',
				DEV_PROFILE: 'true',
			})
			.start();

		apiUrl = `http://${container.getHost()}:${container.getMappedPort(3000)}`;
	});

	after(async () => {
		await container?.stop();
	});

	it('should respond to health check endpoint', async () => {
		const response = await fetch(`${apiUrl}/healthcheck`);
		assert.strictEqual(response.status, 200);
	});

	it('should return an error when process id is not valid', async () => {
		const response = await fetch(`${apiUrl}/api/captcha/url?process-id=test`);
		assert.strictEqual(response.status, 400);
	});

	it('should return a captcha url for a valid process id', async () => {
		const response = await fetch(
			`${apiUrl}/api/captcha/url?process-id=${TOKEN_ID}`,
		);
		assert.strictEqual(response.status, 200);
		const data = await response.json();
		assert.strictEqual(data.processId, TOKEN_ID);
		assert(data.captchaUrl.includes(`/captcha?process-id=${TOKEN_ID}`));
	});

	it('returns an error when captcha is not solved (unsupported process)', async () => {
		const response = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: 'test',
				captchaResponse: 'test',
			}),
		});
		assert.strictEqual(response.status, 400);
	});

	it('returns an auth token when captcha is solved', async () => {
		const now = Date.now();
		const response = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: TOKEN_ID,
				captchaResponse: 'some-test-captcha-response',
			}),
		});
		assert.strictEqual(response.status, 200);
		const data = await response.json();
		assert(data.status === 'success');
		assert(data.token);
		assert(data.expiresAt);
		assert(data.expiresAt > now + 1000 * 60 * 60); // 1 hour
	});

	it('captcha-only token verifies as invalid for claiming (no githubId)', async () => {
		const captchaResponse = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: TOKEN_ID,
				captchaResponse: 'some-test-captcha-response',
			}),
		});
		const captchaData = await captchaResponse.json();
		const verifyResponse = await fetch(
			`${apiUrl}/api/token/verify?process-id=${TOKEN_ID}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${captchaData.token}`,
				},
			},
		);
		assert.strictEqual(verifyResponse.status, 200);
		const verifyData = await verifyResponse.json();
		// verifyAuthToken requires a githubId, so a captcha-only token is invalid
		assert.strictEqual(verifyData.valid, false);
	});

	it('rejects a claim with an invalid Solana recipient address', async () => {
		const captchaResponse = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: TOKEN_ID,
				captchaResponse: 'some-test-captcha-response',
			}),
		});
		const captchaData = await captchaResponse.json();
		const response = await fetch(`${apiUrl}/api/claim/async`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${captchaData.token}`,
			},
			body: JSON.stringify({
				processId: TOKEN_ID,
				// contains invalid base58 chars (0, O, l) and spaces
				recipient: 'not a valid solana address 0OIl',
				qty: 1,
			}),
		});
		// schema-level base58 validation rejects the recipient
		assert.strictEqual(response.status, 400);
	});

	it('rejects async claim with a captcha-only token (no github binding)', async () => {
		const captchaResponse = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: TOKEN_ID,
				captchaResponse: 'some-test-captcha-response',
			}),
		});
		const captchaData = await captchaResponse.json();
		const validRecipient = Keypair.generate().publicKey.toBase58();
		const response = await fetch(`${apiUrl}/api/claim/async`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${captchaData.token}`,
			},
			body: JSON.stringify({
				processId: TOKEN_ID,
				recipient: validRecipient,
				qty: 1,
			}),
		});
		// captcha-only token has no githubId -> invalid for claiming
		assert.strictEqual(response.status, 401);
	});

	// TODO: opt-in E2E happy-path transfer against a funded devnet faucet +
	// created mint (assert recipient ATA balance increases by qty).
	// TODO: nock-based integration tests for the GitHub OAuth callback flow
	// (state/CSRF rejection, account-too-young, per-githubId anti-sybil).
});
