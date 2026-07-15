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
import { BadRequestError } from '../errors.js';

export interface GitHubUser {
	id: number;
	login: string;
	created_at: string;
}

/**
 * Minimal GitHub OAuth client. Config-driven (mirrors hcaptcha.ts) and
 * fetch-based. Provides the authorize-URL builder, code exchange, user lookup,
 * and account-age enforcement used by the required GitHub gate.
 */
export class GitHubOAuthClient {
	private clientId: string;
	private clientSecret: string;
	private callbackUrl: string;
	private apiBaseUrl: string;
	private authorizeUrl: string;
	private tokenUrl: string;
	private minAccountAgeDays: number;

	constructor({
		clientId,
		clientSecret,
		callbackUrl,
		apiBaseUrl,
		authorizeUrl,
		tokenUrl,
		minAccountAgeDays,
	}: {
		clientId: string;
		clientSecret: string;
		callbackUrl: string;
		apiBaseUrl: string;
		authorizeUrl: string;
		tokenUrl: string;
		minAccountAgeDays: number;
	}) {
		this.clientId = clientId;
		this.clientSecret = clientSecret;
		this.callbackUrl = callbackUrl;
		this.apiBaseUrl = apiBaseUrl;
		this.authorizeUrl = authorizeUrl;
		this.tokenUrl = tokenUrl;
		this.minAccountAgeDays = minAccountAgeDays;
	}

	// Build the GitHub authorize URL. scope read:user is enough for id +
	// created_at.
	buildAuthorizeUrl(state: string): string {
		const params = new URLSearchParams({
			client_id: this.clientId,
			redirect_uri: this.callbackUrl,
			scope: 'read:user',
			state,
		});
		return `${this.authorizeUrl}?${params.toString()}`;
	}

	// Exchange an authorization code for an access token.
	async exchangeCode(code: string): Promise<string> {
		const response = await fetch(this.tokenUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify({
				client_id: this.clientId,
				client_secret: this.clientSecret,
				code,
				redirect_uri: this.callbackUrl,
			}),
		});

		if (!response.ok) {
			throw new BadRequestError('Failed to exchange GitHub OAuth code');
		}

		const data = (await response.json()) as {
			access_token?: string;
			error?: string;
			error_description?: string;
		};

		if (!data.access_token) {
			throw new BadRequestError(
				`Failed to obtain GitHub access token${
					data.error ? `: ${data.error_description || data.error}` : ''
				}`,
			);
		}

		return data.access_token;
	}

	// Fetch the authenticated GitHub user. GET /user returns created_at for the
	// authenticated user.
	async fetchUser(accessToken: string): Promise<GitHubUser> {
		const response = await fetch(`${this.apiBaseUrl}/user`, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				Accept: 'application/vnd.github+json',
				'User-Agent': 'ar-io-faucet',
			},
		});

		if (!response.ok) {
			throw new BadRequestError('Failed to fetch GitHub user');
		}

		const data = (await response.json()) as Partial<GitHubUser>;

		if (data.id === undefined || !data.login || !data.created_at) {
			throw new BadRequestError('Incomplete GitHub user profile');
		}

		return {
			id: data.id,
			login: data.login,
			created_at: data.created_at,
		};
	}

	// Reject accounts younger than minAccountAgeDays.
	assertAccountOldEnough(createdAt: string): void {
		const created = Date.parse(createdAt);
		if (Number.isNaN(created)) {
			throw new BadRequestError('Unable to determine GitHub account age');
		}
		const ageDays = (Date.now() - created) / 86_400_000;
		if (ageDays < this.minAccountAgeDays) {
			throw new BadRequestError(
				`GitHub account too new (min ${this.minAccountAgeDays} days)`,
			);
		}
	}
}
