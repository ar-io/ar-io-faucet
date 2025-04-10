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
import assert from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { ARIO_TESTNET_PROCESS_ID } from '@ar.io/sdk';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

const context = process.cwd();

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
				DEFAULT_MIN_FAUCET_TOKEN_TRANSFER_QTY: '0',
				CAPTCHA_RATE_LIMIT_THRESHOLD: '1000',
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
		const response = await fetch(
			`${apiUrl}/api/captcha/request?process-id=test`,
		);
		assert.strictEqual(response.status, 400);
	});

	it('should return a captcha url for a valid process id', async () => {
		const response = await fetch(
			`${apiUrl}/api/captcha/request?process-id=${ARIO_TESTNET_PROCESS_ID}`,
		);
		assert.strictEqual(response.status, 200);
		const data = await response.json();
		assert.strictEqual(data.processId, ARIO_TESTNET_PROCESS_ID);
		assert(
			data.captchaUrl.includes(
				`/captcha?process-id=${ARIO_TESTNET_PROCESS_ID}`,
			),
		);
	});

	it('returns an error when captcha is not solved', async () => {
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
				processId: ARIO_TESTNET_PROCESS_ID,
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

	it('should return valid when auth token is verified', async () => {
		const now = Date.now();
		const response = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: ARIO_TESTNET_PROCESS_ID,
				captchaResponse: 'some-test-captcha-response',
			}),
		});
		assert.strictEqual(response.status, 200);
		const data = await response.json();
		const verifyResponse = await fetch(
			`${apiUrl}/api/token/verify?process-id=${ARIO_TESTNET_PROCESS_ID}`,
			{
				method: 'GET',
				headers: {
					Authorization: `Bearer ${data.token}`,
				},
			},
		);
		assert.strictEqual(verifyResponse.status, 200);
		const verifyData = await verifyResponse.json();
		assert(verifyData.valid);
		assert(verifyData.expiresAt);
		assert(verifyData.expiresAt > now + 1000 * 60 * 60); // 1 hour
	});

	it('should fail claiming tokens when recipient already has significant balance', async () => {
		const captchaResponse = await fetch(`${apiUrl}/api/captcha/verify`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				processId: ARIO_TESTNET_PROCESS_ID,
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
				processId: ARIO_TESTNET_PROCESS_ID,
				recipient: ARIO_TESTNET_PROCESS_ID,
				qty: 0,
			}),
		});
		assert.strictEqual(response.status, 400);
		const data = await response.json();
		assert(
			data.error.includes(
				`Recipient (${ARIO_TESTNET_PROCESS_ID}) already has more than the maximum quantity of tokens allowed (${10000000000}). Please try again later.`,
			),
		);
	});

	// TODO: nock request to mu.ao-testnet.xyz and cu.aot-testnet.xyz and verify the transfers happen on /api/claim/sync and /api/claim/async
});
