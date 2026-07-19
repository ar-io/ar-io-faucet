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
import crypto from 'node:crypto';
import type { Context, Next } from 'koa';
import logger from '../logger.js';

export async function loggerMiddleware(ctx: Context, next: Next) {
	const trace = crypto.randomUUID().substring(0, 6);
	const log = logger.child({
		trace,
		path: ctx.path,
		method: ctx.method,
		params: ctx.params,
		// client ip (Koa-parsed from X-Forwarded-For when TRUST_PROXY is on) so
		// every downstream log line — claims, denials, errors — is attributable.
		ip: ctx.ip,
	});
	ctx.state.logger = log;
	ctx.state.trace = trace;
	const startTime = Date.now();
	await next();
	const duration = Date.now() - startTime;
	// Access log at info so normal traffic is visible in production (LOG_LEVEL
	// defaults to info, at which the previous debug line was silent). Skip the
	// health-check to avoid flooding the logs with uptime-probe noise.
	if (ctx.path !== '/healthcheck') {
		log.info('Completed request.', {
			status: ctx.status,
			responseTime: `${duration}ms`,
		});
	}
}
