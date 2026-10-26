import chalk from "chalk";
import { loadConfig } from "./config.js";
import { applyFilters, type CandidateToken } from "./filters.js";
import { checkTokenSafety } from "./security-checks.js";
import { getBalanceSol } from "./wallet.js";
import { scanDexScreenerBoosts, fetchTokensByMints, getTokenPriceUsd } from "./scanners/dexscreener.js";
import { scanPumpFun } from "./scanners/pumpfun.js";
import { jupiterPriceUsd, quoteBuySolForToken, scanJupiterOrganic } from "./scanners/jupiter.js";
import { checkTwitterSignal } from "./signals/twitter.js";
import { swapSolToToken, swapTokenToSol } from "./swap.js";
import {
  addPosition,
  closePosition,
  hasOpenMint,
  openPositions,
  type Position,
} from "./positions.js";
import { randomUUID } from "node:crypto";
import { addTx } from "./history.js";
import {
  enrichAndRank,
  hasGoodSetup,
  liquidityRiskNote,
  meetsMinConfluence,
  mergeCandidates,
  sortForTryEnter,
  sourceTags,
  volumeSummary,
} from "./confluence.js";
import {
  candidateMatchesWatchedMint,
  parseKeywords,
  resolveWatchedMints,
} from "./keywords.js";
import {
  analyzePatterns,
  fetchOhlcvForPair,
} from "./patterns.js";

export interface ScanReportRow {
  token: CandidateToken;
  filterPass: boolean;
  filterReasons: string[];
  twitter?: string;
  jupiterOk?: boolean;
  safetyNote?: string;
  confluenceScore?: number;
  bondingStatus?: string;
  volumeSummary?: string;
  liquidityRiskNote?: string;
  sourceTags?: string[];
  patternTags?: string[];
  patternScore?: number;
  patternBias?: string;
}

/** Prefer configured buy size, never more than maxBuy, never >= portfolio, leave gas. */
export async function computeBuySizeSol(): Promise<{ size: number; balance: number; reason?: string }> {
  const cfg = loadConfig();
  const balance = await getBalanceSol();
  const pctCap = Math.max(0, Math.min(90, cfg.maxPortfolioBuyPct)) / 100;
  const afterReserve = Math.max(0, balance - cfg.minSolReserve);
  const portfolioCap = afterReserve * pctCap;
  const size = Math.min(cfg.buyAmountSol, cfg.maxBuyAmountSol, portfolioCap);
  if (size <= 0.001) {
    return {
      size: 0,
      balance,
      reason: `insufficient SOL after reserve (bal=${balance.toFixed(4)}, reserve=${cfg.minSolReserve})`,
    };
  }
  return { size: Number(size.toFixed(6)), balance };
}

