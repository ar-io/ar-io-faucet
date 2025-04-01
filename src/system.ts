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
import {
	ARIO_DEVNET_PROCESS_ID,
	ARIO_TESTNET_PROCESS_ID,
} from '@ar.io/sdk/node';
import { Arweave } from '@dha-team/arbundles/node';
import { connect } from '@permaweb/aoconnect/node';
import { NodeTokenCache } from './cache/token-cache.js';
import * as config from './config.js';
import { AoTokenFaucet } from './faucet/ao-token-faucet.js';

export const arweave = Arweave.init({
	host: 'arweave.net',
	port: 443,
	protocol: 'https',
});

export const ao = connect({
	MODE: 'legacy',
	CU_URL: 'https://cu.ardrive.io',
});

const wallet = config.WALLET
	? JSON.parse(config.WALLET)
	: await arweave.wallets.generate();

export const walletAddress = await arweave.wallets.getAddress(wallet);

export const supportedProcesses = new Map<string, AoTokenFaucet>([
	[
		ARIO_TESTNET_PROCESS_ID,
		new AoTokenFaucet({
			cache: new NodeTokenCache({
				maxSize: config.DEFAULT_FAUCET_TOKEN_CACHE_SIZE,
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			wallet: wallet,
			processId: ARIO_TESTNET_PROCESS_ID,
			ao,
			arweave,
		}),
	],
	[
		ARIO_DEVNET_PROCESS_ID,
		new AoTokenFaucet({
			cache: new NodeTokenCache({
				maxSize: config.DEFAULT_FAUCET_TOKEN_CACHE_SIZE,
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			wallet: wallet,
			processId: ARIO_DEVNET_PROCESS_ID,
			ao,
			arweave,
		}),
	],
]);
