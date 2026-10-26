#!/usr/bin/env bash
# One-shot installer for olama-trades (macOS / Linux)
# Assumptions: bash available; Node.js 20+ on PATH (or user follows printed hints);
#              network for npm install; interactive TTY optional for API key prompts.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

CYAN='\033[0;36m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
DIM='\033[2m'
BOLD='\033[1m'
NC='\033[0m'

echo -e "${CYAN}${BOLD}"
echo "  ╔══════════════════════════════════════════╗"
echo "  ║   Solana Terminal Bot — installer        ║"
echo "  ║   Dry-run by default · secrets local     ║"
echo "  ╚══════════════════════════════════════════╝"
echo -e "${NC}"

if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}Node.js is not installed.${NC}"
  echo "Install Node 20+ then re-run:"
  echo "  macOS:   brew install node@20"
  echo "  Ubuntu:  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
  echo "  Or:      https://nodejs.org/"
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  echo -e "${RED}Node.js >= 20 required (found $(node -v)).${NC}"
  echo "Upgrade: https://nodejs.org/  or  nvm install 20"
  exit 1
fi
echo -e "${GREEN}✓${NC} Node $(node -v)"

if ! command -v npm >/dev/null 2>&1; then
  echo -e "${RED}npm not found (should ship with Node).${NC}"
  exit 1
fi

echo -e "${DIM}Installing npm dependencies…${NC}"
npm install

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo -e "${GREEN}✓${NC} Created .env from .env.example (DRY_RUN=true)"
else
  echo -e "${GREEN}✓${NC} Keeping existing .env"
fi

echo -e "${DIM}Building TypeScript…${NC}"
npm run build

# Upsert KEY=VALUE into .env without printing the value. Never touches DRY_RUN.
upsert_env() {
  local key="$1"
  local val="$2"
  KEY="$key" VAL="$val" node --input-type=module -e '
import fs from "node:fs";
const key = process.env.KEY;
const val = process.env.VAL;
if (!key || val === undefined || val === "") process.exit(0);
const path = ".env";
let text = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
const line = `${key}=${val}`;
const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
if (re.test(text)) text = text.replace(re, line);
else text = text.replace(/\s*$/, `\n${line}\n`);
fs.writeFileSync(path, text, "utf8");
'
}

prompt_secret() {
  local var_name="$1"
  local hint="$2"
  if grep -qE "^${var_name}=.+" .env 2>/dev/null; then
    echo -e "${DIM}  ${var_name} already set — leave blank to keep${NC}"
  fi
  echo -n "  ${hint}: "
  local value=""
  if [[ -t 0 ]]; then
    # -s hides input; never echo the secret
    read -r -s value || value=""
    echo
  else
    echo -e "${DIM}(non-interactive — skip)${NC}"
    return 0
  fi
  if [[ -z "${value}" ]]; then
    return 0
  fi
  upsert_env "$var_name" "$value"
  echo -e "${GREEN}✓${NC} Saved ${var_name} (value hidden)"
}

if [[ -t 0 ]]; then
  echo ""
  echo -e "${BOLD}Optional connections${NC} ${DIM}(Enter to skip any)${NC}"
  echo -e "${DIM}  Jupiter: https://portal.jup.ag/${NC}"
  echo -e "${DIM}  X/Twitter: https://developer.x.com/${NC}"
  echo -e "${DIM}  Ollama: https://ollama.com/  (ollama pull qwen2.5-coder:14b)${NC}"
  echo -e "${DIM}  xAI fallback (optional): https://console.x.ai/${NC}"
  prompt_secret "JUPITER_API_KEY" "Jupiter API key"
  prompt_secret "X_BEARER_TOKEN" "X/Twitter bearer token"
  prompt_secret "HELIUS_API_KEY" "Helius API key (optional)"
  prompt_secret "XAI_API_KEY" "xAI API key (optional fallback)"
  echo -n "  Custom RPC_URL (blank = keep): "
  rpc_val=""
  read -r rpc_val || rpc_val=""
  if [[ -n "${rpc_val}" ]]; then
    upsert_env "RPC_URL" "$rpc_val"
    echo -e "${GREEN}✓${NC} Updated RPC_URL"
  fi
else
  echo -e "${DIM}Non-interactive — skipped key prompts. Later: npm run bot -- setup${NC}"
fi

if [[ ! -f .wallet/keypair.json ]]; then
  echo -e "${DIM}Creating bot wallet…${NC}"
  npm run bot -- wallet create
else
  echo -e "${GREEN}✓${NC} Existing wallet kept (.wallet/keypair.json)"
fi

ADDR="$(npm run bot -- wallet address 2>/dev/null | tail -n1 || true)"

echo ""
echo -e "${GREEN}${BOLD}Install complete.${NC}"
echo -e "${BOLD}Fundable public address:${NC} ${CYAN}${ADDR}${NC}"
echo ""
echo -e "${BOLD}Next steps${NC}"
echo "  1. Connections wizard (anytime):  npm run bot -- setup"
echo "  2. Fund the address above with a little SOL"
echo "  3. Arm bot (still dry-run):        npm run bot -- bot on"
echo "  4. Scan:                           npm run bot -- scan"
echo "  5. Terminal UI:                    npm run bot -- dashboard"
echo "  6. Browser UI:                     npm run bot -- web"
echo ""
echo -e "${YELLOW}DRY_RUN stays true until you edit .env. Never commit .env or .wallet/${NC}"
