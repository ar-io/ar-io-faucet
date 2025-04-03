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
	issuer: string;
	processId: string;
	iat: number;
	exp: number;
	nonce: string;
}

export interface TokenCache {
	get(nonce: string): Promise<TokenPayload | null>;
	set(nonce: string, token: TokenPayload): Promise<void>;
	delete(nonce: string): Promise<void>;
	clear(): Promise<void>;
	size(): Promise<number>;
}

export const AuthTokenRequestSchema = z.object({
	processId: z.string().min(43, 'Process ID is required'),
});

export const CaptchaRequestSchema = z.object({
	processId: z.string().min(43, 'Process ID is required'),
	captchaResponse: z.string().min(1, 'Captcha response is required'),
});

export const ClaimRequestSchema = z.object({
	processId: z.string().min(43, 'Process ID is required'),
	recipient: z.string().min(1, 'Recipient is required'),
	qty: z.number().min(1, 'Quantity is required'),
	captchaResponse: z.string().min(1, 'Captcha response is required'),
});

export const AsyncClaimRequestSchema = z.object({
	processId: z.string().min(43, 'Process ID is required'),
	recipient: z.string().min(1, 'Recipient is required'),
	qty: z.number().min(1, 'Quantity is required'),
});

export type AuthTokenRequest = z.infer<typeof AuthTokenRequestSchema>;
export type ClaimRequest = z.infer<typeof ClaimRequestSchema>;
export type AsyncClaimRequest = z.infer<typeof AsyncClaimRequestSchema>;
