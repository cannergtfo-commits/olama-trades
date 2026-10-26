/**
 * Skill-aligned confluence scoring: prefer tokens seen across Pump / Dex / Jupiter
 * with rising short-term volume, healthy liquidity vs volume, and graduation awareness.
 */
import type { CandidateToken } from "./filters.js";
import type { AppConfig } from "./config.js";

const SOURCE_FAMILY: Record<string, "pump" | "dex" | "jup"> = {
  "pumpfun-frontend-api": "pump",
  "pumpfun-via-dexscreener": "pump",
  pumpfun: "pump",
  dexscreener: "dex",
  "dexscreener-search": "dex",
  "dexscreener-profiles": "dex",
  "dexscreener-boost": "dex",
  jupiter: "jup",
  "jupiter-organic": "jup",
  "jupiter-recent": "jup",
};

export function sourceFamily(source: string): "pump" | "dex" | "jup" | "other" {
  const s = source.toLowerCase();
  if (SOURCE_FAMILY[s]) return SOURCE_FAMILY[s];
  if (s.includes("pump")) return "pump";
  if (s.includes("dex")) return "dex";
  if (s.includes("jup")) return "jup";
  return "other";
}

export function sourceTags(token: CandidateToken): Array<"pump" | "dex" | "jup"> {
  const tags = new Set<"pump" | "dex" | "jup">();
  const all = [token.source, ...(token.sources ?? [])];
  for (const s of all) {
    const f = sourceFamily(s);
    if (f !== "other") tags.add(f);
  }
  return [...tags];
}

export function volumeToLiquidityRatio(token: CandidateToken): number {
  if (!(token.liquidityUsd > 0)) {
    return token.volume24hUsd > 0 ? Number.POSITIVE_INFINITY : 0;
  }
  return token.volume24hUsd / token.liquidityUsd;
}

export function classifyLiquidityRisk(
  ratio: number,
  maxRatio: number
): "ok" | "elevated" | "high" {
  if (!Number.isFinite(ratio)) return "high";
  if (ratio > maxRatio * 2) return "high";
  if (ratio > maxRatio) return "elevated";
  return "ok";
}

/** Simple momentum from multi-TF price changes (no OHLCV required). */
export function momentumHint(token: CandidateToken): string {
  const pcs = [token.priceChange5m, token.priceChange1h, token.priceChange6h].filter(
    (n): n is number => typeof n === "number" && Number.isFinite(n)
  );
  if (pcs.length < 2) return "n/a (insufficient TF data)";
  const avg = pcs.reduce((a, b) => a + b, 0) / pcs.length;
  // Rough RSI-ish from average % moves mapped into 0–100 band (not true RSI).
  const rsiApprox = Math.max(5, Math.min(95, 50 + avg));
  const rising = (token.priceChange5m ?? 0) > 0 && (token.volumeSpikeRatio ?? 0) >= 1.5;
  if (rising && avg > 0) return `mom+ rsi~${rsiApprox.toFixed(0)}`;
  if (avg < -5) return `mom- rsi~${rsiApprox.toFixed(0)}`;
  return `mixed rsi~${rsiApprox.toFixed(0)}`;
}

export function volumeSummary(token: CandidateToken): string {
  const parts: string[] = [];
  if (token.volume5mUsd !== undefined) parts.push(`5m=$${Math.round(token.volume5mUsd)}`);
  if (token.volume1hUsd !== undefined) parts.push(`1h=$${Math.round(token.volume1hUsd)}`);
  if (token.volume6hUsd !== undefined) parts.push(`6h=$${Math.round(token.volume6hUsd)}`);
  parts.push(`24h=$${Math.round(token.volume24hUsd)}`);
  return parts.join(" ");
}

/**
 * Score 0–100. Higher = better confluence for tryEnter ranking.
 * Soft: liquidity risk and on-curve status downrank; never a hard block here.
 */
