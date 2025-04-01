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
import { z } from 'zod';

export interface TokenPayload {
	address: string;
	recipient: string;
	issuedAt: number;
	expiresAt: number;
	nonce: string;
}

export interface InFlightTokenPayload extends TokenPayload {
	used: boolean;
}

export interface TokenCache {
	get(nonce: string): Promise<InFlightTokenPayload | null>;
	set(nonce: string, token: InFlightTokenPayload): Promise<void>;
	delete(nonce: string): Promise<void>;
	clear(): Promise<void>;
	size(): Promise<number>;
}

export const TokenRequestSchema = z.object({
	recipient: z
		.string()
		.min(26, 'Wallet address must be at least 26 characters')
		.max(64, 'Wallet address must be at most 64 characters')
		.regex(/^\S*$/, 'Wallet address must not contain spaces'),
	processId: z.string().min(43, 'Process ID is required'),
	qty: z
		.number()
		.int('Quantity must be an integer')
		.min(1, 'Quantity must be at least 1')
		.max(10000, 'Quantity must be at most 10,000')
		.optional()
		.default(10000),
	captchaResponse: z.string().min(1, 'Captcha response is required').optional(),
});

export type TokenRequest = z.infer<typeof TokenRequestSchema>;
