import assert from 'node:assert';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from 'testcontainers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const context = path.resolve(__dirname, '../../');
const wallet = path.resolve(__dirname, '../../wallets/wallet.json');

describe('faucet api', async () => {
	let container: StartedTestContainer;

	before(async () => {
		const builtContainer =
			await GenericContainer.fromDockerfile(context).build();

		container = await builtContainer
			.withExposedPorts(3000)
			.withEnvironment({
				PORT: '3000',
				WALLET_FILE: wallet,
				LOG_LEVEL: 'debug',
				LOG_FORMAT: 'json',
			})
			.withWaitStrategy(Wait.forHttp('/healthcheck', 3000).forStatusCode(200))
			.start();
	});

	after(async () => {
		await container?.stop();
	});

	it('should respond to health check endpoint', async () => {
		const response = await fetch(
			`http://${container.getHost()}:${container.getMappedPort(3000)}/healthcheck`,
		);
		assert.strictEqual(response.status, 200);
	});
});