export function scoreConfluence(token: CandidateToken, cfg: AppConfig): number {
  const tags = sourceTags(token);
  let score = tags.length * 22; // 0, 22, 44, 66 for 0–3 sources

  // Rising short-term volume
  const spike = token.volumeSpikeRatio || 0;
  score += Math.min(18, spike * 3);

  // Short TF price acceptance
  if ((token.priceChange5m ?? 0) > 0) score += 4;
  if ((token.priceChange1h ?? 0) > 0) score += 4;

  // Organic Jupiter boost
  if (typeof token.organicScore === "number" && token.organicScore > 0) {
    score += Math.min(12, token.organicScore / 10);
  }

  // Graduation preference
  if (token.bondingStatus === "graduated") score += cfg.preferGraduated ? 10 : 4;
  else if (token.bondingStatus === "bonding") score -= cfg.preferGraduated ? 8 : 2;

  // Post-graduation volume dry-up
  if (token.bondingStatus === "graduated" && spike < 1 && (token.volume1hUsd ?? 0) < (token.volume24hUsd || 1) / 48) {
    score -= 10;
  }

  const ratio = volumeToLiquidityRatio(token);
  const risk = classifyLiquidityRisk(ratio, cfg.maxVolumeToLiquidityRatio);
  if (risk === "elevated") score -= 8;
  if (risk === "high") score -= 16;

  // Twitter optional bump when already computed onto token
  if (token.twitterTrending === true) score += 5;

  // Watched mint keyword (contract address) exact match
  if (token.watchedMintMatch === true) score += 12;

  // Pump.fun callout / launch priority (prefer over dex/jup-only)
  if (cfg.preferPumpCallouts && tags.includes("pump")) {
    score += 14;
    // Extra nudge for fresh bonding callouts (new launches)
    if (token.bondingStatus === "bonding" && (token.pairAgeMinutes ?? 999) < 180) {
      score += 4;
    }
  }

  // Candlestick / PA setups (solana-skill) — prefer bullish confluence
  if (typeof token.patternScore === "number" && Number.isFinite(token.patternScore)) {
    // Map 0–100 pattern score around 50 → ±14 to score
    const delta = (token.patternScore - 50) / 50; // -1..+1
    score += Math.max(-14, Math.min(14, delta * 14));
  }
  if (token.patternBias === "bullish" && (token.patternTags?.length ?? 0) > 0) {
    score += 6;
  } else if (token.patternBias === "bearish") {
    score -= 5;
  }

  // Learned: boost TP-correlated tags; downrank SL-correlated rejection tags
  const patternTags = token.patternTags ?? [];
  const preferred = cfg.preferredPatternTags ?? [];
  const blocked = cfg.blockedPatternTags ?? [];
  if (patternTags.some((t) => preferred.includes(t))) score += 8;
  if (patternTags.some((t) => blocked.includes(t))) score -= 12;

  return Math.max(0, Math.min(100, Math.round(score * 10) / 10));
}

/** Merge duplicate mints, union sources, keep richer metrics. */
export function mergeCandidates(tokens: CandidateToken[]): CandidateToken[] {
  const map = new Map<string, CandidateToken>();
  for (const t of tokens) {
    const prev = map.get(t.mint);
    if (!prev) {
      map.set(t.mint, {
        ...t,
        sources: Array.from(new Set([t.source, ...(t.sources ?? [])])),
      });
      continue;
    }
    const sources = Array.from(
      new Set([...(prev.sources ?? [prev.source]), t.source, ...(t.sources ?? [])])
    );
    const richer: CandidateToken = {
      ...prev,
      ...t,
      sources,
      source: sources.join("+"),
      priceUsd: Math.max(prev.priceUsd || 0, t.priceUsd || 0),
      liquidityUsd: Math.max(prev.liquidityUsd || 0, t.liquidityUsd || 0),
      volume24hUsd: Math.max(prev.volume24hUsd || 0, t.volume24hUsd || 0),
      volume5mUsd: maxUndef(prev.volume5mUsd, t.volume5mUsd),
      volume1hUsd: maxUndef(prev.volume1hUsd, t.volume1hUsd),
      volume6hUsd: maxUndef(prev.volume6hUsd, t.volume6hUsd),
      volumeSpikeRatio: Math.max(prev.volumeSpikeRatio || 0, t.volumeSpikeRatio || 0),
      pairAgeMinutes: Math.min(prev.pairAgeMinutes, t.pairAgeMinutes),
      organicScore: maxUndef(prev.organicScore, t.organicScore),
      bondingStatus: preferBondingStatus(prev.bondingStatus, t.bondingStatus),
      priceChange5m: pickDefined(t.priceChange5m, prev.priceChange5m),
      priceChange1h: pickDefined(t.priceChange1h, prev.priceChange1h),
      priceChange6h: pickDefined(t.priceChange6h, prev.priceChange6h),
      priceChange24h: pickDefined(t.priceChange24h, prev.priceChange24h),
      symbol: t.symbol && t.symbol !== "???" ? t.symbol : prev.symbol,
      name: t.name || prev.name,
      pairAddress: t.pairAddress || prev.pairAddress,
      url: t.url || prev.url,
      watchedMintMatch: Boolean(prev.watchedMintMatch || t.watchedMintMatch),
      twitterTrending: Boolean(prev.twitterTrending || t.twitterTrending) || undefined,
      patternTags: (t.patternScore ?? 0) >= (prev.patternScore ?? 0) ? t.patternTags ?? prev.patternTags : prev.patternTags ?? t.patternTags,
      patternScore: maxUndef(prev.patternScore, t.patternScore),
      patternBias: (t.patternScore ?? 0) >= (prev.patternScore ?? 0) ? t.patternBias ?? prev.patternBias : prev.patternBias ?? t.patternBias,
      patternDataQuality: t.patternDataQuality === "ohlcv" || prev.patternDataQuality === "ohlcv" ? "ohlcv" : t.patternDataQuality ?? prev.patternDataQuality,
    };
    map.set(t.mint, richer);
  }
  return [...map.values()];
}

