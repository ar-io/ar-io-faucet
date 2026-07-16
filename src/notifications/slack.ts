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
import * as config from '../config.js';
import logger from '../logger.js';

// Optional Slack notifications for faucet activity. Every function here is
// fire-and-forget: a missing, misconfigured, or unreachable webhook must NEVER
// block or fail a claim. Enabled only when SLACK_WEBHOOK_URL is set.

const TOKEN_SYMBOL = 'ARIO';

function formatAmount(baseUnits: number | bigint, decimals: number): string {
	const n = Number(baseUnits) / 10 ** decimals;
	return n.toLocaleString('en-US', { maximumFractionDigits: decimals });
}

function solanaCluster(tokenId: string): string {
	if (tokenId.includes('devnet')) return 'devnet';
	if (tokenId.includes('testnet')) return 'testnet';
	return 'mainnet-beta';
}

async function post(text: string): Promise<void> {
	const url = config.SLACK_WEBHOOK_URL;
	if (!url) return;
	try {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ text }),
			signal: AbortSignal.timeout(5000),
		});
		if (!res.ok) {
			logger.warn('Slack notification returned a non-2xx status', {
				status: res.status,
			});
		}
	} catch (error) {
		logger.warn('Slack notification failed to send', {
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

// Announce a successful claim: who (GitHub login), how much, to whom, and the
// on-chain transaction.
export function notifyClaim(details: {
	githubLogin?: string;
	recipient: string;
	amountBaseUnits: number;
	decimals: number;
	tokenId: string;
	txId: string;
}): void {
	if (!config.SLACK_WEBHOOK_URL) return;
	const who = details.githubLogin ? `@${details.githubLogin}` : 'A user';
	const amount = formatAmount(details.amountBaseUnits, details.decimals);
	const cluster = solanaCluster(details.tokenId);
	const explorer = `https://explorer.solana.com/tx/${details.txId}?cluster=${cluster}`;
	const text =
		`:potable_water: *${who}* claimed *${amount} ${TOKEN_SYMBOL}*\n` +
		`Recipient: \`${details.recipient}\`\n` +
		`<${explorer}|View transaction> · \`${details.tokenId}\``;
	void post(text);
}

// Warn operators when the faucet's remaining token balance drops below the
// configured threshold so it can be refilled before it runs dry.
export function notifyLowBalance(details: {
	remainingBaseUnits: bigint;
	thresholdBaseUnits: number;
	decimals: number;
	tokenId: string;
	faucetAddress: string;
}): void {
	if (!config.SLACK_WEBHOOK_URL) return;
	const remaining = formatAmount(details.remainingBaseUnits, details.decimals);
	const threshold = formatAmount(details.thresholdBaseUnits, details.decimals);
	const text =
		`:warning: *Faucet balance low* — ${remaining} ${TOKEN_SYMBOL} remaining ` +
		`(below the ${threshold} ${TOKEN_SYMBOL} alert threshold).\n` +
		`Refill \`${details.faucetAddress}\` on \`${details.tokenId}\`.`;
	void post(text);
}
