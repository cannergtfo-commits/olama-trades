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
    const tagged = { ...t, volumeToLiquidityRatio: ratio, liquidityRisk };
    const confluenceScore = scoreConfluence(tagged, cfg);
    return {
      ...tagged,
      confluenceScore,
      momentumHint: momentumHint(tagged),
      sourceTagList: sourceTags(tagged),
    };
  });

  out.sort((a, b) => {
    const ca = a.confluenceScore ?? 0;
    const cb = b.confluenceScore ?? 0;
    if (cb !== ca) return cb - ca;
    // Prefer graduated when scores tie
    if (cfg.preferGraduated) {
      const ga = a.bondingStatus === "graduated" ? 1 : 0;
      const gb = b.bondingStatus === "graduated" ? 1 : 0;
      if (gb !== ga) return gb - ga;
    }
    return (b.volumeSpikeRatio || 0) - (a.volumeSpikeRatio || 0);
  });
  return out;
}

export function meetsMinConfluence(token: CandidateToken, minSources: number): boolean {
  return sourceTags(token).length >= Math.max(1, minSources);
}

export function liquidityRiskNote(token: CandidateToken, maxRatio: number): string | undefined {
  const ratio = token.volumeToLiquidityRatio ?? volumeToLiquidityRatio(token);
  const risk = token.liquidityRisk ?? classifyLiquidityRisk(ratio, maxRatio);
  if (risk === "ok") return undefined;
  const rLabel = Number.isFinite(ratio) ? `${ratio.toFixed(1)}x` : "inf";
  return `liqRisk=${risk} vol/liq=${rLabel} (soft; maxRatio=${maxRatio})`;
}
