import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import axios from 'axios';
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const context = path.resolve(__dirname, '../../');
describe('faucet api', async () => {
  let container: StartedTestContainer;

  before(async () => {
    const builtContainer = await GenericContainer.fromDockerfile(context).build();

    container = await builtContainer
      .withExposedPorts(3000)
      .start();

    console.log(`API is running at ${container.getMappedPort(3000)}`);
  });

  after(async () => {
    await container?.stop();
  });

  it('should respond to health check endpoint', async () => {
    const response = await axios.get(`http://${container.getHost()}:${container.getMappedPort(3000)}/healthcheck`);
    assert.strictEqual(response.status, 200);
    assert.strictEqual(response.data.status, 'ok');
  });
});

