import cors from '@koa/cors';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import * as config from './config.js';
import logger from './logger.js';
import { loggerMiddleware } from './middleware/index.js';
import { rateLimitMiddleware } from './middleware/ratelimit.js';
import router from './router.js';
const app = new Koa();

// attach middlewares
app.use(loggerMiddleware);
app.use(rateLimitMiddleware);
app.use(cors());
app.use(bodyParser());
app.use(router.routes());

// on SIGINT, SIGTERM, or SIGQUIT, close the server
process.on('SIGINT', () => {
	logger.info('Server closed');
	app.context.server.close();
});

// on SIGTERM, close the server
process.on('SIGTERM', () => {
	logger.info('Server closed');
	app.context?.server?.close();
});

// on uncaughtException, close the server
process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
});

// Start server
app.listen(config.PORT, () => {
	logger.info(`Server running on port ${config.PORT}`);
});

export default app;
