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

const router = new Router();

// health check endpoint
router.get('/healthcheck', async (ctx) => {
	ctx.body = { status: 'ok' };
});

// request an authorization token
router.post('/api/request', async (ctx) => {
	const { recipient, processId, qty, captchaResponse } = ctx.request.body as {
		recipient?: string;
		processId?: string;
		qty?: number;
		captchaResponse?: string;
	};

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
	const token = await faucet.request({
		recipient,
		qty: qty ? +qty : undefined,
	});

	ctx.body = { token };
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

	const isValid = await supportedProcesses.get(processId)?.verify(token);
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

	const token = authorization.split(' ')[1];
	const { processId } = ctx.request.body as {
		processId?: string;
	};

	if (!token) {
		ctx.status = 400;
		ctx.body = { error: 'Authorization token is required' };
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

	const { id, status, error } = await faucet.drip({ token });

	if (error) {
		ctx.status = 503;
		ctx.body = { error: 'Failed to drip tokens', message: error };
		return;
	}

	ctx.body = { id, status, error };
});

export default router;