export async function gatherCandidates(): Promise<{ tokens: CandidateToken[]; notes: string[] }> {
  const notes: string[] = [];
  const all: CandidateToken[] = [];
  const cfg = loadConfig();

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

  try {
    const jup = await scanJupiterOrganic();
    notes.push(...jup.notes);
    all.push(...jup.tokens);
  } catch (e) {
    notes.push(`Jupiter discovery error: ${(e as Error).message}`);
  }

  // Watched mint keywords (contract addresses) → fetch Dex pairs + mark match
  const hotPreview = all
    .slice()
    .sort((a, b) => (b.volumeSpikeRatio || 0) - (a.volumeSpikeRatio || 0))
    .slice(0, 5)
    .map((t) => t.mint);
  const watched = resolveWatchedMints(cfg, { hotScanMints: hotPreview });
  const { mints: configuredMints } = parseKeywords(cfg.twitter.keywords);
  if (watched.length) {
    notes.push(`Watched mints: ${watched.length} (configured=${configuredMints.length})`);
    try {
      const watchedTokens = await fetchTokensByMints(watched);
      notes.push(`Watched-mint Dex lookup: ${watchedTokens.length} pairs`);
      all.push(...watchedTokens);
    } catch (e) {
      notes.push(`Watched-mint lookup error: ${(e as Error).message}`);
    }
  }

  // Fill missing prices via Jupiter
  const needPrice = all.filter((t) => !(t.priceUsd > 0)).map((t) => t.mint);
  if (needPrice.length) {
    const prices = await jupiterPriceUsd(needPrice);
    for (const t of all) {
      if (!(t.priceUsd > 0) && prices[t.mint]) t.priceUsd = prices[t.mint];
    }
  }

  // Flag any candidate whose mint is on the watch list
  for (const t of all) {
    if (candidateMatchesWatchedMint(t, watched)) t.watchedMintMatch = true;
  }

  const merged = mergeCandidates(all);
  // Candlestick / PA setups (OHLCV when possible, else Dex multi-TF proxies)
  let patternHits = 0;
  let ohlcvOk = 0;
  const patternBudget = Math.min(18, merged.length);
  for (let i = 0; i < patternBudget; i++) {
    const t = merged[i];
    try {
      let bars = null as Awaited<ReturnType<typeof fetchOhlcvForPair>>;
      if (t.pairAddress) {
        bars = await fetchOhlcvForPair(t.pairAddress);
        if (bars?.length) ohlcvOk++;
        await sleep(120);
      }
      const pa = analyzePatterns(t, bars);
      t.patternTags = pa.tags;
      t.patternScore = pa.bullishScore;
      t.patternBias = pa.bias;
      t.patternDataQuality = pa.dataQuality;
      if (pa.tags.length) patternHits++;
    } catch {
      t.patternTags = [];
      t.patternScore = 50;
      t.patternBias = "neutral";
      t.patternDataQuality = "thin";
    }
  }
  // Remaining: proxy-only, no network
  for (let i = patternBudget; i < merged.length; i++) {
    const t = merged[i];
    try {
      const pa = analyzePatterns(t, null);
      t.patternTags = pa.tags;
      t.patternScore = pa.bullishScore;
      t.patternBias = pa.bias;
      t.patternDataQuality = pa.dataQuality;
      if (pa.tags.length) patternHits++;
    } catch {
      t.patternTags = [];
      t.patternScore = 50;
      t.patternBias = "neutral";
      t.patternDataQuality = "thin";
    }
  }

  const ranked = enrichAndRank(merged, cfg);
  const pumpN = ranked.filter((t) => t.pumpCallout).length;
  const bullishPa = ranked.filter((t) => t.patternBias === "bullish").length;
  notes.push(
    `Merged=${merged.length} ranked (minSources=${cfg.minConfluenceSources}, preferGraduated=${cfg.preferGraduated}, preferPump=${cfg.preferPumpCallouts}, riskOn=${cfg.riskOnTest}, pumpCallouts=${pumpN})`
  );
  notes.push(`Patterns: tagged=${patternHits} bullish=${bullishPa} ohlcv=${ohlcvOk}/${patternBudget}`);
  return { tokens: ranked, notes };
}

function annotateRow(
  token: CandidateToken,
  fr: { pass: boolean; reasons: string[] },
  extra: Partial<ScanReportRow> = {}
): ScanReportRow {
  const cfg = loadConfig();
  const riskNote = liquidityRiskNote(token, cfg.maxVolumeToLiquidityRatio);
  return {
    token,
    filterPass: fr.pass,
    filterReasons: fr.reasons,
    confluenceScore: token.confluenceScore,
    bondingStatus: token.bondingStatus ?? "unknown",
    volumeSummary: volumeSummary(token),
    liquidityRiskNote: riskNote,
    sourceTags: sourceTags(token),
    patternTags: token.patternTags,
    patternScore: token.patternScore,
    patternBias: token.patternBias,
    ...extra,
  };
}

