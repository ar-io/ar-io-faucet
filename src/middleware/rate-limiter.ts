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

// rate limit middleware
export const rateLimitMiddleware = rateLimit({
	driver: 'memory',
	db: new Map(),
	errorMessage: 'Too many requests.',
	id: (ctx) => ctx.ip,
	duration: config.RATE_LIMIT_WINDOW_SECONDS * 1000,
	max: config.RATE_LIMIT_THRESHOLD,
	disableHeader: false,
	// only rate limit the request endpoint
	whitelist: (ctx) => !ctx.path.includes('/request'),
});
