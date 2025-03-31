import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import * as config from './config.js';
import cors from '@koa/cors';
import {
  loggerMiddleware,
} from './middleware/index.js';
import router from './router.js';
import { rateLimitMiddleware } from './middleware/ratelimit.js';
const app = new Koa();

// attach middlewares
app.use(loggerMiddleware);
app.use(rateLimitMiddleware);
app.use(cors());
app.use(bodyParser());
app.use(router.routes());

// on SIGINT, SIGTERM, or SIGQUIT, close the server
process.on('SIGINT', () => {
  console.log('Server closed');
  app.context.server.close();
});

// on SIGTERM, close the server
process.on('SIGTERM', () => {
  console.log('Server closed');
  app.context.server.close();
});

// on uncaughtException, close the server
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  app.context.server.close();
});

// Start server
app.listen(config.PORT, () => {
  console.log(`Server running on port ${config.PORT}`);
});

export default app;

