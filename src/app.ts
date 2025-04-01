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
import cors from '@koa/cors';
import Koa from 'koa';
import bodyParser from 'koa-bodyparser';
import * as config from './config.js';
import logger from './logger.js';
import {
	errorMiddleware,
	loggerMiddleware,
	rateLimitMiddleware,
} from './middleware/index.js';
import router from './router.js';
import { walletAddress } from './system.js';

const app = new Koa();

// attach middlewares
app.use(loggerMiddleware);
app.use(errorMiddleware);
app.use(rateLimitMiddleware);
app.use(cors());
app.use(bodyParser());
app.use(router.routes());

// on SIGINT, SIGTERM, or SIGQUIT, close the server
process.on('SIGINT', () => {
	logger.info('Server closed');
	process.exit(0);
});

// on SIGTERM, close the server
process.on('SIGTERM', () => {
	logger.info('Server closed');
	process.exit(0);
});

// on uncaughtException, close the server
process.on('uncaughtException', (error) => {
	logger.error('Uncaught exception:', error);
});

// Start server
app.listen(config.PORT, '0.0.0.0', () => {
	logger.info(`Listening on port ${config.PORT} with address ${walletAddress}`);
});

export default app;
