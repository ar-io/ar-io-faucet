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
import { TransferSendError } from './errors.js';
import type { SolanaTokenFaucet } from './faucet/solana-token-faucet.js';
import defaultLogger from './logger.js';
import { notifyClaim } from './notifications/slack.js';
import type { TokenFaucet, TokenPayload } from './types.js';

// Resolve the request-scoped logger set by loggerMiddleware (carries trace + ip),
// falling back to the module logger so performClaim stays unit-testable with a
// bare ctx that has no state.
// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
function claimLog(ctx: any) {
	return ctx?.state?.logger ?? defaultLogger;
}

// The subset of the per-githubId anti-sybil store performClaim needs. Kept as an
// interface (rather than importing the concrete store from system.ts) so this
// concurrency-critical logic has NO module-level side effects and is unit
// testable without booting the env-bound system wiring.
export interface ClaimGithubStore {
	has(githubId: number | string): boolean;
}

// shared claim execution.
//
// SECURITY (TOCTOU concurrent-replay drain): the per-JWT nonce is RESERVED
// atomically and synchronously BEFORE the transfer is dispatched — never after.
// reserveNonce() is a set-if-absent in a single critical section (has()+set()
// with no await in between), so of N concurrent claims sharing the same JWT
// exactly one wins the reservation and the rest are rejected before any tokens
// move. The per-githubId anti-sybil slot is reserved earlier, at the OAuth
// callback (the identity gate); here we re-check it as defense-in-depth (a valid
// JWT should always correspond to a still-held slot).
//
// SECURITY (confirm-timeout double-claim): the nonce is rolled back ONLY for a
// provably PRE-BROADCAST failure (BadRequestError / balance / bounds, thrown
// before sendAndConfirmTransaction), so a legitimate user can retry with the
// same token before it expires. A POST-BROADCAST send/confirm failure
// (TransferSendError) is NOT rolled back: on Solana devnet a confirm/blockhash
// timeout routinely fires even though the transfer LANDED on-chain, so releasing
// the nonce would re-arm the JWT and enable a replay/double-claim. Such a claim
// is surfaced to the caller as a distinct `pending` status. On success the nonce
// stays burned.
export async function performClaim(
	// biome-ignore lint/suspicious/noExplicitAny: koa Context typing
	ctx: any,
	faucet: TokenFaucet,
	payload: TokenPayload | undefined,
	{ recipient, qty }: { recipient: string; qty: number },
	githubClaimStore: ClaimGithubStore,
): Promise<void> {
	const githubId = payload?.githubId;
	const solanaFaucet = faucet as SolanaTokenFaucet;

	// 1. per-githubId anti-sybil re-check. The slot was reserved at the OAuth
	// callback; if it's gone the window rolled over — reject rather than transfer.
	if (githubId !== undefined && !githubClaimStore.has(githubId)) {
		claimLog(ctx).warn('Claim denied.', {
			reason: 'github-slot-expired',
			githubId,
			recipient,
		});
		ctx.status = 429;
		ctx.body = {
			error: 'Already claimed for this GitHub account this window',
		};
		return;
	}

	// 2. RESERVE (burn) the token nonce (atomic set-if-absent) BEFORE the
	// transfer. If the nonce was already reserved/consumed, this is a replay —
	// reject before any tokens move.
	if (payload && !solanaFaucet.reserveNonce(payload)) {
		claimLog(ctx).warn('Claim denied.', {
			reason: 'nonce-replay',
			githubId,
			recipient,
		});
		ctx.status = 409;
		ctx.body = { error: 'Token already used' };
		return;
	}

	// 3. Dispatch the transfer. The nonce is now held, so no other concurrent
	// request carrying the same token can also reach this point.
	try {
		const { id, status } = await faucet.claim({
			recipient,
			qty,
			githubId,
		});
		ctx.body = { id, status };

		// audit trail: one queryable info line per disbursement (recipient,
		// amount, tx signature, github identity) so claims are answerable from
		// logs, not only the opt-in Slack webhook.
		claimLog(ctx).info('Claim succeeded.', {
			txId: id,
			status,
			recipient,
			amount: qty,
			tokenId: solanaFaucet.tokenName,
			githubId,
			githubLogin: payload?.githubLogin,
		});

		// fire-and-forget Slack notification (opt-in via SLACK_WEBHOOK_URL)
		notifyClaim({
			githubLogin: payload?.githubLogin,
			recipient,
			amountBaseUnits: qty,
			decimals: solanaFaucet.tokenDecimals,
			tokenId: solanaFaucet.tokenName,
			txId: id,
		});
	} catch (error) {
		// POST-BROADCAST failure (send/confirm timeout): the transfer may have
		// LANDED on-chain, so the token is treated as CONSUMED — do NOT release the
		// nonce (that would re-arm the JWT and enable a replay/double-claim).
		// Surface a distinct pending/unknown status instead of a hard failure.
		if (error instanceof TransferSendError) {
			claimLog(ctx).warn('Claim pending (post-broadcast confirm timeout).', {
				reason: 'confirm-timeout',
				recipient,
				githubId,
				error: error.message,
			});
			ctx.status = 202;
			ctx.body = {
				status: 'pending',
				error:
					'Transfer was submitted but could not be confirmed in time. It may still settle on-chain; this claim token cannot be reused.',
			};
			return;
		}

		// PRE-BROADCAST failure (validation / balance / bounds): no tokens moved,
		// so roll back the nonce reservation and let the user retry with the same
		// (still-valid) token.
		if (payload) {
			await solanaFaucet.releaseNonce(payload);
		}
		throw error;
	}
}
