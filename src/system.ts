import {
	ARIO_DEVNET_PROCESS_ID,
	ARIO_TESTNET_PROCESS_ID,
} from '@ar.io/sdk/node';
import { Arweave, ArweaveSigner } from '@dha-team/arbundles';
import { WALLET } from './config.js';
import { InMemoryTokenCache } from './cache/token-cache.js';
import * as config from './config.js';
import { AoTokenFaucet } from './faucet/faucet.js';

export const signer = new ArweaveSigner(WALLET);
export const arweave = Arweave.init({
	host: 'arweave.net',
	port: 443,
	protocol: 'https',
});

export const supportedProcesses = new Map<string, AoTokenFaucet>([
	[
		ARIO_TESTNET_PROCESS_ID,
		new AoTokenFaucet({
			cache: new InMemoryTokenCache({
				maxSize: config.DEFAULT_FAUCET_TOKEN_CACHE_SIZE,
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			processId: ARIO_TESTNET_PROCESS_ID,
		}),
	],
	[
		ARIO_DEVNET_PROCESS_ID,
		new AoTokenFaucet({
			cache: new InMemoryTokenCache({
				maxSize: config.DEFAULT_FAUCET_TOKEN_CACHE_SIZE,
				ttlSeconds: config.DEFAULT_FAUCET_TOKEN_EXPIRATION_SECONDS,
			}),
			processId: ARIO_DEVNET_PROCESS_ID,
		}),
	],
]);
