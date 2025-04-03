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

interface CaptchaVerifier {
	verifyCaptchaResponse({
		captchaResponse,
		remoteip,
	}: { captchaResponse: string; remoteip: string }): Promise<boolean>;
}

export class hCaptchaVerifier implements CaptchaVerifier {
	private secretKey: string;
	private siteVerifyUrl: string;

	constructor({
		secretKey,
		siteVerifyUrl,
	}: { secretKey: string; siteVerifyUrl: string }) {
		this.secretKey = secretKey;
		this.siteVerifyUrl = siteVerifyUrl;
	}

	async verifyCaptchaResponse({
		captchaResponse,
		remoteip,
	}: { captchaResponse: string; remoteip: string }): Promise<boolean> {
		const queryParams = new URLSearchParams({
			secret: this.secretKey,
			response: captchaResponse,
			remoteip: remoteip,
		});

		const response = await fetch(
			`${this.siteVerifyUrl}?${queryParams.toString()}`,
			{
				method: 'POST',
			},
		);

		const data = await response.json();
		return data.success;
	}
}

// TODO: add reCAPTCHA verifier