export async function scanOnce(): Promise<ScanReportRow[]> {
  const cfg = loadConfig();
  const { tokens, notes } = await gatherCandidates();
  for (const n of notes) console.log(chalk.dim(`  · ${n}`));

  const rows: ScanReportRow[] = [];
  const riskOn = cfg.riskOnTest;
  // Prefer high-confluence / pattern setups first, then market filters, then deep RPC
  const pre = tokens.map((token) => {
    const fr = applyFilters(token, cfg.filters);
    if (!meetsMinConfluence(token, cfg.minConfluenceSources)) {
      fr.reasons.push(
        `confluence sources=${sourceTags(token).join(",") || "none"} < min ${cfg.minConfluenceSources}`
      );
      fr.pass = false;
    }
    // Soft liquidity risk hard-fail — DISABLED in risk-on test
    if (!riskOn) {
      const riskNote = liquidityRiskNote(token, cfg.maxVolumeToLiquidityRatio);
      if (riskNote && token.liquidityRisk === "high" && (token.confluenceScore ?? 0) < 40) {
        fr.reasons.push(`${riskNote} — need higher confluence for high liq risk`);
        fr.pass = false;
      }
    }
    // Prefer graduated hard gate — DISABLED in risk-on test (soft rank only)
    if (
      !riskOn &&
      cfg.preferGraduated &&
      token.bondingStatus === "bonding" &&
      sourceTags(token).length < 2 &&
      !(token.organicScore && token.organicScore >= 30)
    ) {
      fr.reasons.push("still on bonding curve — prefer graduated (or more sources/organic)");
      fr.pass = false;
    }
    // Risk-on / pattern mode: require bullish candle or indicator setup
    if (riskOn && !hasGoodSetup(token, cfg.minPatternScore)) {
      fr.reasons.push(
        `no bullish setup (bias=${token.patternBias ?? "?"} score=${token.patternScore ?? "?"} mom=${token.momentumHint ?? "n/a"})`
      );
      fr.pass = false;
    }
    return { token, fr };
  });

  const deepLimit = riskOn ? 8 : 5;
  let deepDone = 0;

  for (const { token, fr: preFr } of pre.slice(0, 40)) {
    if (!preFr.pass) {
      rows.push(annotateRow(token, preFr));
      continue;
    }
    if (deepDone >= deepLimit) {
      rows.push(
        annotateRow(token, {
          pass: false,
          reasons: [
            riskOn
              ? "passed pattern setup; skipped deep quote (limit)"
              : "passed market+confluence; skipped deep RPC (limit) — raise with private RPC",
          ],
        })
      );
      continue;
    }
    deepDone++;
    // Risk-on: skip holder/authority RPC fail-closed; still annotate lightly when cheap
    let safety = undefined as Awaited<ReturnType<typeof checkTokenSafety>> | undefined;
    let safetyNote: string | undefined;
    if (!riskOn) {
      safety = await checkTokenSafety(token.mint);
      safetyNote = [
        safety.topHolderPercent !== undefined ? `top=${safety.topHolderPercent.toFixed(1)}%` : null,
        safety.top10HolderPercent !== undefined
          ? `top10=${safety.top10HolderPercent.toFixed(1)}%`
          : null,
        safety.bundlerPercent !== undefined
          ? `bundler=${safety.bundlerPercent.toFixed(2)}%${
              safety.bundlerSource ? `@${safety.bundlerSource}` : ""
            }`
          : "bundler=unknown",
        safety.mintAuthority ? `mintAuth=${safety.mintAuthority}` : null,
        safety.freezeAuthority ? `freezeAuth=${safety.freezeAuthority}` : null,
        ...(safety.errors ?? []).map((e) => `rpc:${e.slice(0, 60)}`),
      ]
        .filter(Boolean)
        .join(", ");
    } else {
      safetyNote = "risk-on: holder/authority RPC skipped";
    }
    const fr = applyFilters(token, cfg.filters, safety);
    if (!meetsMinConfluence(token, cfg.minConfluenceSources)) {
      fr.reasons.push(`confluence sources < min ${cfg.minConfluenceSources}`);
      fr.pass = false;
    }
    if (riskOn && !hasGoodSetup(token, cfg.minPatternScore)) {
      fr.reasons.push(`no bullish setup (score=${token.patternScore ?? "?"})`);
      fr.pass = false;
    }
    const watchedNow = resolveWatchedMints(cfg);
    if (candidateMatchesWatchedMint(token, watchedNow)) token.watchedMintMatch = true;
    const tw = await checkTwitterSignal(token, { watchedMints: watchedNow });
    token.twitterTrending = tw.trending;
    if (tw.watchedMintMatch) token.watchedMintMatch = true;
    let jupiterOk: boolean | undefined;
    // Twitter: hard fail when NOT risk-on; soft annotate in risk-on test
    if (!tw.trending) {
      if (riskOn) {
        fr.reasons.push(`twitter soft: ${tw.detail}`);
      } else {
        fr.reasons.push(`twitter: ${tw.detail}`);
        fr.pass = false;
      }
    }
    if (fr.pass) {
      const q = await quoteBuySolForToken(token.mint, Math.min(0.01, cfg.buyAmountSol));
      jupiterOk = q.ok;
      if (!q.ok) {
        fr.reasons.push(`jupiter route: ${q.error ?? "no route"}`);
        fr.pass = false;
        if (token.bondingStatus === "bonding") {
          fr.reasons.push("on bonding curve — no Jupiter route");
        }
      }
    }

    rows.push(
      annotateRow(token, fr, {
        twitter: tw.detail,
        jupiterOk,
        safetyNote,
      })
    );
    await sleep(riskOn ? 600 : 1200);
  }

  // Keep confluence-ranked order in the report
  rows.sort((a, b) => (b.confluenceScore ?? 0) - (a.confluenceScore ?? 0));
  return rows;
}

