---
name: ario-testnet-faucet
description: Get ARIO test tokens on the AR.IO Solana-devnet sandbox. Use when an agent or dev needs testnet ARIO to pay the sandbox bundler for uploads or to buy devnet ArNS names. Covers the faucet API (faucet.services.ar-io.dev backend / faucet.ar.io frontend), the claim flow, limits, and the GitHub-OAuth gate.
---

# AR.IO Testnet Faucet (ARIO on Solana devnet)

Dispenses **ARIO test tokens** on **Solana devnet** so developers can exercise the
AR.IO testnet sandbox — pay the sandbox bundler (`upload.services.ar-io.dev`,
≤~105 KB uploads) and buy devnet ArNS names — with **no mainnet, no real money**.

## Topology
- **Frontend (UI):** `https://faucet.ar.io` — an Arweave-hosted app; where humans click "Sign in with GitHub" and claim.
- **Backend (API):** `https://faucet.services.ar-io.dev` — this service. All `/api/*` routes + the OAuth callback live here.

## Facts
- Network: **Solana devnet** (`https://api.devnet.solana.com`).
- Token: **ARIO-staging SPL**, mint `6vTw5CysRXQ4ybbHkDUiisHWVsBeMtUzYvJqs2iqHyaN`, **6 decimals**.
- `processId` for every request: **`solana-devnet`**.
- `qty` is in **base units** (10 ARIO = `10000000`). Per-claim min 10 ARIO, max 10,000 ARIO.
- `recipient` is a **Solana base58 address**.

## Prerequisites (recipient side)
1. A Solana devnet keypair/address.
2. A little **devnet SOL** for fees: `solana airdrop 1 <addr> --url devnet` (or faucet.solana.com). The faucet pays the transfer fee, but you need SOL to *use* the tokens afterward.

## The claim flow (humans)
Go to `https://faucet.ar.io` → **Sign in with GitHub** → enter your Solana address → **Claim**.
The gate: one claim per GitHub account per window, GitHub account must be ≥ 30 days old, plus rate limits. (Anti-sybil — see the agent note below.)

## API reference (backend: `https://faucet.services.ar-io.dev`)
| Method + path | Purpose |
|---|---|
| `GET /healthcheck` | liveness → 200 |
| `GET /api/auth/github/login?process-id=solana-devnet` | start GitHub OAuth (browser; sets a session cookie, redirects to GitHub) |
| `GET /api/auth/github/callback` | GitHub redirect target; issues the claim token (HttpOnly cookie) + redirects to the frontend |
| `POST /api/claim/async` | claim; body `{recipient, qty, processId:"solana-devnet"}`; requires the GitHub-bound token (cookie or `Authorization: Bearer <jwt>`) |
| `POST /api/claim/sync` | claim (captcha path); body `{recipient, qty, processId, captchaResponse?}` |

Success response: `{"id":"<solana-tx-signature>","status":"success"}`. A confirm-timeout returns `202 {"status":"pending"}` (the tx may still land — verify on-chain, do not blindly retry).

### curl (claim, assuming you hold a valid github-bound token)
```bash
curl -sX POST https://faucet.services.ar-io.dev/api/claim/async \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $FAUCET_TOKEN" \
  -d '{"recipient":"<SOLANA_ADDR>","qty":10000000,"processId":"solana-devnet"}'
```

### Verify the tokens landed
```bash
# recipient ARIO balance on devnet
node -e 'const{Connection,PublicKey}=require("@solana/web3.js");(async()=>{const c=new Connection("https://api.devnet.solana.com");const r=await c.getParsedTokenAccountsByOwner(new PublicKey("<SOLANA_ADDR>"),{mint:new PublicKey("6vTw5CysRXQ4ybbHkDUiisHWVsBeMtUzYvJqs2iqHyaN")});console.log(r.value[0]?.account.data.parsed.info.tokenAmount.uiAmountString||"0")})()'
```

## Note for agents (important)
The claim is **GitHub-OAuth-gated** for anti-sybil, and the token is delivered as an
**HttpOnly cookie** — so a fully headless agent **cannot self-serve** (it can't complete
the GitHub browser consent). Practical paths for agents:
1. **Human-assisted:** a person completes the GitHub connect once and claims to the agent's Solana address; the agent then just *uses* the ARIO.
2. **Operator allow-list / CI key (if enabled):** the faucet operator can add a trusted-address allow-list or a service API key that bypasses the OAuth gate for CI/agents (test tokens only). If your deployment has this, use that path — check with the operator. (Not enabled by default.)

Do **not** attempt to defeat the OAuth gate — it exists to keep the shared testbed usable.

## Limits & behavior
- Per-GitHub-account: one claim per rate-limit window; GitHub account ≥ 30 days old.
- Per-IP rate limit (behind the trusted proxy).
- Amounts bounded (min 10 / max 10,000 ARIO).
- Devnet RPC is flaky — expect the occasional `202 pending`; verify on-chain rather than retrying.
