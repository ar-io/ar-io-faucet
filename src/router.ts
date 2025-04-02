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
import Router from 'koa-router';
import * as config from './config.js';
import { supportedProcesses } from './system.js';
import { AuthTokenRequestSchema, DripRequestSchema } from './types.js';

const router = new Router();

// health check endpoint
router.get('/healthcheck', async (ctx) => {
	ctx.body = { status: 'ok' };
});

// request an authorization token
router.post('/api/request', async (ctx) => {
	const tokenRequest = AuthTokenRequestSchema.safeParse(ctx.request.body);

	if (!tokenRequest.success) {
		ctx.status = 400;
		ctx.body = { error: tokenRequest.error.message };
		return;
	}

	const { processId, captchaResponse, sync } = tokenRequest.data;

	if (!config.DISABLE_CAPTCHA_VERIFICATION) {
		if (!captchaResponse) {
			ctx.status = 400;
			ctx.body = { error: 'Captcha response is required' };
			return;
		}

		const queryParams = new URLSearchParams({
			secret: config.CAPTCHA_SECRET_KEY as string,
			response: captchaResponse,
			remoteip: ctx.ip,
		});

		const captchaResult = await fetch(
			`${config.CAPTCHA_SITE_VERIFY_URL}?${queryParams.toString()}`,
			{
				method: 'POST',
			},
		);

		const captchaResultJson = await captchaResult.json();

		if (!captchaResultJson.success) {
			ctx.status = 400;
			ctx.body = { error: 'Captcha verification failed' };
			return;
		}
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		ctx.status = 400;
		ctx.body = { error: 'Process not supported.' };
		return;
	}
	const authToken = await faucet.request();

	// if not sync, return just the auth token
	if (!sync) {
		ctx.body = { token: authToken };
		return;
	}

	// if sync, drip tokens to the recipient
	const dripRequest = DripRequestSchema.safeParse(ctx.request.body);
	if (!dripRequest.success) {
		ctx.status = 400;
		ctx.body = { error: dripRequest.error.message };
		return;
	}

	const { recipient, qty } = dripRequest.data;
	const { id, status, error } = await faucet.drip({
		processId,
		token: authToken,
		recipient,
		qty,
	});

	ctx.body = { id, status, error };
});

// verify an authorization token
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

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		ctx.status = 400;
		ctx.body = { error: 'Process not supported.' };
		return;
	}

	const { valid: isValid } = await faucet.verify({
		token,
	});

	if (!isValid) {
		ctx.status = 400;
		ctx.body = { error: 'Invalid token', success: false };
		return;
	}

	ctx.body = { success: true };
});

// drip tokens to a recipient using an authorization token
router.post('/api/drip', async (ctx) => {
	const authorization = ctx.request.headers.authorization;
	if (!authorization) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}

	const authToken = authorization.split(' ')[1];

	if (!authToken) {
		ctx.status = 400;
		ctx.body = { error: 'Authorization token is required' };
		return;
	}

	const dripRequest = DripRequestSchema.safeParse(ctx.request.body);
	if (!dripRequest.success) {
		ctx.status = 400;
		ctx.body = { error: dripRequest.error.message };
		return;
	}

	const { recipient, qty, processId } = dripRequest.data;

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		ctx.status = 400;
		ctx.body = { error: 'Process not supported.' };
		return;
	}

	const { id, status, error } = await faucet.drip({
		processId,
		token: authToken,
		recipient,
		qty,
	});

	if (error) {
		ctx.status = 503;
		ctx.body = { error: 'Failed to drip tokens', message: error };
		return;
	}

	ctx.body = { id, status, error };
});

export default router;
