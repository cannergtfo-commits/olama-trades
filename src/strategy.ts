import chalk from "chalk";
import { loadConfig } from "./config.js";
import { applyFilters, type CandidateToken } from "./filters.js";
import { checkTokenSafety } from "./security-checks.js";
import { scanDexScreenerBoosts } from "./scanners/dexscreener.js";
import { scanPumpFun } from "./scanners/pumpfun.js";
import { jupiterPriceUsd, quoteBuySolForToken } from "./scanners/jupiter.js";
import { checkTwitterSignal } from "./signals/twitter.js";
import { swapSolToToken, swapTokenToSol } from "./swap.js";
import {
  addPosition,
  closePosition,
  hasOpenMint,
  openPositions,
  type Position,
} from "./positions.js";
import { getTokenPriceUsd } from "./scanners/dexscreener.js";
import { randomUUID } from "node:crypto";
import { addTx } from "./history.js";

export interface ScanReportRow {
  token: CandidateToken;
  filterPass: boolean;
  filterReasons: string[];
  twitter?: string;
  jupiterOk?: boolean;
  safetyNote?: string;
}

export async function gatherCandidates(): Promise<{ tokens: CandidateToken[]; notes: string[] }> {
  const notes: string[] = [];
  const all: CandidateToken[] = [];

  try {
    const dex = await scanDexScreenerBoosts();
    notes.push(`DexScreener: ${dex.length} candidates`);
    all.push(...dex);
  } catch (e) {
    notes.push(`DexScreener error: ${(e as Error).message}`);
  }

  try {
    const pump = await scanPumpFun();
    notes.push(...pump.notes);
    notes.push(`Pump.fun path: ${pump.tokens.length} candidates`);
    all.push(...pump.tokens);
  } catch (e) {
    notes.push(`Pump.fun error: ${(e as Error).message}`);
  }

  // Fill missing prices via Jupiter
  const needPrice = all.filter((t) => !(t.priceUsd > 0)).map((t) => t.mint);
  if (needPrice.length) {
    const prices = await jupiterPriceUsd(needPrice);
    for (const t of all) {
      if (!(t.priceUsd > 0) && prices[t.mint]) t.priceUsd = prices[t.mint];
    }
  }

  const map = new Map<string, CandidateToken>();
  for (const t of all) {
    const prev = map.get(t.mint);
    if (!prev || t.volumeSpikeRatio > prev.volumeSpikeRatio) map.set(t.mint, t);
  }
  const tokens = [...map.values()].sort((a, b) => b.volumeSpikeRatio - a.volumeSpikeRatio);
  return { tokens, notes };
}

