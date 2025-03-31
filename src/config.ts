import { JWKInterface } from '@dha-team/arbundles';
import fs from 'fs';

// server config
export const PORT = process.env.PORT || 3000;

// token config 
export const TOKEN_EXPIRATION_SECONDS = +(process.env.TOKEN_EXPIRATION_SECONDS || 3600); // 1 hour
// TODO: constraints on the testnet token minting/token generation

// wallet config
export const WALLET_FILE = process.env.WALLET_FILE;
if (!WALLET_FILE) {
  throw new Error('WALLET_FILE is not set');
}
export const WALLET: JWKInterface = JSON.parse(fs.readFileSync(WALLET_FILE, 'utf8'));

// logging config
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
export const LOG_FORMAT = process.env.LOG_FORMAT || 'json';