export async function tryEnter(token: CandidateToken): Promise<Position | null> {
  const cfg = loadConfig();
  const riskOn = cfg.riskOnTest;
  if (openPositions().length >= cfg.maxOpenPositions) {
    console.log(chalk.yellow("Max open positions reached — skip entry"));
    return null;
  }
  if (hasOpenMint(token.mint)) {
    console.log(chalk.yellow(`Already in ${token.symbol}`));
    return null;
  }

  if (!meetsMinConfluence(token, cfg.minConfluenceSources)) {
    console.log(
      chalk.yellow(
        `Skip ${token.symbol}: confluence ${sourceTags(token).join(",") || "none"} < min ${cfg.minConfluenceSources}`
      )
    );
    return null;
  }

  if (riskOn && !hasGoodSetup(token, cfg.minPatternScore)) {
    console.log(
      chalk.yellow(
        `Skip ${token.symbol}: no bullish setup (bias=${token.patternBias ?? "?"} score=${token.patternScore ?? "?"})`
      )
    );
    return null;
  }

  // Risk-on: skip holder/authority RPC gates; still apply market filters (mostly off)
  const safety = riskOn ? undefined : await checkTokenSafety(token.mint);
  const fr = applyFilters(token, cfg.filters, safety);
  const watchedNow = resolveWatchedMints(cfg);
  if (candidateMatchesWatchedMint(token, watchedNow)) token.watchedMintMatch = true;
  const tw = await checkTwitterSignal(token, { watchedMints: watchedNow });
  if (tw.watchedMintMatch) token.watchedMintMatch = true;
  if (!tw.trending) {
    if (riskOn) {
      fr.reasons.push(`twitter soft: ${tw.detail}`);
    } else {
      fr.reasons.push(`twitter: ${tw.detail}`);
      fr.pass = false;
    }
  }
  if (!fr.pass) {
    console.log(chalk.red(`Blocked ${token.symbol}: ${fr.reasons.join("; ")}`));
    return null;
  }

  const sized = await computeBuySizeSol();
  if (sized.size <= 0) {
    console.log(chalk.yellow(`Skip buy: ${sized.reason}`));
    return null;
  }

  const q = await quoteBuySolForToken(token.mint, sized.size);
  if (!q.ok) {
    console.log(chalk.red(`No Jupiter route for ${token.symbol}: ${q.error}`));
    return null;
  }

  console.log(
    chalk.cyan(
      `Entering ${token.symbol} (${token.mint.slice(0, 6)}…) size=${sized.size} SOL (bal=${sized.balance.toFixed(4)}, max ${cfg.maxPortfolioBuyPct}% port) dryRun=${cfg.dryRun} conf=${token.confluenceScore ?? "?"} bond=${token.bondingStatus ?? "?"} tags=${sourceTags(token).join("+")} pa=${(token.patternTags ?? []).join(",") || "none"} score=${token.patternScore ?? "?"}`
    )
  );
  const swap = await swapSolToToken(token.mint, sized.size);
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
    amountSolSpent: sized.size,
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
    note: `entry conf=${token.confluenceScore ?? "?"} ${sourceTags(token).join("+")}`,
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
      `\nBot run loop — BOT ON — dryRun=${cfg.dryRun} buy=${cfg.buyAmountSol} SOL TP=+${cfg.takeProfitPct}% SL=-${cfg.stopLossPct}% interval=${cfg.scanIntervalMs}ms confluence≥${cfg.minConfluenceSources} riskOn=${cfg.riskOnTest}\n`
    )
  );

  const tick = async () => {
    console.log(
      chalk.gray(
        `\n── scan ${new Date().toLocaleString("en-US", { timeZone: "America/Los_Angeles" })} PT ──`
      )
    );
    try {
      await monitorPositions();
      const rows = await scanOnce();
      // High-confluence passes first (scanOnce already sorts by score)
      const passes = sortForTryEnter(
        rows.filter((r) => r.filterPass),
        cfg
      );
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
