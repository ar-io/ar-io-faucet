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
export class BadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'BadRequestError';
	}
}

// Thrown when a transfer has been BROADCAST but its confirmation failed (e.g. a
// blockhash / confirm timeout from sendAndConfirmTransaction). On Solana devnet
// these timeouts routinely fire even though the transaction actually LANDED
// on-chain, so this error is post-broadcast and possibly-successful: the nonce
// MUST be treated as consumed (never rolled back) to prevent a replay /
// double-claim. Distinct from pre-broadcast validation errors (BadRequestError,
// balance checks) which are safe to roll the nonce back for a retry.
export class TransferSendError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransferSendError';
	}
}
