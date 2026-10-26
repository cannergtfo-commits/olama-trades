# Solana Terminal Trading Bot (experimental)

Node.js + TypeScript CLI bot that scans **DexScreener**, **Pump.fun**, and **Jupiter**, looks for volume spikes / light Twitter·Grok heuristics, applies **risk filters** (including **max top-holder %**), buys a configured SOL size, then exits on **+10% take-profit** or **−25% stop-loss**.

Includes a terminal dashboard, browser UI, and **chat with Techno** (your Grok co-pilot).

> **Not financial advice.** Default `DRY_RUN=true`. You can lose funds if you go live. Use tiny test amounts.

## One-liner install (clone → ready)

**macOS / Linux**

```bash
git clone <YOUR_GITHUB_REPO_URL> solana-terminal-bot
cd solana-terminal-bot
bash scripts/install.sh
```

**Windows (PowerShell)**

```powershell
git clone <YOUR_GITHUB_REPO_URL> solana-terminal-bot
cd solana-terminal-bot
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

**Download ZIP (no git)**

1. GitHub → **Code** → **Download ZIP** → unzip  
2. Open a terminal in the folder  
3. Run `bash scripts/install.sh` (or the PowerShell script on Windows)

### What the installer does

| Step | Behavior |
|------|----------|
| Node check | Requires **Node ≥ 20**; prints install hints if missing |
| `npm install` | Dependencies |
| `.env` | Copies `.env.example` → `.env` **only if missing** (never overwrites) |
| `npm run build` | TypeScript compile |
| Wallet | Creates `.wallet/keypair.json` if missing (**never deletes** an existing one) |
| Optional keys | Prompts for Jupiter / X / xAI / Helius (blank = skip; values not echoed) |
| Next steps | Prints **public** fundable address + dashboard commands |

**Assumptions:** bash (or PowerShell), network for npm, interactive TTY optional (non-interactive skips key prompts — run `npm run bot -- setup` later).

After install:

```bash
npm run bot -- setup          # re-run connections wizard anytime
npm run bot -- bot on         # arm trading (still DRY_RUN until you edit .env)
npm run bot -- scan
npm run bot -- dashboard      # TUI — [b] arm, [c] chat with Techno
npm run bot -- web            # browser UI + chat sidebar → http://127.0.0.1:8787
```

Or use npm helpers:

```bash
npm run setup                 # same as `npm run bot -- setup`
npm run install:bot           # re-run bash installer
```

## Secrets — never committed

| Path | Purpose | Git |
|------|---------|-----|
| `.env` | RPC, API keys, strategy | **ignored** |
| `.wallet/keypair.json` | Bot signing key | **ignored** |
| `data/*.json` | Positions, history, chat log, bot state | **ignored** (folder kept via `data/.gitkeep`) |

`.gitignore` blocks `.env`, `.wallet/`, `data/*.json`, `node_modules/`, `dist/`.  
**Never** force-add those. Only public address is printed by the CLI.

## What gets connected

| Integration | Env | Required? | Notes |
|-------------|-----|-----------|--------|
| Solana RPC | `RPC_URL` | Default public | Prefer Helius/QuickNode for live |
| Jupiter swaps | `JUPITER_API_KEY` | Optional | [portal.jup.ag](https://portal.jup.ag/) — higher limits |
| X / Twitter trends | `X_BEARER_TOKEN` | Optional | Else heuristic / Grok assist |
| **Techno chat + Grok assist** | `XAI_API_KEY` | Optional | [console.x.ai](https://console.x.ai/) |
| Helius | `HELIUS_API_KEY` | Optional | Or put full URL in `RPC_URL` |

Without keys the bot still **scans in dry-run** using public DexScreener + heuristics.

## Chat with Techno

Stay connected to Techno while the bot runs:

- **TUI:** press **`[c]`**, type, **Enter** to send (**Esc** cancels)
- **Web:** chat sidebar on the right

**How replies work**

1. If `XAI_API_KEY` is set → local Grok reply via xAI API (`src/chat.ts`)
2. If missing (or xAI errors) → message is appended to `data/chat-log.json` and queued in `data/chat-outbound.json` for **operator / Techno relay**, with a clear “queued” status in the UI

```bash
npm run bot -- setup   # paste XAI_API_KEY when prompted
```

API: `GET /api/chat` · `POST /api/chat` body `{ "text": "…" }` (also accepts `"message"`). SSE pushes `event: chat` with the dashboard.

## Commands

| Command | Purpose |
|--------|---------|
| `setup` | Interactive RPC / Jupiter / X / xAI wizard |
| `wallet create` | Generate keypair at `.wallet/keypair.json` (mode `0600`) |
| `wallet address` | Print public key |
| `wallet balance` | SOL balance via RPC |
| `wallet withdraw <pubkey> <sol>` | Send SOL out (respects `DRY_RUN`) |
| `filters show` / `filters set <key> <value>` | Buy-block rules |
| `scan` | Candidates + reject reasons |
| `run [--once]` | Scan → filter → buy → monitor |
| `bot on` / `bot off` / `bot toggle` / `bot status` | Arm / disarm trading |
| `dashboard` | Terminal UI (10s refresh, `[c]` chat) |
| `web` | Browser dashboard + chat |
| `status` / `history` | Wallet + tx log |

## Filters (buy blockers)

- `maxTopHolderPercent` — default `20` (often tightened to `15`)
- `maxTop10HolderPercent`, `minLiquidityUsd`, volume / age rules
- `requireMintAuthorityRevoked` / `requireFreezeAuthorityRevoked`
- `denylistMints`

```bash
npm run bot -- filters set maxTopHolderPercent 15
```

## Strategy defaults

- Buy: `0.05 SOL` (cap `0.25`) · TP **+10%** · SL **−25%** · slippage `100` bps · max 3 open positions  
- `DRY_RUN=true` until **you** flip it in `.env` (installer never sets live mode)

## Project layout

```
scripts/install.sh|.ps1   one-shot installers
src/cli.ts                CLI
src/setup.ts              connections wizard
src/chat.ts               Techno chat log + xAI / relay queue
src/wallet.ts             keypair create / balance / withdraw
src/config.ts             .env + config.json
src/filters.ts            buy-block rules
src/security-checks.ts    holders + mint/freeze
src/scanners/*            dexscreener, pumpfun, jupiter
src/signals/twitter.ts    X API, optional Grok, or heuristic
src/swap.ts / strategy.ts Jupiter + TP/SL loop
src/ui/tui.ts web.ts      dashboards + chat
public/                   web SPA + mascot.jpg
SECURITY.md               threat model
LICENSE                   MIT
```

## Safety

See [SECURITY.md](./SECURITY.md). Secrets stay in `.wallet/` and `.env`. Never paste your secret key into chat, logs, or GitHub.

## License

MIT — see [LICENSE](./LICENSE).
