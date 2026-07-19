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

// Unit tests for the observability logging added to the claim path and the
// error middleware. No external boundaries are touched: the "faucet" is a
// duck-typed stub exposing only the methods performClaim calls, and the logger
// is an in-memory spy injected via ctx.state.logger.

import assert from 'node:assert';
import { describe, it } from 'node:test';
import { performClaim } from '../../src/claim.js';
import { BadRequestError, TransferSendError } from '../../src/errors.js';
import { errorMiddleware } from '../../src/middleware/errors.js';
import type { TokenPayload } from '../../src/types.js';

type LogEntry = { msg: string; meta?: Record<string, unknown> };
type Calls = { info: LogEntry[]; warn: LogEntry[]; error: LogEntry[] };

// In-memory logger spy capturing calls per level.
function makeLogger() {
	const calls: Calls = { info: [], warn: [], error: [] };
	const record =
		(level: keyof Calls) => (msg: string, meta?: Record<string, unknown>) => {
			calls[level].push({ msg, meta });
		};
	const logger = {
		info: record('info'),
		warn: record('warn'),
		error: record('error'),
	};
	return { logger, calls };
}

type ClaimBody = { status?: string; error?: string; id?: string } | undefined;

// Minimal koa-ctx stand-in that carries a request-scoped logger (as
// loggerMiddleware would) and captures status/body writes.
function makeCtx() {
	const { logger, calls } = makeLogger();
	return {
		state: { logger },
		status: 200,
		body: undefined as ClaimBody,
		calls,
	};
}

// The subset of a koa Context that performClaim / errorMiddleware exercise.
type TestCtx = ReturnType<typeof makeCtx>;

// performClaim(ctx: any, faucet: TokenFaucet, ...) and errorMiddleware(ctx:
// Context, ...) both want richer types than these stubs; cast through the real
// parameter types so the tests stay strongly typed without a bare `any`.
type FaucetArg = Parameters<typeof performClaim>[1];
type ErrorCtxArg = Parameters<typeof errorMiddleware>[0];

// A duck-typed faucet exposing only what performClaim uses.
function makeFaucet(
	overrides: Partial<{
		reserveNonce: () => boolean;
		claim: () => Promise<{ id: string; status: string }>;
	}> = {},
) {
	const released: TokenPayload[] = [];
	return {
		released,
		tokenName: 'solana-devnet',
		tokenDecimals: 6,
		reserveNonce: overrides.reserveNonce ?? (() => true),
		releaseNonce: async (payload: TokenPayload) => {
			released.push(payload);
		},
		claim:
			overrides.claim ??
			(async () => ({ id: 'TX_SIGNATURE_123', status: 'success' })),
	};
}

function makePayload(githubId?: number): TokenPayload {
	const now = Math.floor(Date.now() / 1000);
	return {
		issuer: 'issuer',
		processId: 'solana-devnet',
		iat: now,
		exp: now + 3600,
		nonce: `nonce-${githubId ?? 'x'}`,
		githubId,
		githubLogin: githubId ? 'octocat' : undefined,
	};
}

function runClaim(
	ctx: TestCtx,
	faucet: ReturnType<typeof makeFaucet>,
	payload: TokenPayload,
	req: { recipient: string; qty: number },
	store: { has: () => boolean },
) {
	return performClaim(ctx, faucet as unknown as FaucetArg, payload, req, store);
}

const storeHeld = { has: () => true };
const RECIPIENT = 'RecipientAddr1111111111111111111111111111111';

