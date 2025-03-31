import rateLimit from 'koa-ratelimit';
import * as config from '../config.js';

// rate limit middleware
export const rateLimitMiddleware = rateLimit({
	driver: 'memory',
	db: new Map(),
	errorMessage: 'Too many requests, please try again later.',
	id: (ctx) => ctx.ip,
	duration: config.RATE_LIMIT_WINDOW_MS,
	max: config.RATE_LIMIT_THRESHOLD,
	disableHeader: false,
});
