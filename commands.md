# commands.md — Olama Trades cheat sheet

All commands from repo root. Default **DRY_RUN=true**.

## Quick start

```bash
ollama pull qwen2.5-coder:14b
npm install && npm run build
npm run init-wallet          # create .wallet/keypair.json if missing
npm run bot -- setup         # optional: RPC / Jupiter / Ollama URL
npm run bot -- bot on
npm run bot -- scan
npm run bot -- dashboard     # [b] arm · [c] chat with Olama
```

## Bot arming

```bash
npm run bot -- bot on
npm run bot -- bot off
npm run bot -- bot toggle
npm run bot -- bot status
```

## Scan & trade loop

```bash
npm run bot -- scan
npm run bot -- run --once
npm run bot -- run
```

## Wallet

```bash
npm run init-wallet
npm run bot -- wallet create
npm run bot -- wallet address
npm run bot -- wallet balance
npm run bot -- wallet withdraw <pubkey> <sol>
```

## Filters & status

```bash
npm run bot -- filters show
npm run bot -- filters set maxTopHolderPercent 15
npm run bot -- status
npm run bot -- history
```

## UI

```bash
npm run bot -- dashboard
npm run bot -- web            # http://127.0.0.1:8787
```

## Env knobs (edit `.env`)

| Key | Meaning |
|-----|---------|
| `DRY_RUN` | `true` = no real swaps |
| `CHAT_PROVIDER` | `ollama` (default) | `auto` | `xai` |
| `OLLAMA_BASE_URL` | default `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | default `qwen2.5-coder:14b` |
| `BUY_AMOUNT_SOL` | size per entry |
| `TAKE_PROFIT_PCT` / `STOP_LOSS_PCT` | exits |

Never paste secrets into chat. Public address only.
