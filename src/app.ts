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
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import serve from 'koa-static';
import * as config from './config.js';
import logger from './logger.js';
import {
	errorMiddleware,
	loggerMiddleware,
	rateLimitMiddleware,
} from './middleware/index.js';
import router from './router.js';
import { walletAddress } from './system.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = new Koa();

// static files are not rate limited or logged
app.use(cors());

// enable simple front-end for testing
if (!config.DISABLE_SELF_HOSTED_FRONTEND) {
	app.use(serve(path.join(__dirname, 'public')));
}

// api routes
app.use(loggerMiddleware);
app.use(errorMiddleware);
app.use(rateLimitMiddleware);
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
app.listen(config.PORT, () => {
	logger.info(`Listening on port ${config.PORT} with address ${walletAddress}`);
});

export default app;
