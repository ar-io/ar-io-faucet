import assert from 'node:assert';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

const context = process.cwd();

describe('faucet api', async () => {
	let container: StartedTestContainer;

	before(async () => {
		const builtContainer =
			await GenericContainer.fromDockerfile(context).build();

		container = await builtContainer.withExposedPorts(3000).start();
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
