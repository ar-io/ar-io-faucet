import Router from 'koa-router';
import {
	generateToken,
	transferToken,
	verifyTokenAndExpiration,
} from './lib/crypto.js';
import * as config from './config.js';
const router = new Router();

// health check endpoint
router.get('/healthcheck', async (ctx) => {
	ctx.body = { status: 'ok' };
});

router.post('/api/request', async (ctx) => {
	const { recipient } = ctx.request.body as { recipient?: string };

	if (!recipient) {
		ctx.status = 400;
		ctx.body = { error: 'Recipient is required' };
		return;
	}

	const token = await generateToken(recipient);

	ctx.body = { token };
});

router.post('/api/verify', async (ctx) => {
	const { token } = ctx.request.body as { token?: string };

	if (!token) {
		ctx.status = 400;
		ctx.body = { error: 'Token is required' };
		return;
	}

	const { isValid } = await verifyTokenAndExpiration(token);
	if (!isValid) {
		ctx.status = 400;
		ctx.body = { error: 'Invalid token', isValid };
		return;
	}

	ctx.body = { verified: true };
});

router.post('/api/mint', async (ctx) => {
	const { token } = ctx.request.body as { token?: string };

	if (!token) {
		ctx.status = 400;
		ctx.body = { error: 'Token is required' };
		return;
	}

	try {
		const txId = await transferToken({ token, qty: config.TRANSFER_QTY });
		ctx.body = { id: txId, status: 'success' };
	} catch (error: unknown) {
		ctx.status = 503;
		ctx.body = {
			error: 'Failed to mint token',
			message: (error as Error).message,
			stack: (error as Error).stack,
		};
	}
});

export default router;
