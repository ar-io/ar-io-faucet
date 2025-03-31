import rateLimit from 'koa-ratelimit';
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from '../config.js';

// rate limit middleware
export const rateLimitMiddleware = rateLimit({
	driver: 'memory',
	db: new Map(),
	errorMessage: 'Too many requests, please try again later.',
	id: (ctx) => ctx.ip,
	duration: RATE_LIMIT_WINDOW_MS,
	max: RATE_LIMIT_MAX,
	disableHeader: false,
});
