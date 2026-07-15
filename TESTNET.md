# AR.IO Testnet / Devnet Stack

> **STATUS: WORK IN PROGRESS — not yet stood up end to end.** This documents the
> *target* architecture, per-component setup, and the developer flow. Items
> marked **🔲 BLOCKER** are unresolved and will stop a real test until filled in.
> Nobody has run the full fund→upload→name→resolve flow yet.

## Can I test right now?

**No.** A dev/agent cannot complete the end-to-end flow until the blockers in
[§6](#6-blockers--must-resolve-before-first-successful-test) are resolved. Read
that section first — it is the honest gap list.

---

## 1. What this is

A staging/devnet AR.IO plane where developers exercise the full lifecycle —
fund → upload → name → resolve/serve — **without touching mainnet Arweave or
real money**. Data is ephemeral/staging (not permanent on the weave). The
AR.IO network state (gateways, ArNS, ANT) is read from **Solana devnet**.

## 2. Architecture

```
  developer / agent
        │  (1) devnet SOL: solana faucet      (2) claim token: our faucet (GitHub-gated)
        ▼
  ┌─────────────┐   upload    ┌──────────────────────────┐
  │ turbo-sdk   │────────────▶│ Turbo bundler (separate) │  upload.services.ar-io.dev
  │ (dev app)   │             │  + payment.services...    │  ← already up; testnet cfg UNCONFIRMED 🔲
  └─────────────┘             └──────────┬───────────────┘
        │ (4) register ArNS name                    │ data items
        ▼ (ar-io-sdk → devnet programs)             ▼
  ┌────────────────────────────────────────────────────────────┐
  │ Gateway  ar-io.dev  (→ Solana devnet)                       │
  │  • ARWEAVE_POST_DRY_RUN=true (no chunks to weave)           │
  │  • temporarily unpacks/indexes dev-bundler data (filter)   │
  │  • resolves devnet ArNS/ANT from Solana devnet programs     │
  │  • content-scanner sidecar (v0.5.0, moderation) ✅ live     │
  └────────────────────────────────────────────────────────────┘
        ▲ (5) resolve + serve  (verified=false, data ephemeral)
```

| Component | Where | Status |
|---|---|---|
| Gateway (ar-io-node) | ar-io.dev host | 🔲 **not reconfigured to devnet** (planned) |
| Turbo bundler (upload+payment) | separate box | ⚙️ up on latest; **testnet config unconfirmed** 🔲 |
| Faucet | $5 Hetzner (target) | code ready on branch; **not deployed / not provisioned** 🔲 |
| ArNS / ANT | Solana devnet programs | resolution path planned; **registration unproven** 🔲 |
| Content scanner | ar-io.dev sidecar | ✅ v0.5.0 live |

## 3. Developer flow (intended)

1. **Devnet SOL** for fees: `solana airdrop 1 <addr> --url devnet` or faucet.solana.com.
2. **Claim the devnet token** from our faucet: connect GitHub → claim to your Solana address.
3. **Upload** data via `turbo-sdk` pointed at our bundler (devnet).
4. **Register** a devnet ArNS name via `@ar.io/sdk` against the devnet programs.
5. **Resolve + serve** through `ar-io.dev` (expect `x-ar-io-verified: false`; data is ephemeral).

## 4. Component setup

### 4.1 Gateway → Solana devnet (`.env` on ar-io-node) — 🔲 not applied
```dotenv
SOLANA_RPC_URL=https://api.devnet.solana.com          # use a paid devnet RPC for real load
# RE-PULL from ar-io/ar-io-solana-contracts/program-ids/staging.json — devnet IDs rotate:
ARIO_CORE_PROGRAM_ID=8Njx9wPkXiNzDCgjwVsJFRjpAEV34gGW3n8DzX3V23m1
ARIO_GAR_PROGRAM_ID=7WsDTrtZBsfKtnP33XkjuqXCY69JE7n4QVYpynqJCFxz
ARIO_ARNS_PROGRAM_ID=6EZNezcg4rc5hnh8HG34vGquT3WpW5xXypzPb24uyEpp
ARIO_ANT_PROGRAM_ID=DbHbRwUD1oAn1mrDSqtWtvwGcNrmhWdD2g8L4xmeQ7NX
SOLANA_KEYPAIR_PATH=/app/wallets/devnet-keypair.json
ARNS_ROOT_HOST=<devnet host>
ARNS_RESOLVER_PRIORITY_ORDER=on-demand,gateway         # resolve devnet names locally, not via mainnet gw
ARWEAVE_POST_DRY_RUN=true                              # no chunks to the weave
# point reads at the dev bundler if needed (confirm API shape first):
# TRUSTED_GATEWAYS_URLS / ON_DEMAND_RETRIEVAL_ORDER / TURBO_ENDPOINT
```

### 4.2 Turbo bundler — ⚙️ exists, config to CONFIRM 🔲
`upload.services.ar-io.dev` / `payment.services.ar-io.dev` are up. **Must confirm:**
whether they accept devnet uploads, whether payment is bypassed or credits are
required, and which token/network they’re bound to. Client points at them via
`turbo-sdk` (`uploadServiceConfig.url` / `paymentServiceConfig.url` / `gatewayUrl`).

### 4.3 Faucet — code ready on `feat/solana-devnet-port` (repo `ar-io-faucet`)
Run: `yarn build && yarn start` (Node 22). Required env (see `.env.example`):
```dotenv
SOLANA_RPC_URL=https://api.devnet.solana.com
SOLANA_TOKEN_MINT=<devnet token mint>                 # 🔲 BLOCKER — see §6
SOLANA_FAUCET_SECRET_KEY=<base58 or JSON keypair>     # funded with the token + SOL for fees
AUTH_TOKEN_SECRET=<random>
GITHUB_OAUTH_ENABLED=true
GITHUB_CLIENT_ID=<oauth app>                           # 🔲 register a GitHub OAuth app
GITHUB_CLIENT_SECRET=<oauth app>
GITHUB_OAUTH_CALLBACK_URL=https://<faucet-host>/api/auth/github/callback
GITHUB_MIN_ACCOUNT_AGE_DAYS=30
TRUST_PROXY=true                                       # ONLY if behind a proxy that overwrites XFF
COOKIE_SECURE=true
# hCaptcha + rate-limit vars retained (CAPTCHA_*, GLOBAL_RATE_LIMIT_*)
```
Controls: GitHub OAuth gate (session-bound cookie token, per-account limit,
min-account-age) + hCaptcha + rate limits. Anti-sybil state is **in-memory**
(single-box only; resets on restart).

### 4.4 ArNS devnet registration — 🔲 path unproven
Register/manage names via `@ar.io/sdk` configured against the devnet programs
(§4.1). **Unproven:** the exact registration cost + which token pays for it on
devnet (the devnet `ario` SPL mint is currently `null`).

### 4.5 Content scanner — ✅ live (v0.5.0). Moderates the testbed; no action needed.

## 5. Security / invariants
- **No mainnet leakage** (the cardinal invariant): gateway `ARWEAVE_POST_DRY_RUN=true`;
  the bundler must NOT post to mainnet arweave.net. Verify both before any upload.
- Faucet: GitHub OAuth + hCaptcha + rate limits; funds-safety hardened (atomic
  reserve-before-transfer). Single-box devnet only.
- Data is **ephemeral** and **`verified=false`** — communicate to devs.

## 6. BLOCKERS — must resolve before first successful test
1. **Devnet token mint** (`SOLANA_TOKEN_MINT`) — does a devnet ARIO SPL mint exist? Research found it `null`. If not, create one or pick what the faucet dispenses.
2. **Faucet: deploy + public URL** — not deployed anywhere yet.
3. **GitHub OAuth app** — client id/secret + callback registered.
4. **Funded faucet keypair** — holds the devnet token + SOL for fees.
5. **Gateway reconfigured to devnet** — env applied, restarted, devnet ArNS resolution confirmed.
6. **Bundler testnet behavior confirmed** — accepts devnet uploads; payment bypass or credits; token/network.
7. **ArNS devnet registration proven** — the token/cost to register a name on devnet.
8. **One real end-to-end run** — nobody has done fund→upload→name→resolve yet; faucet e2e (Docker) has never run.

## 7. Agent quick-reference
- Devnet program IDs: `ar-io/ar-io-solana-contracts/program-ids/staging.json` (**re-pull — IDs rotate**).
- Devnet SOL: `solana airdrop … --url devnet`.
- Faucet repo/branch: `ar-io-faucet` @ `feat/solana-devnet-port` (SPL transfer + GitHub OAuth gate).
- Invariant: **never post to mainnet Arweave** (dry-run gateway + non-mainnet bundler).
- Turbo dev services (reference): `upload.ardrive.dev` / `payment.ardrive.dev` support Solana-devnet funding.
- Sources: `ar-io-node` (develop) compose/`docs/envs.md`/`config.ts`; `ar-io-solana-contracts` manifests; `ardriveapp/turbo-*`; `ar-io/ar-io-faucet`.

## 8. Open decisions
- Ephemeral (data lives only in bundler+cache) vs a devnet-Arweave target.
- What the faucet dispenses (devnet ARIO SPL vs test token) — ties to Blocker #1.
- Is `upload.services.ar-io.dev` reused as-is or given a devnet-specific config/instance?