function maxUndef(a?: number, b?: number): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.max(a, b);
}

function pickDefined<T>(a: T | undefined, b: T | undefined): T | undefined {
  return a !== undefined ? a : b;
}

function preferBondingStatus(
  a?: CandidateToken["bondingStatus"],
  b?: CandidateToken["bondingStatus"]
): CandidateToken["bondingStatus"] {
  const rank = { graduated: 3, bonding: 2, unknown: 1 } as const;
  const ar = a ? rank[a] : 0;
  const br = b ? rank[b] : 0;
  if (br >= ar) return b ?? a ?? "unknown";
  return a ?? b ?? "unknown";
}

/** Enrich ratios, risk, confluence, momentum; sort for tryEnter. */
export function enrichAndRank(tokens: CandidateToken[], cfg: AppConfig): CandidateToken[] {
  const out = tokens.map((t) => {
    const ratio = volumeToLiquidityRatio(t);
    const liquidityRisk = classifyLiquidityRisk(ratio, cfg.maxVolumeToLiquidityRatio);
    const tags = sourceTags(t);
    const tagged = {
      ...t,
      volumeToLiquidityRatio: ratio,
      liquidityRisk,
      pumpCallout: tags.includes("pump"),
    };
    const confluenceScore = scoreConfluence(tagged, cfg);
    return {
      ...tagged,
      confluenceScore,
      momentumHint: momentumHint(tagged),
      sourceTagList: tags,
    };
  });

  out.sort((a, b) => {
    // Hard preference: Pump.fun callouts ahead of dex/jup-only when enabled
    if (cfg.preferPumpCallouts) {
      const pa = a.pumpCallout ? 1 : 0;
      const pb = b.pumpCallout ? 1 : 0;
      if (pb !== pa) return pb - pa;
    }
    const ca = a.confluenceScore ?? 0;
    const cb = b.confluenceScore ?? 0;
    if (cb !== ca) return cb - ca;
    // Prefer graduated when scores tie
    if (cfg.preferGraduated) {
      const ga = a.bondingStatus === "graduated" ? 1 : 0;
      const gb = b.bondingStatus === "graduated" ? 1 : 0;
      if (gb !== ga) return gb - ga;
    }
    // Prefer stronger bullish candle setups on ties
    const pa = a.patternScore ?? 50;
    const pb = b.patternScore ?? 50;
    if (pb !== pa) return pb - pa;
    return (b.volumeSpikeRatio || 0) - (a.volumeSpikeRatio || 0);
  });
  return out;
}

/** minSources <= 0 disables the confluence gate (risk-on / experimental). */
export function meetsMinConfluence(token: CandidateToken, minSources: number): boolean {
  if (minSources <= 0) return true;
  return sourceTags(token).length >= minSources;
}

/**
 * Tightened setup gate (post risk-on learnings from TP vs SL closes).
 * - Soft-block SL-correlated bearish/rejection tags
 * - Require score >= minPatternScore
 * - Prefer TP-correlated bull tags (or very high score)
 * - mom+ alone is NOT enough
 */
export function hasGoodSetup(
  token: CandidateToken,
  minPatternScore = 68,
  opts?: {
    preferredTags?: string[];
    blockedTags?: string[];
    requirePreferredTag?: boolean;
    minPriceChange5mPct?: number;
  }
): boolean {
  const tags = token.patternTags ?? [];
  const preferred =
    opts?.preferredTags?.length
      ? opts.preferredTags
      : ["hammer", "bull_engulf", "maru_bull", "3soldiers"];
  const blocked =
    opts?.blockedTags?.length
      ? opts.blockedTags
      : ["shoot_star", "bear_engulf", "maru_bear", "3crows", "hang_man"];
  const requirePreferred = opts?.requirePreferredTag !== false;
  const min5m = opts?.minPriceChange5mPct ?? -1;

  // Soft-block rejection / bearish candle tags (SL-correlated)
  const blockedHits = tags.filter((t) => blocked.includes(t));
  const preferredHits = tags.filter((t) => preferred.includes(t));
  if (blockedHits.length && preferredHits.length === 0) {
    return false;
  }
  if (token.patternBias === "bearish" && preferredHits.length === 0) {
    return false;
  }

  // Fade filter: when 5m % is known, avoid hard-red entries (flash-dump cohort)
  if (
    typeof token.priceChange5m === "number" &&
    Number.isFinite(token.priceChange5m) &&
    min5m > -900 &&
    token.priceChange5m < min5m
  ) {
    return false;
  }

  const score =
    typeof token.patternScore === "number" && Number.isFinite(token.patternScore)
      ? token.patternScore
      : 50;
  if (score < minPatternScore && token.patternBias !== "bullish") {
    return false;
  }

  // Strong score can pass without preferred tag; otherwise require one
  const veryStrong = score >= minPatternScore + 10; // e.g. 78 when min=68
  if (requirePreferred && preferredHits.length === 0 && !veryStrong) {
    // Allow pure bullish bias with score meeting min even without tag list
    if (!(token.patternBias === "bullish" && score >= minPatternScore)) {
      return false;
    }
  }

  // Final: bullish bias or score at/above min (mom+ alone no longer enough)
  if (token.patternBias === "bullish") return true;
  if (score >= minPatternScore) return true;
  return false;
}

