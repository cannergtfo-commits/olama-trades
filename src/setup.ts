/**
 * Interactive connections wizard — writes optional API keys into .env
 * without echoing secrets. Safe to re-run; blanks skip.
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
  // readline.promises doesn't support silent input; warn user & accept typed value
  // (install.sh uses -s; this wizard is for convenience after install)
  const ans = (await rl.question(`  ${label}: `)).trim();
  return ans || undefined;
}

async function askPlain(rl: readline.Interface, label: string, current?: string): Promise<string | undefined> {
  const hint = current ? chalk.dim(` [${current.slice(0, 48)}${current.length > 48 ? "…" : ""}]`) : "";
  const ans = (await rl.question(`  ${label}${hint}: `)).trim();
  return ans || undefined;
}

export async function runSetup(): Promise<void> {
  console.log(chalk.cyan.bold("\n  ◆ Techno / Solana bot — connections setup\n"));
  console.log(chalk.dim("  Secrets are written to .env only (gitignored). Blank = skip/keep.\n"));

  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) {
    const example = path.join(ROOT, ".env.example");
    if (fs.existsSync(example)) {
      fs.copyFileSync(example, envPath);
      console.log(chalk.green("  Created .env from .env.example"));
    } else {
      fs.writeFileSync(envPath, "DRY_RUN=true\n", "utf8");
      console.log(chalk.green("  Created minimal .env"));
    }
  }

  const rl = readline.createInterface({ input, output });
  try {
    console.log(chalk.bold("Links"));
    console.log(chalk.dim("  Jupiter API key → https://portal.jup.ag/"));
    console.log(chalk.dim("  X/Twitter bearer → https://developer.x.com/"));
    console.log(chalk.dim("  xAI / Grok key  → https://console.x.ai/"));
    console.log(chalk.dim("  Helius RPC      → https://www.helius.dev/\n"));

    const cfg = loadConfig();

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

    const xai = await askSecret(rl, "XAI_API_KEY (Grok / Techno chat)", cfg.xaiApiKey);
    if (xai) {
      writeEnvKey("XAI_API_KEY", xai);
      console.log(chalk.green("  ✓ XAI_API_KEY saved (hidden)"));
    }

    const helius = await askSecret(rl, "HELIUS_API_KEY", cfg.heliusApiKey);
    if (helius) {
      writeEnvKey("HELIUS_API_KEY", helius);
      console.log(chalk.green("  ✓ HELIUS_API_KEY saved (hidden)"));
    }

    // Wallet
    console.log("");
    if (!walletExists()) {
      const yn = (await rl.question("  Create bot wallet now? [Y/n]: ")).trim().toLowerCase();
      if (yn === "" || yn === "y" || yn === "yes") {
        const { publicKey } = createWallet();
        console.log(chalk.green(`  ✓ Wallet created`));
        console.log(chalk.bold("  Public address:"), publicKey);
      }
    } else {
      console.log(chalk.green("  ✓ Wallet exists:"), getAddress());
    }

    // Refresh config view
    const after = loadConfig();
    const info = safeWalletInfo();
    console.log(chalk.bold("\n  Status"));
    console.log(`  DRY_RUN          ${after.dryRun ? chalk.yellow("true (safe)") : chalk.red("false (LIVE)")}`);
    console.log(`  RPC              ${after.rpcUrl}`);
    console.log(`  Jupiter key      ${mask(after.jupiterApiKey)}`);
    console.log(`  X bearer         ${mask(after.xBearerToken)}`);
    console.log(`  xAI / Grok key   ${mask(after.xaiApiKey)}`);
    console.log(`  Helius key       ${mask(after.heliusApiKey)}`);
    console.log(`  Wallet           ${info.exists ? info.address : chalk.yellow("missing")}`);
    console.log("");
    console.log(chalk.bold("  Next"));
    console.log("    npm run bot -- bot on");
    console.log("    npm run bot -- scan");
    console.log("    npm run bot -- dashboard   # TUI + Techno chat ([c])");
    console.log("    npm run bot -- web         # browser UI + chat sidebar");
    console.log(chalk.dim("\n  Chat uses XAI_API_KEY when set; otherwise messages queue for operator relay.\n"));
  } finally {
    rl.close();
  }
}