export async function scanOnce(): Promise<ScanReportRow[]> {
  const cfg = loadConfig();
  const { tokens, notes } = await gatherCandidates();
  for (const n of notes) console.log(chalk.dim(`  · ${n}`));

  const rows: ScanReportRow[] = [];
  // Pre-filter on market metrics (no RPC), then deep-check a small set (public RPC is harsh)
  const pre = tokens
    .map((token) => ({ token, fr: applyFilters(token, cfg.filters) }))
    .sort((a, b) => Number(b.fr.pass) - Number(a.fr.pass) || b.token.volumeSpikeRatio - a.token.volumeSpikeRatio);

  const deepLimit = 5;
  let deepDone = 0;

  for (const { token, fr: preFr } of pre.slice(0, 40)) {
    if (!preFr.pass) {
      rows.push({ token, filterPass: false, filterReasons: preFr.reasons });
      continue;
    }
    if (deepDone >= deepLimit) {
      rows.push({
        token,
        filterPass: false,
        filterReasons: ["passed market filters; skipped deep RPC (limit) — raise with private RPC"],
      });
      continue;
    }
    deepDone++;
    const safety = await checkTokenSafety(token.mint);
    const fr = applyFilters(token, cfg.filters, safety);
    const tw = await checkTwitterSignal(token);
    let jupiterOk: boolean | undefined;
    if (!tw.trending) {
      fr.reasons.push(`twitter: ${tw.detail}`);
      fr.pass = false;
    } else if (fr.pass) {
      const q = await quoteBuySolForToken(token.mint, Math.min(0.01, cfg.buyAmountSol));
      jupiterOk = q.ok;
      if (!q.ok) {
        fr.reasons.push(`jupiter route: ${q.error ?? "no route"}`);
        fr.pass = false;
      }
    }

    rows.push({
      token,
      filterPass: fr.pass,
      filterReasons: fr.reasons,
      twitter: tw.detail,
      jupiterOk,
      safetyNote: [
        safety.topHolderPercent !== undefined ? `top=${safety.topHolderPercent.toFixed(1)}%` : null,
        safety.top10HolderPercent !== undefined ? `top10=${safety.top10HolderPercent.toFixed(1)}%` : null,
        safety.mintAuthority ? `mintAuth=${safety.mintAuthority}` : null,
        safety.freezeAuthority ? `freezeAuth=${safety.freezeAuthority}` : null,
        ...(safety.errors ?? []).map((e) => `rpc:${e.slice(0, 60)}`),
      ]
        .filter(Boolean)
        .join(", "),
    });
    await sleep(1200);
  }

  return rows;
}

export async function tryEnter(token: CandidateToken): Promise<Position | null> {
  const cfg = loadConfig();
  if (openPositions().length >= cfg.maxOpenPositions) {
    console.log(chalk.yellow("Max open positions reached — skip entry"));
    return null;
  }
  if (hasOpenMint(token.mint)) {
    console.log(chalk.yellow(`Already in ${token.symbol}`));
    return null;
  }

  const safety = await checkTokenSafety(token.mint);
  const fr = applyFilters(token, cfg.filters, safety);
  const tw = await checkTwitterSignal(token);
  if (!tw.trending) fr.reasons.push(`twitter: ${tw.detail}`), (fr.pass = false);
  if (!fr.pass) {
    console.log(chalk.red(`Blocked ${token.symbol}: ${fr.reasons.join("; ")}`));
    return null;
  }

  const q = await quoteBuySolForToken(token.mint, cfg.buyAmountSol);
  if (!q.ok) {
    console.log(chalk.red(`No Jupiter route for ${token.symbol}: ${q.error}`));
    return null;
  }

  console.log(
    chalk.cyan(
      `Entering ${token.symbol} (${token.mint.slice(0, 6)}…) size=${cfg.buyAmountSol} SOL dryRun=${cfg.dryRun}`
    )
  );
  const swap = await swapSolToToken(token.mint, cfg.buyAmountSol);
  if (!swap.ok) {
    console.log(chalk.red(`Buy failed: ${swap.error}`));
    return null;
  }
  if (swap.detail) console.log(chalk.dim(swap.detail));

  const outAmount = Number(swap.outAmount ?? 0);
  const pos: Position = {
    id: randomUUID(),
    mint: token.mint,
    symbol: token.symbol,
    entryPriceUsd: token.priceUsd,
    amountToken: outAmount,
    amountSolSpent: cfg.buyAmountSol,
    takeProfitPct: cfg.takeProfitPct,
    stopLossPct: cfg.stopLossPct,
    openedAt: new Date().toISOString(),
    status: "open",
    dryRun: swap.dryRun,
    txBuy: swap.signature,
  };
  addPosition(pos);
  addTx({
    kind: "buy",
    mint: pos.mint,
    symbol: pos.symbol,
    amountSol: pos.amountSolSpent,
    amountToken: pos.amountToken,
    priceUsd: pos.entryPriceUsd,
    signature: pos.txBuy,
    dryRun: pos.dryRun,
    note: "entry",
  });
  console.log(
    chalk.green(
      `Opened ${pos.symbol} entry=$${pos.entryPriceUsd} TP=+${pos.takeProfitPct}% SL=-${pos.stopLossPct}%`
    )
  );
  return pos;
}

