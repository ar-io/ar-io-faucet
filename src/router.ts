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
import rateLimit from 'koa-ratelimit';
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
import { BadRequestError } from './errors.js';
import { captcha, supportedProcesses } from './system.js';
import {
	AsyncClaimRequestSchema,
	CaptchaRequestSchema,
	ClaimRequestSchema,
} from './types.js';

const router = new Router();

// health check endpoint
router.get('/healthcheck', async (ctx) => {
	ctx.body = { status: 'ok' };
});

// route to request auth URL for satisfying captcha
router.get('/api/captcha/request', async (ctx) => {
	const { 'process-id': processId } = ctx.query as {
		'process-id': string;
	};

	if (!processId) {
		throw new BadRequestError('Process ID is required');
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	// return the URL and temporary token
	ctx.body = {
		processId,
		captchaUrl: `${config.FRONT_END_URL}/captcha?process-id=${processId}`,
	};
});

router.get('/captcha', async (ctx) => {
	const { 'process-id': processId } = ctx.query as {
		'process-id': string;
	};

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	// render the captcha page with the token
	await ctx.render('captcha', {
		captchaSiteKey: config.CAPTCHA_SITE_KEY,
		processId,
	});
});

// verify a captcha response and return an auth token good for 1 hour
router.post(
	'/api/captcha/verify',
	rateLimit({
		driver: 'memory',
		db: new Map(),
		duration: config.CAPTCHA_RATE_LIMIT_WINDOW_SECONDS * 1000,
		max: config.CAPTCHA_RATE_LIMIT_THRESHOLD, // 1 request per window
		disableHeader: false,
	}),
	async (ctx) => {
		const parsedCaptchaRequest = CaptchaRequestSchema.safeParse(
			ctx.request.body,
		);
		if (!parsedCaptchaRequest.success) {
			ctx.status = 400;
			ctx.body = { error: parsedCaptchaRequest.error.message };
			return;
		}

		const { processId, captchaResponse } = parsedCaptchaRequest.data;

		const faucet = supportedProcesses.get(processId);
		if (!faucet) {
			throw new BadRequestError('Process not supported.');
		}

		if (config.REQUIRE_CAPTCHA_VERIFICATION && captcha) {
			const captchaResult = await captcha.verifyCaptchaResponse({
				captchaResponse,
				remoteip: ctx.ip,
			});

			if (!captchaResult) {
				throw new BadRequestError('Captcha verification failed');
			}
		}

		// now create a token they can use to claim tokens
		const token = await faucet.requestAuthToken();
		ctx.body = {
			status: 'success',
			token: token.token,
			expiresAt: token.expiresAt,
		};
	},
);

// verify an existing auth token
router.get('/api/token/verify', async (ctx) => {
	const authorization = ctx.request.headers.authorization;
	if (!authorization) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}

	const authToken = authorization.split(' ')[1];

	const { processId } = ctx.query as {
		processId: string;
	};

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	const { valid, payload } = await faucet.verifyAuthToken({ token: authToken });
	ctx.body = { valid, expiresAt: payload.exp };
});

// claim tokens to a recipient using an authorization token
router.post('/api/claim/async', async (ctx) => {
	const authorization = ctx.request.headers.authorization;
	if (!authorization) {
		ctx.status = 401;
		ctx.body = { error: 'Unauthorized' };
		return;
	}

	const authToken = authorization.split(' ')[1];

	// parse the request body
	const claimRequest = AsyncClaimRequestSchema.safeParse(ctx.request.body);
	if (!claimRequest.success) {
		throw new BadRequestError(claimRequest.error.message);
	}

	const { recipient, qty, processId } = claimRequest.data;
	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	const { valid } = await faucet.verifyAuthToken({ token: authToken });
	if (!valid) {
		ctx.status = 401;
		ctx.body = { error: 'Invalid token' };
		return;
	}

	const { id, status } = await faucet.claim({
		recipient,
		qty,
	});

	ctx.body = { id, status };
});

// claim tokens to a recipient using a captcha response
router.post('/api/claim/sync', async (ctx) => {
	const claimRequest = ClaimRequestSchema.safeParse(ctx.request.body);
	if (!claimRequest.success) {
		throw new BadRequestError(claimRequest.error.message);
	}

	const { recipient, qty, processId, captchaResponse } = claimRequest.data;

	if (config.REQUIRE_CAPTCHA_VERIFICATION && captcha) {
		const captchaResult = await captcha.verifyCaptchaResponse({
			captchaResponse,
			remoteip: ctx.ip,
		});
		if (!captchaResult) {
			throw new BadRequestError('Captcha verification failed');
		}
	}

	const faucet = supportedProcesses.get(processId);
	if (!faucet) {
		throw new BadRequestError('Process not supported.');
	}

	const { id, status } = await faucet.claim({
		recipient,
		qty,
	});

	ctx.body = { id, status };
});

export default router;