/** Human-readable why hasGoodSetup failed (for filter reasons). */
export function setupRejectReason(
  token: CandidateToken,
  minPatternScore = 68,
  opts?: {
    preferredTags?: string[];
    blockedTags?: string[];
    requirePreferredTag?: boolean;
    minPriceChange5mPct?: number;
  }
): string | undefined {
  if (hasGoodSetup(token, minPatternScore, opts)) return undefined;
  const tags = token.patternTags ?? [];
  const preferred =
    opts?.preferredTags?.length
      ? opts.preferredTags
      : ["hammer", "bull_engulf", "maru_bull", "3soldiers"];
  const blocked =
    opts?.blockedTags?.length
      ? opts.blockedTags
      : ["shoot_star", "bear_engulf", "maru_bear", "3crows", "hang_man"];
  const blockedHits = tags.filter((t) => blocked.includes(t));
  if (blockedHits.length && !tags.some((t) => preferred.includes(t))) {
    return `blocked pattern tags: ${blockedHits.join(",")}`;
  }
  if (
    typeof token.priceChange5m === "number" &&
    Number.isFinite(token.priceChange5m) &&
    (opts?.minPriceChange5mPct ?? -1) > -900 &&
    token.priceChange5m < (opts?.minPriceChange5mPct ?? -1)
  ) {
    return `5m fade ${token.priceChange5m.toFixed(1)}% < min ${opts?.minPriceChange5mPct ?? -1}%`;
  }
  return `weak setup (bias=${token.patternBias ?? "?"} score=${token.patternScore ?? "?"} tags=${tags.join(",") || "none"} mom=${token.momentumHint ?? "n/a"})`;
}

export function liquidityRiskNote(token: CandidateToken, maxRatio: number): string | undefined {
  const ratio = token.volumeToLiquidityRatio ?? volumeToLiquidityRatio(token);
  const risk = token.liquidityRisk ?? classifyLiquidityRisk(ratio, maxRatio);
  if (risk === "ok") return undefined;
  const rLabel = Number.isFinite(ratio) ? `${ratio.toFixed(1)}x` : "inf";
  return `liqRisk=${risk} vol/liq=${rLabel} (soft; maxRatio=${maxRatio})`;
}

/** Order pass rows for tryEnter: Pump soft priority, then patterns (risk-on), then confluence. */
export function sortForTryEnter<T extends { token: CandidateToken; confluenceScore?: number }>(
  rows: T[],
  cfg: AppConfig
): T[] {
  return [...rows].sort((a, b) => {
    if (cfg.preferPumpCallouts) {
      const pa = a.token.pumpCallout || sourceTags(a.token).includes("pump") ? 1 : 0;
      const pb = b.token.pumpCallout || sourceTags(b.token).includes("pump") ? 1 : 0;
      if (pb !== pa) return pb - pa;
    }
    // Risk-on: prioritize bullish candle/indicator setups over raw confluence
    if (cfg.riskOnTest) {
      const ba = a.token.patternBias === "bullish" ? 1 : 0;
      const bb = b.token.patternBias === "bullish" ? 1 : 0;
      if (bb !== ba) return bb - ba;
      const pa = a.token.patternScore ?? 50;
      const pb = b.token.patternScore ?? 50;
      if (pb !== pa) return pb - pa;
    }
    const ca = a.confluenceScore ?? a.token.confluenceScore ?? 0;
    const cb = b.confluenceScore ?? b.token.confluenceScore ?? 0;
    if (cb !== ca) return cb - ca;
    const pa = a.token.patternScore ?? 50;
    const pb = b.token.patternScore ?? 50;
    if (pb !== pa) return pb - pa;
    return (b.token.volumeSpikeRatio || 0) - (a.token.volumeSpikeRatio || 0);
  });
}