export async function monitorPositions(): Promise<void> {
  const positions = openPositions();
  if (!positions.length) return;

  for (const pos of positions) {
    let price = await getTokenPriceUsd(pos.mint);
    if (price === null) {
      const jp = await jupiterPriceUsd([pos.mint]);
      price = jp[pos.mint] ?? null;
    }
    if (price === null || !(pos.entryPriceUsd > 0)) {
      console.log(chalk.dim(`No price for ${pos.symbol} — skip`));
      continue;
    }
    const changePct = ((price - pos.entryPriceUsd) / pos.entryPriceUsd) * 100;
    console.log(
      chalk.white(
        `  ${pos.symbol}: $${price.toFixed(8)} (${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%) entry=$${pos.entryPriceUsd}`
      )
    );

    if (changePct >= pos.takeProfitPct) {
      await exitPosition(pos, "tp", price);
    } else if (changePct <= -pos.stopLossPct) {
      await exitPosition(pos, "sl", price);
    }
  }
}

async function exitPosition(pos: Position, reason: "tp" | "sl", price: number): Promise<void> {
  const cfg = loadConfig();
  console.log(
    chalk.magenta(
      `Exit ${pos.symbol} reason=${reason} price=$${price} dryRun=${cfg.dryRun || pos.dryRun}`
    )
  );
  let txSell: string | undefined;
  if (pos.amountToken > 0) {
    const swap = await swapTokenToSol(pos.mint, pos.amountToken);
    if (!swap.ok) {
      console.log(chalk.red(`Sell failed: ${swap.error} — marking closed anyway for dry-run safety`));
    } else {
      txSell = swap.signature;
      if (swap.detail) console.log(chalk.dim(swap.detail));
    }
  }
  const pnlPct = pos.entryPriceUsd > 0 ? ((price - pos.entryPriceUsd) / pos.entryPriceUsd) * 100 : 0;
  const pnlSolApprox = pos.amountSolSpent * (pnlPct / 100);
  addTx({
    kind: "sell",
    mint: pos.mint,
    symbol: pos.symbol,
    amountSol: pos.amountSolSpent,
    amountToken: pos.amountToken,
    priceUsd: price,
    pnlPct,
    pnlSol: pnlSolApprox,
    signature: txSell,
    dryRun: cfg.dryRun || pos.dryRun,
    note: `exit:${reason}`,
  });
  closePosition(pos.id, reason, price, txSell);
}

export async function runLoop(opts: { once?: boolean } = {}): Promise<void> {
  const cfg = loadConfig();
  const { setArmed, markTick } = await import("./bot-state.js");
  setArmed(true);
  console.log(
    chalk.bold(
      `\nBot run loop — BOT ON — dryRun=${cfg.dryRun} buy=${cfg.buyAmountSol} SOL TP=+${cfg.takeProfitPct}% SL=-${cfg.stopLossPct}% interval=${cfg.scanIntervalMs}ms\n`
    )
  );

  const tick = async () => {
    console.log(chalk.gray(`\n── scan ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT ──`));
    try {
      await monitorPositions();
      const rows = await scanOnce();
      const passes = rows.filter((r) => r.filterPass);
      console.log(chalk.bold(`Candidates checked=${rows.length} pass=${passes.length}`));
      for (const r of passes.slice(0, 5)) {
        await tryEnter(r.token);
      }
      markTick(`cli run: checked=${rows.length} pass=${passes.length}`);
    } catch (e) {
      console.log(chalk.red(`Tick error: ${(e as Error).message}`));
      markTick("cli run failed", (e as Error).message);
    }
  };

  try {
    await tick();
    if (opts.once) return;
    for (;;) {
      await sleep(cfg.scanIntervalMs);
      await tick();
    }
  } finally {
    if (opts.once) setArmed(false);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
