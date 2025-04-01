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
		}),
	],
]);
