# Olama Trades

Solana terminal trading bot — **Ollama / Qwen2.5-Coder 14B** co-pilot fork of [solana-terminal-bot](https://github.com/cannergtfo-commits/solana-terminal-bot).

Node.js + TypeScript CLI that scans **DexScreener**, **Pump.fun**, and **Jupiter**, ranks by confluence, applies risk filters (or experimental risk-on pattern mode), buys a configured SOL size, and exits on take-profit / stop-loss.

Includes a terminal dashboard, browser UI, and **chat with Olama** (local Qwen via Ollama).

> **Not financial advice.** Default `DRY_RUN=true`. You can lose funds if you go live. Use tiny test amounts.

## Open in Ollama

1. Clone this repo and open the **folder** in Ollama App / your IDE agent.
2. Pull the model: `ollama pull qwen2.5-coder:14b`
3. Optional project model: `ollama create olama-trades -f Modelfile`
4. Follow **[AGENTS.md](./AGENTS.md)** and **[commands.md](./commands.md)** for natural-language → CLI mappings.

```bash
git clone https://github.com/cannergtfo-commits/olama-trades.git
cd olama-trades
ollama pull qwen2.5-coder:14b
npm install
npm run build
npm run init-wallet          # creates .wallet/keypair.json (gitignored) + prints public address
npm run bot -- setup         # optional RPC / Jupiter / Ollama URL
npm run bot -- bot on
npm run bot -- scan
npm run bot -- dashboard     # [b] arm · [c] chat with Olama
```

**Wallet:** first run generates a new keypair under `.wallet/` (never committed). Fund the **public** address only. Never paste the secret into chat. Ollama cannot invent a funded key — you fund the printed address yourself.

## One-liner install

**macOS / Linux**

```bash
git clone https://github.com/cannergtfo-commits/olama-trades.git
cd olama-trades
bash scripts/install.sh
```

**Windows (PowerShell)**

```powershell
git clone https://github.com/cannergtfo-commits/olama-trades.git
cd olama-trades
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
```

### What the installer does

| Step | Behavior |
|------|----------|
| Node check | Requires **Node ≥ 20** |
| `npm install` | Dependencies |
| `.env` | Copies `.env.example` → `.env` **only if missing** |
| `npm run build` | TypeScript compile |
| Wallet | Creates `.wallet/keypair.json` if missing (**never deletes** an existing one) |
| Optional keys | Prompts for Jupiter / X / Helius / optional xAI (blank = skip) |
| Next steps | Prints **public** fundable address + dashboard commands |

After install:

```bash
npm run init-wallet
npm run bot -- setup
npm run bot -- bot on
npm run bot -- scan
npm run bot -- dashboard
npm run bot -- web            # http://127.0.0.1:8787
```

## Secrets — never committed

| Path | Purpose | Git |
|------|---------|-----|
| `.env` | RPC, API keys, strategy | **ignored** |
| `.wallet/keypair.json` | Bot signing key | **ignored** |
| `data/*.json` | Positions, history, chat log | **ignored** |

## What gets connected

| Integration | Env | Required? | Notes |
|-------------|-----|-----------|--------|
| **Olama chat (Ollama)** | `OLLAMA_BASE_URL` / `OLLAMA_MODEL` | Default local | `qwen2.5-coder:14b` |
| Chat provider | `CHAT_PROVIDER` | Default `ollama` | `ollama`, `auto`, or `xai` |
| Solana RPC | `RPC_URL` | Default public | Prefer Helius/QuickNode for live |
| Jupiter swaps | `JUPITER_API_KEY` | Optional | [portal.jup.ag](https://portal.jup.ag/) |
| X / Twitter trends | `X_BEARER_TOKEN` | Optional | Else Ollama / heuristic |
| xAI fallback | `XAI_API_KEY` | Optional | Only if `CHAT_PROVIDER=auto|xai` |
| Helius | `HELIUS_API_KEY` | Optional | Or full URL in `RPC_URL` |

Without cloud keys the bot still **scans in dry-run** and chats via local Ollama.

## Chat with Olama

- **TUI:** press **`[c]`**, type, **Enter** (**Esc** cancels)
- **Web:** chat sidebar
- **Ollama folder agent:** follow `AGENTS.md`

1. Default → Ollama OpenAI-compat `POST {OLLAMA_BASE_URL}/v1/chat/completions`
2. If Ollama is down (or `CHAT_PROVIDER=xai`) → optional xAI / operator queue in `data/chat-outbound.json`

```bash
ollama pull qwen2.5-coder:14b
# .env
CHAT_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5-coder:14b
```

## Commands

| Command | Purpose |
|--------|---------|
| `setup` | Ollama / RPC / Jupiter wizard |
| `wallet create` / `npm run init-wallet` | Generate keypair (mode `0600`) |
| `wallet address` | Print public key |
| `wallet balance` | SOL balance |
| `wallet withdraw <pubkey> <sol>` | Send SOL (respects `DRY_RUN`) |
| `filters show` / `filters set <key> <value>` | Buy-block rules |
| `scan` | Candidates + reject reasons |
| `run [--once]` | Scan → filter → buy → monitor |
| `bot on` / `bot off` / `bot toggle` / `bot status` | Arm / disarm |
| `dashboard` | Terminal UI (`[c]` Olama chat) |
| `web` | Browser dashboard + chat |
| `status` / `history` | Wallet + tx log |

See [commands.md](./commands.md) for the NL → CLI map.

## Strategy defaults

- Buy: `0.05 SOL` (cap `0.25`) · TP / SL from `.env` · max 3 open positions
- `DRY_RUN=true` until **you** flip it (installer never sets live mode)

## Project layout

```
AGENTS.md                 Ollama workspace instructions
commands.md               NL → CLI cheat sheet
Modelfile                 optional `ollama create olama-trades`
.ollama/                  desktop open-folder hints
scripts/init-wallet.ts    first-run keypair (gitignored output)
scripts/install.sh|.ps1   one-shot installers
src/cli.ts                CLI
src/setup.ts              connections wizard
src/llm.ts                Ollama (+ optional xAI) client
src/chat.ts               Olama chat log + relay queue
src/wallet.ts             keypair create / balance / withdraw
src/config.ts             .env + config.json
src/signals/twitter.ts    X API, mint keywords, Ollama, or heuristic
src/ui/tui.ts web.ts      dashboards + chat
public/                   web SPA
SECURITY.md               threat model
LICENSE                   MIT
```

Forked from Techno’s solana-terminal-bot; this clone is Ollama-first and does not change the original repo.

## Safety

See [SECURITY.md](./SECURITY.md). Secrets stay in `.wallet/` and `.env`. Never paste your secret key into chat, logs, or GitHub.

## License

MIT — see [LICENSE](./LICENSE).
