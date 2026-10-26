# Solana Terminal Trading Bot (experimental)

Node.js + TypeScript CLI bot that scans **DexScreener**, **Pump.fun**, and **Jupiter** (organic + recent), ranks by **multi-source confluence**, multi-timeframe volume, bonding/graduation status, and light momentum — then applies **risk filters** (including **max top-holder %** / bundler), buys a configured SOL size, and exits on **+10% take-profit** or **−25% stop-loss**.

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


## Confluence ranking (solana-skill)

Analysis playbook: [`docs/solana-skill.md`](./docs/solana-skill.md) (also under `.agents/skills/solana-skill/`).

Before `tryEnter`, candidates are merged across sources and scored:

| Signal | Behavior |
|--------|----------|
| Cross-source tags | `pump` / `dex` / `jup` — prefer tokens seen on multiple |
| Multi-TF volume | DexScreener + Jupiter `5m / 1h / 6h / 24h` when available |
| Liquidity vs volume | Soft `vol24h / liquidity` risk flag (downrank; **not** a hard fail when `minLiquidityUsd=0`) |
| Bonding / graduated | Prefer graduated for Jupiter routes; on-curve without route is blocked |
| Organic Jupiter | Free `lite-api.jup.ag/tokens/v2/toporganicscore/5m` + `/recent` (no paid key) |
| Light momentum | Approx RSI-ish hint from TF price changes — skipped gracefully if data missing |
| Pump.fun callouts | Prefer pump-tagged launches ahead of dex/jup-only (`preferPumpCallouts`) |
| Mint keywords | Exact mint match from `twitter.keywords` / `TWITTER_KEYWORDS` boosts score + social pass |

### Config knobs (defaults match current live behavior)

| Key | Default | Notes |
|-----|---------|-------|
| `minConfluenceSources` | `1` | Set `2` to require multi-platform hits (may starve thin APIs) |
| `maxVolumeToLiquidityRatio` | `40` | Soft risk threshold for vol/liq |
| `preferGraduated` | `true` | Downrank / soft-block lone bonding-curve tokens |
| `preferPumpCallouts` | `true` | Rank Pump.fun sources first for tryEnter |

Env aliases: `MIN_CONFLUENCE_SOURCES`, `MAX_VOLUME_TO_LIQUIDITY_RATIO`, `PREFER_GRADUATED`, `PREFER_PUMP_CALLOUTS`, `TWITTER_KEYWORDS`.

**API limits:** Pump.fun frontend often Cloudflare-blocks datacenter IPs (DexScreener proxy used). Jupiter portal-only Organic UI extras beyond lite-api are skipped. True OHLCV RSI needs a chart API — bot uses TF price-change proxies instead.


## Mint keywords (contract addresses)

`twitter.keywords` (and env `TWITTER_KEYWORDS` / `SEARCH_KEYWORDS`) accept **buzz words and Solana mint addresses** side by side.

| Form | Behavior |
|------|----------|
| Word (`pump`, `gem`) | Matches symbol/name substring (heuristic) and X cashtag search |
| Mint (base58, 32–44 chars) | Exact case-insensitive match on candidate mint; boosts confluence + treats as Twitter/watchlist pass |
| `AUTO_WATCH_OPEN_MINTS=true` | Transiently watch open-position mints |
| `AUTO_WATCH_HOT_MINTS=false` | Optionally watch top hot-scan mints |

```bash
# .env — append a contract you want watched
TWITTER_KEYWORDS=pump,solana,gem,moon,YourBase58MintAddressHere

# or config.json → twitter.keywords array
```

Watched mints are also fetched via DexScreener `tokens/{mint}` during each scan.

## Pump.fun callout priority

When `preferPumpCallouts` / `PREFER_PUMP_CALLOUTS=true` (default), candidates tagged with a **Pump.fun** source family rank **ahead** of DexScreener/Jupiter-only hits for `tryEnter` ordering, with an extra confluence score boost (stronger for fresh bonding launches).

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
src/scanners/*            dexscreener, pumpfun, jupiter (organic)
src/confluence.ts         cross-source score + liq risk
docs/solana-skill.md      analysis playbook copy
src/keywords.ts           buzz words + mint address watch list
src/signals/twitter.ts    X API, mint keywords, Grok, or heuristic
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
