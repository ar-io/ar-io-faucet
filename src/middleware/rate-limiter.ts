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
import * as config from '../config.js';

// Resolve the client identity for rate limiting.
//
// SECURITY: never key on the FIRST CHARACTER of X-Forwarded-For (the previous
// `xff?.[0]` bug indexed the string, so every client whose XFF started with the
// same character shared a bucket — and a spoofed XFF fully bypassed the limit).
// When TRUST_PROXY is enabled the app sets `app.proxy = true` (see app.ts) and
// Koa parses X-Forwarded-For for us — so we just use `ctx.ip`. When it is NOT
// enabled we ignore the attacker-controllable XFF entirely and use the socket
// address. As a defensive fallback (proxy trusted but ctx.ip empty) we parse the
// FIRST comma-separated IP, not the first character.
//
// `trustProxy` is passed explicitly (defaulting to the config value) so this pure
// key-derivation logic is unit-testable across both branches without mutating
// process-wide config.
// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
export function clientId(ctx: any, trustProxy = config.TRUST_PROXY): string {
	if (trustProxy) {
		if (ctx.ip) {
			return ctx.ip;
		}
		const xff = ctx.headers['x-forwarded-for'];
		const first = Array.isArray(xff) ? xff[0] : xff?.split(',')[0]?.trim();
		return first || ctx.ip;
	}
	return ctx.ip;
}

// global rate limit middleware
export const rateLimitMiddleware = rateLimit({
	driver: 'memory',
	db: new Map(),
	id: (ctx) => clientId(ctx),
	duration: config.GLOBAL_RATE_LIMIT_WINDOW_SECONDS * 1000,
	max: config.GLOBAL_RATE_LIMIT_THRESHOLD,
	disableHeader: false,
	whitelist: (ctx) => {
		// don't rate limit requests to satisfy captcha in the UI
		return (
			ctx.path.startsWith('/captcha') || ctx.path.startsWith('/healthcheck')
		);
	},
});