describe('claim logging: success audit trail', () => {
	it('emits one info "Claim succeeded." line with tx + recipient + identity', async () => {
		const ctx = makeCtx();
		const faucet = makeFaucet();
		await runClaim(
			ctx,
			faucet,
			makePayload(42),
			{ recipient: RECIPIENT, qty: 5_000_000_000 },
			storeHeld,
		);

		assert.strictEqual(ctx.body?.status, 'success');
		assert.strictEqual(ctx.calls.info.length, 1, 'exactly one audit line');
		const entry = ctx.calls.info[0];
		assert.strictEqual(entry.msg, 'Claim succeeded.');
		assert.strictEqual(entry.meta?.txId, 'TX_SIGNATURE_123');
		assert.strictEqual(entry.meta?.recipient, RECIPIENT);
		assert.strictEqual(entry.meta?.amount, 5_000_000_000);
		assert.strictEqual(entry.meta?.githubId, 42);
		assert.strictEqual(entry.meta?.githubLogin, 'octocat');
		assert.strictEqual(ctx.calls.warn.length, 0);
	});
});

describe('claim logging: denials are warned with a reason', () => {
	it('warns "nonce-replay" and returns 409 when the nonce is already used', async () => {
		const ctx = makeCtx();
		const faucet = makeFaucet({ reserveNonce: () => false });
		await runClaim(
			ctx,
			faucet,
			makePayload(7),
			{ recipient: RECIPIENT, qty: 5_000_000_000 },
			storeHeld,
		);

		assert.strictEqual(ctx.status, 409);
		assert.strictEqual(ctx.calls.warn.length, 1);
		assert.strictEqual(ctx.calls.warn[0].meta?.reason, 'nonce-replay');
		assert.strictEqual(
			ctx.calls.info.length,
			0,
			'no success audit on a replay',
		);
	});

	it('warns "github-slot-expired" and returns 429 when the anti-sybil slot is gone', async () => {
		const ctx = makeCtx();
		const faucet = makeFaucet();
		const storeEmpty = { has: () => false };
		await runClaim(
			ctx,
			faucet,
			makePayload(7),
			{ recipient: RECIPIENT, qty: 5_000_000_000 },
			storeEmpty,
		);

		assert.strictEqual(ctx.status, 429);
		assert.strictEqual(ctx.calls.warn.length, 1);
		assert.strictEqual(ctx.calls.warn[0].meta?.reason, 'github-slot-expired');
	});

	it('warns "confirm-timeout" and returns 202 on a post-broadcast send failure', async () => {
		const ctx = makeCtx();
		const faucet = makeFaucet({
			claim: async () => {
				throw new TransferSendError('confirmation timed out');
			},
		});
		await runClaim(
			ctx,
			faucet,
			makePayload(7),
			{ recipient: RECIPIENT, qty: 5_000_000_000 },
			storeHeld,
		);

		assert.strictEqual(ctx.status, 202);
		assert.strictEqual(ctx.calls.warn.length, 1);
		assert.strictEqual(ctx.calls.warn[0].meta?.reason, 'confirm-timeout');
	});
});

describe('error middleware: client vs system error log levels', () => {
	it('logs a BadRequestError at warn (no stack) and returns 400', async () => {
		const ctx = makeCtx();
		await errorMiddleware(ctx as unknown as ErrorCtxArg, async () => {
			throw new BadRequestError('bad input');
		});

		assert.strictEqual(ctx.status, 400);
		assert.deepStrictEqual(ctx.body, { error: 'bad input' });
		assert.strictEqual(ctx.calls.warn.length, 1, 'client error -> warn');
		assert.strictEqual(ctx.calls.error.length, 0, 'never error-level for 4xx');
		assert.strictEqual(ctx.calls.warn[0].meta?.stack, undefined);
	});

	it('logs an unexpected Error at error (with stack) and returns 503', async () => {
		const ctx = makeCtx();
		await errorMiddleware(ctx as unknown as ErrorCtxArg, async () => {
			throw new Error('unexpected boom');
		});

		assert.strictEqual(ctx.status, 503);
		assert.deepStrictEqual(ctx.body, { error: 'unexpected boom' });
		assert.strictEqual(ctx.calls.error.length, 1, 'system error -> error');
		assert.strictEqual(ctx.calls.warn.length, 0);
		assert.ok(ctx.calls.error[0].meta?.stack, 'stack is captured for 5xx');
	});
});
