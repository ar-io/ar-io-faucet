import Router from 'koa-router';
import { supportedProcesses } from './system.js';
const router = new Router();

// health check endpoint
router.get('/healthcheck', async (ctx) => {
	ctx.body = { status: 'ok' };
});

router.post('/api/request', async (ctx) => {
	const { recipient, processId } = ctx.request.body as {
		recipient?: string;
		processId?: string;
	};

	if (!recipient) {
		ctx.status = 400;
		ctx.body = { error: 'Recipient is required' };
		return;
	}

	if (!processId) {
		ctx.status = 400;
		ctx.body = { error: 'Process ID is required' };
		return;
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		ctx.status = 400;
		ctx.body = { error: 'Process not supported.' };
		return;
	}

	const token = await faucet.request(recipient);

	ctx.body = { token };
});

router.get('/api/verify', async (ctx) => {
	const { token, processId } = ctx.query as {
		token?: string;
		processId?: string;
	};

	if (!token) {
		ctx.status = 400;
		ctx.body = { error: 'Token is required' };
		return;
	}

	if (!processId) {
		ctx.status = 400;
		ctx.body = { error: 'Process ID is required' };
		return;
	}

	const isValid = await supportedProcesses.get(processId)?.verify(token);
	if (!isValid) {
		ctx.status = 400;
		ctx.body = { error: 'Invalid token', isValid };
		return;
	}

	ctx.body = { verified: true };
});

router.post('/api/mint', async (ctx) => {
	const { token, processId } = ctx.request.body as {
		token?: string;
		processId?: string;
		qty?: number;
	};

	if (!token) {
		ctx.status = 400;
		ctx.body = { error: 'Token is required' };
		return;
	}

	if (!processId) {
		ctx.status = 400;
		ctx.body = { error: 'Process ID is required' };
		return;
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		ctx.status = 400;
		ctx.body = { error: 'Process not supported.' };
		return;
	}

	const { id, status, error } = await faucet.mint({ token });

	if (error) {
		ctx.status = 503;
		ctx.body = { error: 'Failed to mint token', message: error };
		return;
	}

	ctx.body = { id, status, error };
});

export default router;
