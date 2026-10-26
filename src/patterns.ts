/**
 * Candlestick / price-action setup detection aligned with solana-skill.
 * Prefers real OHLCV when available (GeckoTerminal); falls back to DexScreener
 * multi-TF priceChange proxies. Soft/graceful — never throws on thin data.
 */

import type { CandidateToken } from "./filters.js";

export type CandlePatternId =
  | "doji"
  | "hammer"
  | "hanging_man"
  | "bullish_engulfing"
  | "bearish_engulfing"
  | "marubozu_bull"
  | "marubozu_bear"
  | "shooting_star"
  | "three_white_soldiers"
  | "three_black_crows";

export interface CandleBar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ts?: number;
}

export interface PatternHit {
  id: CandlePatternId;
  bias: "bullish" | "bearish" | "neutral";
  strength: number; // 0–1
  source: "ohlcv" | "proxy";
  note?: string;
}

export interface PatternAnalysis {
  patterns: PatternHit[];
  /** Short tags for TUI/web e.g. ["hammer","bull_engulf"] */
  tags: string[];
  /** Net bullish setup score 0–100 (bearish subtracts). */
  bullishScore: number;
  bias: "bullish" | "bearish" | "neutral";
  dataQuality: "ohlcv" | "proxy" | "thin";
}

const TAG_SHORT: Record<CandlePatternId, string> = {
  doji: "doji",
  hammer: "hammer",
  hanging_man: "hang_man",
  bullish_engulfing: "bull_engulf",
  bearish_engulfing: "bear_engulf",
  marubozu_bull: "maru_bull",
  marubozu_bear: "maru_bear",
  shooting_star: "shoot_star",
  three_white_soldiers: "3soldiers",
  three_black_crows: "3crows",
};

function body(c: CandleBar): number {
  return Math.abs(c.close - c.open);
}
function range(c: CandleBar): number {
  return Math.max(1e-18, c.high - c.low);
}
function upperWick(c: CandleBar): number {
  return c.high - Math.max(c.open, c.close);
}
function lowerWick(c: CandleBar): number {
  return Math.min(c.open, c.close) - c.low;
}
function isBull(c: CandleBar): boolean {
  return c.close > c.open;
}
function isBear(c: CandleBar): boolean {
  return c.close < c.open;
}

/** Detect patterns from last N OHLCV bars (newest last). Soft — empty on bad data. */
export function detectFromOhlcv(bars: CandleBar[]): PatternHit[] {
  const hits: PatternHit[] = [];
  if (!Array.isArray(bars) || bars.length < 1) return hits;
  const clean = bars.filter(
    (b) =>
      b &&
      Number.isFinite(b.open) &&
      Number.isFinite(b.high) &&
      Number.isFinite(b.low) &&
      Number.isFinite(b.close) &&
      b.high >= b.low
  );
  if (clean.length < 1) return hits;

  const c = clean[clean.length - 1];
  const prev = clean.length >= 2 ? clean[clean.length - 2] : undefined;
  const r = range(c);
  const b = body(c);
  const uw = upperWick(c);
  const lw = lowerWick(c);
  const bodyRatio = b / r;

  // Doji: open ≈ close
  if (bodyRatio < 0.12) {
    hits.push({
      id: "doji",
      bias: "neutral",
      strength: 0.55,
      source: "ohlcv",
      note: "indecision",
    });
  }

  // Hammer / hanging man: small body, long lower wick
  if (lw >= 2 * b && uw <= b * 1.2 && bodyRatio < 0.4) {
    const bullishContext = prev ? prev.close > c.close || !isBull(prev) : true;
    hits.push({
      id: bullishContext ? "hammer" : "hanging_man",
      bias: bullishContext ? "bullish" : "bearish",
      strength: Math.min(1, lw / (b + 1e-18) / 4),
      source: "ohlcv",
    });
  }

  // Shooting star: small body, long upper wick
  if (uw >= 2 * b && lw <= b * 1.2 && bodyRatio < 0.4) {
    hits.push({
      id: "shooting_star",
      bias: "bearish",
      strength: Math.min(1, uw / (b + 1e-18) / 4),
      source: "ohlcv",
    });
  }

  // Marubozu: long body, little/no wick
  if (bodyRatio > 0.85 && b / r > 0.7) {
    hits.push({
      id: isBull(c) ? "marubozu_bull" : "marubozu_bear",
      bias: isBull(c) ? "bullish" : "bearish",
      strength: 0.75,
      source: "ohlcv",
      note: "momentum",
    });
  }

  // Engulfing
  if (prev) {
    const prevBody = body(prev);
    if (isBull(c) && isBear(prev) && c.close >= prev.open && c.open <= prev.close && b > prevBody) {
      hits.push({
        id: "bullish_engulfing",
        bias: "bullish",
        strength: Math.min(1, b / (prevBody + 1e-18) / 2),
        source: "ohlcv",
      });
    }
    if (isBear(c) && isBull(prev) && c.open >= prev.close && c.close <= prev.open && b > prevBody) {
      hits.push({
        id: "bearish_engulfing",
        bias: "bearish",
        strength: Math.min(1, b / (prevBody + 1e-18) / 2),
        source: "ohlcv",
      });
    }
  }

  // Three white soldiers / black crows
  if (clean.length >= 3) {
    const a = clean[clean.length - 3];
    const mid = clean[clean.length - 2];
    const last = clean[clean.length - 1];
    if (isBull(a) && isBull(mid) && isBull(last) && mid.close > a.close && last.close > mid.close) {
      const avgBody = (body(a) + body(mid) + body(last)) / 3;
      if (avgBody > 0) {
        hits.push({
          id: "three_white_soldiers",
          bias: "bullish",
          strength: 0.85,
          source: "ohlcv",
          note: "continuation",
        });
      }
    }
    if (isBear(a) && isBear(mid) && isBear(last) && mid.close < a.close && last.close < mid.close) {
      hits.push({
        id: "three_black_crows",
        bias: "bearish",
        strength: 0.85,
        source: "ohlcv",
        note: "continuation",
      });
    }
  }

  return hits;
}

