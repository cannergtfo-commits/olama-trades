# Security review — solana-terminal-bot

**Scope:** wallet handling, swap path, filters, dependencies, residual market/protocol risk.  
**Date:** 2026-10-26 (America/Los_Angeles).  
**Mode:** experimental bot; user accepts loss of test funds. Still built with fail-closed defaults (`DRY_RUN=true`).

## Threat model

| Threat | Mitigation in this repo | Residual risk |
|--------|-------------------------|---------------|
| Secret key exfiltration via logs | Wallet helpers never return/print secret; CLI only prints pubkey | Process memory still holds key while running; malware on host wins |
| Accidental git commit of secrets | `.gitignore` excludes `.env`, `.wallet/`, `data/*.json`, `data/secrets/` | User force-adding files bypasses this |
| Withdraw to wrong address | `PublicKey` validation; reject self-transfer | Typos of valid-but-wrong addresses still send funds |
| Oversized buys | `maxBuyAmountSol` cap; slippage clamped 10–500 bps | Cap is config — user can raise it |
| Malicious aggregator / fake Jupiter | Hard-coded `https://api.jup.ag/swap/v2` only | DNS/TLS compromise of host still possible |
| Remote code execution | No `eval` of API payloads; txs deserialized via `@solana/web3.js` | Supply-chain compromise of npm deps |
| Rug / honeypot tokens | Filters: top holder %, top10 %, liquidity, age, mint/freeze revoked, denylist, Jupiter route check | Transfer hooks, blacklists, LP pulls after buy still possible |
| RPC spoofing / poisoned accounts | Uses configured `RPC_URL`; recommend reputable provider | Public RPC can throttle or behave oddly; not authenticated |
| Pump.fun honeypots / sniper games | Conservative filters + dry-run default | Memecoins are adversarial by nature |

## Checklist (completed)

- [x] Keypair written to `.wallet/keypair.json` with mode `0600`; directory `0700`
- [x] Secret never logged or included in CLI output / status / errors intentionally
- [x] `.gitignore` covers `.env`, `.wallet/`, `data/*.json` (chat log, history, positions)
- [x] Withdraw destination validated as Solana pubkey
- [x] Slippage bounds + max buy size
- [x] No `eval` / `Function(` on remote data
- [x] Dependency versions pinned in `package.json`
- [x] Official Jupiter Swap API v2 order → sign `VersionedTransaction` → execute (RPC send fallback only after local sign)
- [x] `DRY_RUN=true` by default — swaps and withdraws simulate
- [x] Holder concentration via `getTokenLargestAccounts` + mint parse for authorities
- [x] `npm audit` run at build time (see below / re-run locally)

## Swap signing path (review)

1. `GET https://api.jup.ag/swap/v2/order?...&taker=<our pubkey>&slippageBps=...`
2. If `DRY_RUN`, stop — log estimated `outAmount`, **do not sign/send**
3. Else base64-decode `transaction`, `VersionedTransaction.deserialize`, `sign([keypair])`
4. `POST https://api.jup.ag/swap/v2/execute` with `signedTransaction` + `requestId`
5. On execute failure with a built tx, optional `sendRawTransaction` via user RPC (still the same signed tx)

**Finding:** Signing happens only locally with the disk keypair. Order endpoint never receives the secret. Placeholder taker is used only for quote probes in the scanner, not for live swaps.

## Holder / authority checks — limitations

- `getTokenLargestAccounts` returns largest token accounts; **AMM/LP vaults often appear as “top holders”**, so percentages are heuristics, not “insider” proof.
- If RPC errors, reasons are attached; combined with `requireMintAuthorityRevoked` etc., incomplete data tends to **block** rather than allow when authorities cannot be confirmed as revoked.
- Does **not** fully analyze Token-2022 transfer hooks, freeze via other programs, or metadata spoofing.

## Dependency notes

Pinned runtime deps:

- `@solana/web3.js@1.98.4`
- `commander`, `chalk`, `dotenv`, `bs58`, `ora` (CLI UX)

Re-run:

```bash
npm audit --omit=dev
```

Treat high/critical findings as blockers before live trading.

## Operational recommendations

1. Keep `DRY_RUN=true` until `scan` / `run --once` behave as expected
2. Fund with **small** SOL only; never use a seed that holds main net worth
3. Prefer a private RPC (`HELIUS` / QuickNode URL in `RPC_URL`)
4. Add `JUPITER_API_KEY` if you hit rate limits
5. After experiments: `wallet withdraw` remaining SOL to cold/main wallet; delete `.wallet/` if done
6. Expect losses: +10%/−25% on illiquid memecoins often hits stop-loss or fails to exit cleanly

## Exploit / abuse review summary

| Area | Result |
|------|--------|
| Private key in logs | Not found in source paths that print errors/status |
| Unbounded spend | Capped by `maxBuyAmountSol` |
| Unsigned remote tx execution | Not present; only locally signed vtx |
| Configurable filter for top holder % | Implemented (`maxTopHolderPercent`) |
| Fake DEX router | Not used |

**Residual:** market rugs, RPC lies, dependency compromise, and user misconfiguration remain. This bot does not make trading safe — it only adds basic guardrails for an experiment.

## npm audit (2026-10-26)

`npm audit --omit=dev` reported **moderate** issues in transitive deps of `@solana/web3.js@1.98.4` (`jayson` → `stream-json`, `uuid`). Fixing requires a breaking upgrade to web3.js v2/v3. Accepted residual for this experiment; re-check before any larger live size. Not remotely exploitable through our CLI inputs in normal use (DoS/prototype issues in JSON-RPC client path).

## BOT ON/OFF control

Dashboards expose an **armed** flag (`data/bot-state.json`). When OFF, the engine skips scan/buy/exit. This is not an auth boundary — anyone with shell access can arm the bot. Protect the host and `.wallet/` as before.

## Techno chat

Dashboard chat (`src/chat.ts`) stores messages in `data/chat-log.json` (gitignored). With `XAI_API_KEY`, replies call xAI locally. Without a key, messages queue in `data/chat-outbound.json` for operator/Techno relay. Chat never requests or logs private keys.
