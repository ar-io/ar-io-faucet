import {
	ARIO_DEVNET_PROCESS_ID,
	ARIO_TESTNET_PROCESS_ID,
} from '@ar.io/sdk/node';
import { Arweave } from '@dha-team/arbundles';
import { NodeTokenCache } from './cache/token-cache.js';
import { WALLET } from './config.js';
import * as config from './config.js';
import { AoTokenFaucet } from './faucet/faucet.js';

export const arweave = Arweave.init({
	host: 'arweave.net',
	port: 443,
	protocol: 'https',
});

export const supportedProcesses = new Map<string, AoTokenFaucet>([
	[
		ARIO_TESTNET_PROCESS_ID,
		new AoTokenFaucet({
			cache: new NodeTokenCache({
				maxSize: config.DEFAULT_FAUCET_TOKEN_CACHE_SIZE,
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			wallet: WALLET,
			processId: ARIO_TESTNET_PROCESS_ID,
		}),
	],
	[
		ARIO_DEVNET_PROCESS_ID,
		new AoTokenFaucet({
			cache: new NodeTokenCache({
				maxSize: config.DEFAULT_FAUCET_TOKEN_CACHE_SIZE,
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			wallet: WALLET,
			processId: ARIO_DEVNET_PROCESS_ID,
		}),
	],
]);