/**
 * Proxy patterns from DexScreener multi-TF % changes when OHLCV is thin/missing.
 * Heuristic only — tagged source:"proxy".
 */
export function detectFromPriceChangeProxies(token: CandidateToken): PatternHit[] {
  const hits: PatternHit[] = [];
  const m5 = token.priceChange5m;
  const h1 = token.priceChange1h;
  const h6 = token.priceChange6h;
  const h24 = token.priceChange24h;
  const known = [m5, h1, h6, h24].filter((n): n is number => typeof n === "number" && Number.isFinite(n));
  if (known.length < 2) return hits;

  const abs5 = Math.abs(m5 ?? 0);
  const abs1 = Math.abs(h1 ?? 0);

  // Doji proxy: very flat short TF after a larger move
  if (typeof m5 === "number" && abs5 < 1.5 && abs1 > 8) {
    hits.push({
      id: "doji",
      bias: "neutral",
      strength: 0.4,
      source: "proxy",
      note: "flat 5m after move",
    });
  }

  // Hammer proxy: 1h red then 5m rebound
  if (typeof m5 === "number" && typeof h1 === "number" && h1 < -5 && m5 > 3 && m5 > Math.abs(h1) * 0.25) {
    hits.push({
      id: "hammer",
      bias: "bullish",
      strength: Math.min(1, (m5 + Math.abs(h1) / 4) / 20),
      source: "proxy",
      note: "5m bounce after 1h dip",
    });
  }

  // Shooting star proxy: strong prior pump, 5m rejection
  if (typeof m5 === "number" && typeof h1 === "number" && h1 > 12 && m5 < -4) {
    hits.push({
      id: "shooting_star",
      bias: "bearish",
      strength: Math.min(1, (Math.abs(m5) + h1 / 4) / 25),
      source: "proxy",
      note: "5m fade after pump",
    });
  }

  // Marubozu bull/bear proxy: dominant single-TF thrust
  if (typeof m5 === "number" && abs5 >= 12 && (typeof h1 !== "number" || Math.sign(m5) === Math.sign(h1) || abs1 < abs5)) {
    hits.push({
      id: m5 > 0 ? "marubozu_bull" : "marubozu_bear",
      bias: m5 > 0 ? "bullish" : "bearish",
      strength: Math.min(1, abs5 / 30),
      source: "proxy",
      note: "strong 5m thrust",
    });
  }

  // Engulfing proxy: 5m reverses and exceeds prior 1h move magnitude partially
  if (typeof m5 === "number" && typeof h1 === "number" && Math.sign(m5) !== Math.sign(h1) && abs5 > abs1 * 0.4 && abs5 > 4) {
    hits.push({
      id: m5 > 0 ? "bullish_engulfing" : "bearish_engulfing",
      bias: m5 > 0 ? "bullish" : "bearish",
      strength: Math.min(1, abs5 / (abs1 + 1e-6) / 2),
      source: "proxy",
      note: "5m reverses 1h",
    });
  }

  // Three soldiers / crows proxy: aligned 5m, 1h, 6h
  if (
    typeof m5 === "number" &&
    typeof h1 === "number" &&
    typeof h6 === "number" &&
    m5 > 2 &&
    h1 > 4 &&
    h6 > 6
  ) {
    hits.push({
      id: "three_white_soldiers",
      bias: "bullish",
      strength: 0.7,
      source: "proxy",
      note: "aligned multi-TF green",
    });
  }
  if (
    typeof m5 === "number" &&
    typeof h1 === "number" &&
    typeof h6 === "number" &&
    m5 < -2 &&
    h1 < -4 &&
    h6 < -6
  ) {
    hits.push({
      id: "three_black_crows",
      bias: "bearish",
      strength: 0.7,
      source: "proxy",
      note: "aligned multi-TF red",
    });
  }

  return hits;
}

