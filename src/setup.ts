/**
 * Interactive connections wizard — writes optional settings into .env
 * without echoing secrets. Safe to re-run; blanks skip.
 * Olama Trades: Ollama/Qwen is primary; xAI is optional fallback.
 */
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { ROOT, writeEnvKey, loadConfig } from "./config.js";
import { createWallet, walletExists, getAddress, safeWalletInfo } from "./wallet.js";

function mask(v?: string): string {
  if (!v) return chalk.dim("not set");
  if (v.length <= 8) return chalk.green("set ·••••");
  return chalk.green(`set · ${v.slice(0, 4)}…${v.slice(-4)}`);
}

async function askSecret(rl: readline.Interface, label: string, already?: string): Promise<string | undefined> {
  if (already) {
    console.log(chalk.dim(`  current: ${mask(already)} — leave blank to keep`));
  }
  const ans = (await rl.question(`  ${label}: `)).trim();
  return ans || undefined;
}

async function askPlain(rl: readline.Interface, label: string, current?: string): Promise<string | undefined> {
  const hint = current ? chalk.dim(` [${current.slice(0, 48)}${current.length > 48 ? "…" : ""}]`) : "";
  const ans = (await rl.question(`  ${label}${hint}: `)).trim();
  return ans || undefined;
}

export async function runSetup(): Promise<void> {
  console.log(chalk.cyan.bold("\n  ◆ Olama Trades — connections setup\n"));
  console.log(chalk.dim("  Secrets are written to .env / .wallet only (gitignored). Blank = skip/keep.\n"));

  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    const example = path.join(ROOT, ".env.example");
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, envPath);
      console.log(chalk.green("  Created .env from .env.example"));
    } else {
      fs.writeFileSync(envPath, "DRY_RUN=true\nCHAT_PROVIDER=ollama\nOLLAMA_MODEL=qwen2.5-coder:14b\n", "utf8");
      console.log(chalk.green("  Created minimal .env"));
    }
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log(chalk.bold("Links"));
    console.log(chalk.dim("  Ollama          → https://ollama.com/  (pull: ollama pull qwen2.5-coder:14b)"));
    console.log(chalk.dim("  Jupiter API key → https://portal.jup.ag/"));
    console.log(chalk.dim("  X/Twitter bearer → https://developer.x.com/"));
    console.log(chalk.dim("  Helius RPC      → https://www.helius.dev/"));
    console.log(chalk.dim("  xAI (optional fallback) → https://console.x.ai/\n"));

    const cfg = loadConfig();

    const ollamaUrl = await askPlain(rl, "OLLAMA_BASE_URL", cfg.ollamaBaseUrl);
    if (ollamaUrl) {
      writeEnvKey("OLLAMA_BASE_URL", ollamaUrl);
      console.log(chalk.green("  ✓ OLLAMA_BASE_URL updated"));
    }

    const ollamaModel = await askPlain(rl, "OLLAMA_MODEL", cfg.ollamaModel);
    if (ollamaModel) {
      writeEnvKey("OLLAMA_MODEL", ollamaModel);
      console.log(chalk.green("  ✓ OLLAMA_MODEL updated"));
    }

    const provider = await askPlain(rl, "CHAT_PROVIDER (ollama|auto|xai)", cfg.chatProvider);
    if (provider) {
      writeEnvKey("CHAT_PROVIDER", provider);
      console.log(chalk.green("  ✓ CHAT_PROVIDER updated"));
    }

    const rpc = await askPlain(rl, "RPC_URL", cfg.rpcUrl);
    if (rpc) {
      writeEnvKey("RPC_URL", rpc);
      console.log(chalk.green("  ✓ RPC_URL updated"));
    }

    const jup = await askSecret(rl, "JUPITER_API_KEY", cfg.jupiterApiKey);
    if (jup) {
      writeEnvKey("JUPITER_API_KEY", jup);
      console.log(chalk.green("  ✓ JUPITER_API_KEY saved (hidden)"));
    }

    const xBearer = await askSecret(rl, "X_BEARER_TOKEN", cfg.xBearerToken);
    if (xBearer) {
      writeEnvKey("X_BEARER_TOKEN", xBearer);
      console.log(chalk.green("  ✓ X_BEARER_TOKEN saved (hidden)"));
    }

    const helius = await askSecret(rl, "HELIUS_API_KEY", cfg.heliusApiKey);
    if (helius) {
      writeEnvKey("HELIUS_API_KEY", helius);
      console.log(chalk.green("  ✓ HELIUS_API_KEY saved (hidden)"));
    }

    const xai = await askSecret(rl, "XAI_API_KEY (optional fallback)", cfg.xaiApiKey);
    if (xai) {
      writeEnvKey("XAI_API_KEY", xai);
      console.log(chalk.green("  ✓ XAI_API_KEY saved (hidden)"));
    }

    console.log("");
    if (!walletExists()) {
      const yn = (await rl.question("  Create bot wallet now? [Y/n]: ")).trim().toLowerCase();
      if (yn === "" || yn === "y" || yn === "yes") {
        const { publicKey } = createWallet();
        console.log(chalk.green(`  ✓ Wallet created`));
        console.log(chalk.bold("  Public address:"), publicKey);
        console.log(chalk.yellow("  Fund this address with SOL. Never paste the secret key into chat."));
      }
    } else {
      console.log(chalk.green("  ✓ Wallet exists:"), getAddress());
    }

    const after = loadConfig();
    const info = safeWalletInfo();
    console.log(chalk.bold("\n  Status"));
    console.log(`  DRY_RUN          ${after.dryRun ? chalk.yellow("true (safe)") : chalk.red("false (LIVE)")}`);
    console.log(`  CHAT_PROVIDER    ${after.chatProvider}`);
    console.log(`  Ollama           ${after.ollamaBaseUrl} · ${after.ollamaModel}`);
    console.log(`  RPC              ${after.rpcUrl}`);
    console.log(`  Jupiter key      ${mask(after.jupiterApiKey)}`);
    console.log(`  X bearer         ${mask(after.xBearerToken)}`);
    console.log(`  xAI fallback     ${mask(after.xaiApiKey)}`);
    console.log(`  Helius key       ${mask(after.heliusApiKey)}`);
    console.log(`  Wallet           ${info.exists ? info.address : chalk.yellow("missing — run: npm run bot -- wallet create")}`);
    console.log("");
    console.log(chalk.bold("  Next"));
    console.log("    ollama pull qwen2.5-coder:14b");
    console.log("    npm run bot -- bot on");
    console.log("    npm run bot -- scan");
    console.log("    npm run bot -- dashboard   # TUI + Olama chat ([c])");
    console.log("    npm run bot -- web         # browser UI + chat sidebar");
    console.log(chalk.dim("\n  Chat uses local Ollama by default. See AGENTS.md / commands.md.\n"));
  } finally {
    rl.close();
  }
}
