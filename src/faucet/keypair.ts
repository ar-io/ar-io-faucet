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
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';

/**
 * Load a Solana faucet keypair from either a base58-encoded 64-byte secret key
 * or a JSON uint8 array (the two formats emitted by `solana-keygen`).
 */
export function loadFaucetKeypair(secret: string): Keypair {
	const trimmed = secret.trim();

	// JSON uint8 array form, e.g. "[12,34,...]"
	if (trimmed.startsWith('[')) {
		const bytes = Uint8Array.from(JSON.parse(trimmed) as number[]);
		return Keypair.fromSecretKey(bytes);
	}

	// base58-encoded secret key
	return Keypair.fromSecretKey(bs58.decode(trimmed));
}