export function summarizePatterns(hits: PatternHit[], dataQuality: PatternAnalysis["dataQuality"]): PatternAnalysis {
  const dedup = new Map<CandlePatternId, PatternHit>();
  for (const h of hits) {
    const prev = dedup.get(h.id);
    if (!prev || h.strength > prev.strength) dedup.set(h.id, h);
  }
  const patterns = [...dedup.values()];
  let score = 50;
  for (const p of patterns) {
    const w = 12 * p.strength;
    if (p.bias === "bullish") score += w;
    else if (p.bias === "bearish") score -= w;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  let bias: PatternAnalysis["bias"] = "neutral";
  if (score >= 58) bias = "bullish";
  else if (score <= 42) bias = "bearish";
  const tags = patterns
    .filter((p) => p.bias === "bullish" || p.id === "doji")
    .concat(patterns.filter((p) => p.bias === "bearish"))
    .map((p) => TAG_SHORT[p.id]);
  // Prefer unique short tags, bullish first already partially ordered
  const uniqTags = Array.from(new Set(tags)).slice(0, 4);
  return {
    patterns,
    tags: uniqTags,
    bullishScore: score,
    bias,
    dataQuality,
  };
}

/** Analyze token: optional OHLCV bars + always try priceChange proxies as fallback/add. */
export function analyzePatterns(token: CandidateToken, bars?: CandleBar[] | null): PatternAnalysis {
  try {
    const ohlcvHits = bars && bars.length ? detectFromOhlcv(bars) : [];
    if (ohlcvHits.length) {
      // Still merge useful proxy confirmation lightly
      const proxy = detectFromPriceChangeProxies(token);
      const merged = [
        ...ohlcvHits,
        ...proxy.filter((p) => !ohlcvHits.some((o) => o.id === p.id)),
      ];
      return summarizePatterns(merged, "ohlcv");
    }
    const proxyHits = detectFromPriceChangeProxies(token);
    if (proxyHits.length) return summarizePatterns(proxyHits, "proxy");
    return summarizePatterns([], "thin");
  } catch {
    return {
      patterns: [],
      tags: [],
      bullishScore: 50,
      bias: "neutral",
      dataQuality: "thin",
    };
  }
}

/**
 * Fetch recent minute OHLCV from GeckoTerminal for a Solana pair/pool address.
 * Returns null on any failure (rate limit, missing pool, network).
 */
export async function fetchOhlcvForPair(pairAddress?: string): Promise<CandleBar[] | null> {
  if (!pairAddress || pairAddress.length < 32) return null;
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/solana/pools/${encodeURIComponent(
      pairAddress
    )}/ohlcv/minute?aggregate=5&limit=12`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "solana-terminal-bot/1.0" },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { attributes?: { ohlcv_list?: Array<[number, number, number, number, number, number]> } };
    };
    const list = json?.data?.attributes?.ohlcv_list;
    if (!Array.isArray(list) || !list.length) return null;
    // Gecko: [ts, open, high, low, close, volume] — oldest first usually
    const bars: CandleBar[] = [];
    for (const row of list) {
      if (!Array.isArray(row) || row.length < 5) continue;
      const [ts, open, high, low, close, volume] = row;
      if (![open, high, low, close].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
      bars.push({ ts, open, high, low, close, volume: typeof volume === "number" ? volume : undefined });
    }
    return bars.length ? bars : null;
  } catch {
    return null;
  }
}

export function patternTagsLabel(analysis?: PatternAnalysis | null): string {
  if (!analysis || !analysis.tags.length) return analysis?.dataQuality === "thin" ? "no-pa" : "—";
  return analysis.tags.join(",");
}
