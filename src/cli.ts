#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { loadConfig, saveFilters } from "./config.js";
import { describeFilters, parseFilterSet } from "./filters.js";
import {
  createWallet,
  getAddress,
  getBalanceSol,
  withdrawSol,
  walletExists,
  safeWalletInfo,
} from "./wallet.js";
import { scanOnce, runLoop } from "./strategy.js";
import { openPositions, loadPositions } from "./positions.js";
import { rpcHealthy } from "./security-checks.js";
import {
  buildSnapshot,
  getBotState,
  armBot,
  disarmBot,
  toggleBotArmed,
} from "./state.js";
import { startEngine, stopEngine, forceTick, isEngineStarted } from "./engine.js";
import { recentTx, explorerTxUrl } from "./history.js";

const program = new Command();

program
  .name("solana-bot")
  .description("Experimental Solana terminal trading bot (DexScreener / Pump.fun / Jupiter)")
  .version("1.0.0");

const wallet = program.command("wallet").description("Manage the bot wallet");

wallet
  .command("create")
  .description("Generate a new keypair under .wallet/ (0600)")
  .action(() => {
    try {
      const { publicKey, path } = createWallet();
      console.log(chalk.green("Wallet created."));
      console.log(chalk.bold("Public address:"), publicKey);
      console.log(chalk.dim(`Keypair file: ${path} (never share this file)`));
      console.log(chalk.yellow("Fund this address with SOL, then set DRY_RUN=false only when ready."));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

wallet
  .command("address")
  .description("Print public address only")
  .action(() => {
    try {
      if (!walletExists()) {
        console.error(chalk.red("No wallet. Run: npm run bot -- wallet create"));
        process.exitCode = 1;
        return;
      }
      console.log(getAddress());
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

wallet
  .command("balance")
  .description("Show SOL balance")
  .action(async () => {
    try {
      const bal = await getBalanceSol();
      console.log(chalk.bold("Address:"), getAddress());
      console.log(chalk.bold("Balance:"), `${bal.toFixed(6)} SOL`);
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

wallet
  .command("withdraw")
  .argument("<pubkey>", "Destination Solana address")
  .argument("<sol>", "Amount of SOL")
  .description("Send SOL to an external pubkey")
  .action(async (pubkey: string, solStr: string) => {
    try {
      const amount = Number(solStr);
      const cfg = loadConfig();
      if (cfg.dryRun) {
        console.log(chalk.yellow("DRY_RUN=true — withdraw simulated. Set DRY_RUN=false for live."));
      }
      const result = await withdrawSol(pubkey, amount);
      console.log(chalk.green(result));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

const filtersCmd = program.command("filters").description("Show or set buy-block risk filters");

filtersCmd
  .command("show")
  .description("Print current filters")
  .action(() => {
    const cfg = loadConfig();
    console.log(chalk.bold("Risk filters (buys blocked when rules fail):\n"));
    console.log(describeFilters(cfg.filters));
    console.log(chalk.dim("\nExample: npm run bot -- filters set maxTopHolderPercent 15"));
  });

filtersCmd
  .command("set")
  .argument("<key>", "e.g. maxTopHolderPercent")
  .argument("<value>", "New value")
  .description("Set a filter key")
  .action((key: string, value: string) => {
    try {
      const cfg = loadConfig();
      const next = parseFilterSet(key, value, cfg.filters);
      saveFilters(next);
      console.log(chalk.green(`Updated ${key}`));
      console.log(describeFilters(next));
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command("scan")
  .description("Scan markets; print candidates and why rejected")
  .action(async () => {
    console.log(chalk.bold("Scanning markets…"));
    try {
      const rows = await scanOnce();
      if (!rows.length) {
        console.log(chalk.yellow("No candidates (rate limits or empty). Try again later."));
        return;
      }
      for (const r of rows) {
        const t = r.token;
        const head = `${t.symbol.padEnd(10)} ${t.mint.slice(0, 8)}… liq=$${t.liquidityUsd.toFixed(0)} vol24=$${t.volume24hUsd.toFixed(0)} spike=${t.volumeSpikeRatio.toFixed(2)}x src=${t.source}`;
        if (r.filterPass) {
          console.log(chalk.green("PASS  " + head));
        } else {
          console.log(chalk.red("BLOCK " + head));
          console.log(chalk.dim("      " + r.filterReasons.join(" | ")));
        }
        if (r.safetyNote) console.log(chalk.dim("      safety: " + r.safetyNote));
        if (r.twitter) console.log(chalk.dim("      twitter: " + r.twitter));
      }
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program
  .command("run")
  .option("--once", "Single tick then exit")
  .description("Arm bot and loop: scan → filter → buy → monitor TP/SL")
  .action(async (opts: { once?: boolean }) => {
    const cfg = loadConfig();
    if (!walletExists()) {
      console.error(chalk.red("Create a wallet first: npm run bot -- wallet create"));
      process.exitCode = 1;
      return;
    }
    if (cfg.dryRun) {
      console.log(chalk.yellow("DRY_RUN=true — swaps logged, not sent. Set DRY_RUN=false for live."));
    } else {
      console.log(chalk.red.bold("LIVE MODE — real swaps. Use small funds only."));
    }
    try {
      await runLoop({ once: !!opts.once });
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

const botCmd = program.command("bot").description("Arm/disarm trading engine (BOT ON/OFF)");

botCmd
  .command("status")
  .description("Show BOT ON/OFF and last tick")
  .action(() => {
    const s = getBotState();
    console.log(chalk.bold(`BOT: ${s.armed ? chalk.green("ON") : chalk.red("OFF")}`));
    console.log(`UI refresh: ${s.uiRefresh} (${s.uiRefreshMs}ms)`);
    console.log(`Last tick:  ${s.lastTickAt ?? "never"}`);
    console.log(`Summary:    ${s.lastTickSummary ?? "-"}`);
    if (s.lastError) console.log(chalk.red(`Error:      ${s.lastError}`));
    console.log(`Engine:     ${isEngineStarted() ? "started" : "stopped"}`);
  });

botCmd
  .command("on")
  .description("Arm trading flag (scan+buy+exits when an engine is running)")
  .action(() => {
    armBot();
    console.log(chalk.green("BOT ON — armed. Start a loop with: run | dashboard | web | bot tick"));
  });

botCmd
  .command("off")
  .description("Disarm trading")
  .action(() => {
    disarmBot();
    console.log(chalk.yellow("BOT OFF — scanning/buying/exits will not run"));
  });

botCmd
  .command("toggle")
  .description("Toggle BOT ON/OFF")
  .action(() => {
    const s = toggleBotArmed();
    console.log(s.armed ? chalk.green("BOT ON") : chalk.yellow("BOT OFF"));
  });

botCmd
  .command("tick")
  .description("Run a single engine tick (only acts if armed), then exit")
  .action(async () => {
    await forceTick();
    const s = getBotState();
    console.log(s.lastTickSummary ?? "done");
    if (s.lastError) console.log(chalk.red(s.lastError));
  });

program
  .command("status")
  .description("Wallet, config, open positions, bot arm state")
  .action(async () => {
    const cfg = loadConfig();
    const info = safeWalletInfo();
    const bot = getBotState();
    console.log(chalk.bold("=== Bot status ==="));
    console.log(`BOT:          ${bot.armed ? chalk.green("ON") : chalk.red("OFF")}`);
    console.log(`Wallet exists: ${info.exists}`);
    if (info.exists) {
      console.log(`Address:      ${info.address}`);
      console.log(`Keypair:      ${info.keypairPath}`);
      try {
        const bal = await getBalanceSol();
        console.log(`Balance:      ${bal.toFixed(6)} SOL`);
      } catch (e) {
        console.log(chalk.yellow(`Balance:      (RPC error: ${(e as Error).message})`));
      }
    }
    console.log(`RPC healthy:  ${await rpcHealthy()}`);
    console.log(`Dry run:      ${cfg.dryRun}`);
    console.log(`Buy amount:   ${cfg.buyAmountSol} SOL (cap ${cfg.maxBuyAmountSol})`);
    console.log(`TP / SL:      +${cfg.takeProfitPct}% / -${cfg.stopLossPct}%`);
    console.log(`Slippage:     ${cfg.slippageBps} bps`);
    console.log(chalk.bold("\nFilters:"));
    console.log(describeFilters(cfg.filters));
    const open = openPositions();
    console.log(chalk.bold(`\nOpen positions: ${open.length}`));
    for (const p of open) {
      console.log(
        `  ${p.symbol} mint=${p.mint.slice(0, 8)}… entry=$${p.entryPriceUsd} spent=${p.amountSolSpent} SOL dry=${p.dryRun}`
      );
    }
    const all = loadPositions().positions;
    console.log(chalk.dim(`Closed (history): ${all.filter((p) => p.status === "closed").length}`));
    const txs = recentTx(5);
    console.log(chalk.bold(`\nRecent txs: ${txs.length}`));
    for (const t of txs) {
      const sig = t.signature ? explorerTxUrl(t.signature) : "(dry/no sig)";
      console.log(
        `  [${t.kind}] ${t.symbol ?? ""} ${t.amountSol ?? ""} SOL ${t.dryRun ? "DRY" : ""} ${sig}`
      );
    }
  });

program
  .command("history")
  .description("Show recent buy/sell/withdraw records")
  .option("-n, --limit <n>", "rows", "20")
  .action((opts: { limit: string }) => {
    const rows = recentTx(Number(opts.limit) || 20);
    if (!rows.length) {
      console.log(chalk.dim("No transactions yet."));
      return;
    }
    for (const t of rows) {
      const when = new Date(t.timestamp).toLocaleString("en-US", { timeZone: "America/Los_Angeles" });
      const pnl =
        t.pnlPct !== undefined ? ` pnl=${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct.toFixed(2)}%` : "";
      const link = t.signature ? explorerTxUrl(t.signature) : "";
      console.log(
        `${when}  ${t.kind.toUpperCase().padEnd(8)} ${(t.symbol ?? "-").padEnd(10)} sol=${t.amountSol ?? "-"} ${t.dryRun ? "DRY" : "LIVE"}${pnl} ${link}`
      );
    }
  });

/**
 * Thin stubs — polished TUI/web live under src/ui + public (sibling agent).
 * Prefer dynamic import so core builds even if UI files are still landing.
 */
program
  .command("dashboard")
  .description("Terminal dashboard (TUI) — [b] BOT ON/OFF, [c] Olama chat, 10s refresh")
  .action(async () => {
    try {
      const mod = await import("./ui/tui.js");
      await mod.runTui();
    } catch (e) {
      console.error(chalk.red(`TUI failed: ${(e as Error).message}`));
      try {
        const snap = await buildSnapshot();
        console.log(
          JSON.stringify(
            {
              bot: snap.bot.armed ? "ON" : "OFF",
              dryRun: snap.config.dryRun,
              address: snap.wallet.address,
              balanceSol: snap.wallet.balanceSol,
              positions: snap.positions.length,
              history: snap.history.length,
            },
            null,
            2
          )
        );
      } catch {
        /* ignore */
      }
      process.exitCode = 1;
    }
  });


program
  .command("web")
  .description("Local web dashboard (Express) — BOT ON/OFF + Olama chat sidebar")
  .option("--no-open", "Do not spawn a browser window")
  .option("--port <n>", "Listen port", "8787")
  .action(async (opts: { open?: boolean; port?: string }) => {
    try {
      const mod = await import("./ui/web.js");
      await mod.runWeb({
        open: opts.open !== false,
        port: Number(opts.port) || 8787,
      });
    } catch (e) {
      console.error(chalk.red(`Web UI failed: ${(e as Error).message}`));
      console.log(chalk.dim("Fallback: GET snapshot via npm run bot -- status"));
      process.exitCode = 1;
    }
  });



program
  .command("setup")
  .description("Interactive connections wizard (Ollama, RPC, Jupiter, X) — writes .env safely")
  .action(async () => {
    try {
      const mod = await import("./setup.js");
      await mod.runSetup();
    } catch (e) {
      console.error(chalk.red((e as Error).message));
      process.exitCode = 1;
    }
  });

program.parseAsync(process.argv).catch((e) => {
  console.error(chalk.red(String(e)));
  process.exit(1);
});
