#!/usr/bin/env node
/**
 * First-run wallet init for Olama Trades.
 * Creates .wallet/keypair.json if missing, prints public address.
 * Never prints or commits the secret key.
 *
 * Usage: npm run init-wallet
 *    or: npx tsx scripts/init-wallet.ts
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function main() {
  // Ensure .env exists (DRY_RUN default)
  const envPath = path.join(ROOT, ".env");
  const example = path.join(ROOT, ".env.example");
  if (!fs.existsSync(envPath) && fs.existsSync(example)) {
    fs.copyFileSync(example, envPath);
    console.log("Created .env from .env.example (DRY_RUN=true)");
  }

  const { createWallet, walletExists, getAddress } = await import("../src/wallet.js");
  if (walletExists()) {
    console.log("Wallet already exists.");
    console.log("Public address:", getAddress());
    console.log("Secret stays in .wallet/keypair.json (gitignored). Never paste it into chat.");
    return;
  }
  const { publicKey, path: kpPath } = createWallet();
  console.log("✓ New wallet created at", kpPath);
  console.log("Public address:", publicKey);
  console.log("");
  console.log("Fund this address with SOL on Solana mainnet (start small).");
  console.log("DRY_RUN stays true until you edit .env — keep it that way until you intend live trades.");
  console.log("Never commit .wallet/ or paste the secret into Ollama chat.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
