import assert from 'node:assert';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import {
	GenericContainer,
	type StartedTestContainer,
	Wait,
} from 'testcontainers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const context = path.resolve(__dirname, '../../');
describe('faucet api', async () => {
	let container: StartedTestContainer;

	before(async () => {
		const builtContainer =
			await GenericContainer.fromDockerfile(context).build();

		container = await builtContainer
			.withExposedPorts(3000)
			.withEnvironment({
				PORT: '3000',
				WALLET_FILE: path.resolve(__dirname, '../../wallet.json'),
				LOG_LEVEL: 'debug',
				LOG_FORMAT: 'json',
			})
			.start();

		console.log(`API is running at ${container.getMappedPort(3000)}`);
	});

	after(async () => {
		await container?.stop();
	});

	it('should respond to health check endpoint', async () => {
		const response = await axios.get(
			`http://${container.getHost()}:${container.getMappedPort(3000)}/healthcheck`,
		);
		assert.strictEqual(response.status, 200);
		assert.strictEqual(response.data.status, 'ok');
	});
});
