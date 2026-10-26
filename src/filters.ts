import type { FilterConfig } from "./config.js";
import type { TokenSafety } from "./security-checks.js";

export interface CandidateToken {
  mint: string;
  symbol: string;
  name: string;
  priceUsd: number;
  liquidityUsd: number;
  volume24hUsd: number;
  volumeSpikeRatio: number;
  pairAgeMinutes: number;
  /** Primary / display source string (may be joined after merge). */
  source: string;
  /** All raw discovery sources for this mint (confluence). */
  sources?: string[];
  pairAddress?: string;
  url?: string;
  /** Multi-timeframe volume (USD) when APIs provide them. */
  volume5mUsd?: number;
  volume1hUsd?: number;
  volume6hUsd?: number;
  /** Multi-timeframe price change % when APIs provide them. */
  priceChange5m?: number;
  priceChange1h?: number;
  priceChange6h?: number;
  priceChange24h?: number;
  /** Bonding curve vs graduated (Pump.fun / Jupiter launchpad). */
  bondingStatus?: "bonding" | "graduated" | "unknown";
  /** Jupiter organic score 0–100 when available. */
  organicScore?: number;
  /** Filled by confluence enrich. */
  volumeToLiquidityRatio?: number;
  liquidityRisk?: "ok" | "elevated" | "high";
  confluenceScore?: number;
  momentumHint?: string;
  sourceTagList?: Array<"pump" | "dex" | "jup">;
  twitterTrending?: boolean;
  /** Candidate mint is on keyword watch list (exact match). */
  watchedMintMatch?: boolean;
  /** True when discovery includes a Pump.fun family source (callout / launch). */
  pumpCallout?: boolean;
  /** Candlestick / PA setup tags (short ids). */
  patternTags?: string[];
  /** Net bullish pattern score 0–100. */
  patternScore?: number;
  patternBias?: "bullish" | "bearish" | "neutral";
  patternDataQuality?: "ohlcv" | "proxy" | "thin";
}

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

const FILTER_KEYS: (keyof FilterConfig)[] = [
  "maxTopHolderPercent",
  "maxTop10HolderPercent",
  "maxBundlerPercent",
  "minLiquidityUsd",
  "minVolume24hUsd",
  "minVolumeSpikeRatio",
  "minTokenAgeMinutes",
  "maxTokenAgeMinutes",
  "requireMintAuthorityRevoked",
  "requireFreezeAuthorityRevoked",
  "denylistMints",
];

export function applyFilters(
  token: CandidateToken,
  filters: FilterConfig,
  safety?: TokenSafety
): FilterResult {
  const reasons: string[] = [];

  if (filters.denylistMints.map((m) => m.toLowerCase()).includes(token.mint.toLowerCase())) {
    reasons.push("mint is on denylist");
  }
  if (token.liquidityUsd < filters.minLiquidityUsd) {
    reasons.push(`liquidity $${token.liquidityUsd.toFixed(0)} < min $${filters.minLiquidityUsd}`);
  }
  // minVolume24hUsd <= 0 disables the volume gate
  if (filters.minVolume24hUsd > 0 && token.volume24hUsd < filters.minVolume24hUsd) {
    reasons.push(`volume24h $${token.volume24hUsd.toFixed(0)} < min $${filters.minVolume24hUsd}`);
  }
  // minVolumeSpikeRatio <= 0 disables the spike gate
  if (filters.minVolumeSpikeRatio > 0 && token.volumeSpikeRatio < filters.minVolumeSpikeRatio) {
    reasons.push(
      `volume spike ${token.volumeSpikeRatio.toFixed(2)}x < min ${filters.minVolumeSpikeRatio}x`
    );
  }
  if (token.pairAgeMinutes < filters.minTokenAgeMinutes) {
    reasons.push(`age ${token.pairAgeMinutes.toFixed(1)}m < min ${filters.minTokenAgeMinutes}m`);
  }
  if (token.pairAgeMinutes > filters.maxTokenAgeMinutes) {
    reasons.push(`age ${token.pairAgeMinutes.toFixed(0)}m > max ${filters.maxTokenAgeMinutes}m`);
  }
  if (!(token.priceUsd > 0)) {
    reasons.push("invalid price");
  }

  if (safety) {
    if (safety.topHolderPercent !== undefined && safety.topHolderPercent > filters.maxTopHolderPercent) {
      reasons.push(
        `top holder ${safety.topHolderPercent.toFixed(1)}% > max ${filters.maxTopHolderPercent}%`
      );
    }
    if (
      safety.top10HolderPercent !== undefined &&
      safety.top10HolderPercent > filters.maxTop10HolderPercent
    ) {
      reasons.push(
        `top10 holders ${safety.top10HolderPercent.toFixed(1)}% > max ${filters.maxTop10HolderPercent}%`
      );
    }
    // Bundler: maxBundlerPercent < 0 disables the check (unknown does NOT block)
    if (filters.maxBundlerPercent >= 0) {
      if (safety.bundlerPercent !== undefined && Number.isFinite(safety.bundlerPercent)) {
        if (safety.bundlerPercent >= filters.maxBundlerPercent) {
          reasons.push(
            `bundler ${safety.bundlerPercent.toFixed(2)}% >= max ${filters.maxBundlerPercent}%`
          );
        }
      }
      // When bundler % unknown and gate is on, do NOT block (user disabled fail-closed)
    }
    if (filters.requireMintAuthorityRevoked && safety.mintAuthority !== null && safety.mintAuthority !== undefined) {
      if (safety.mintAuthority !== "revoked") {
        reasons.push(`mint authority still set (${safety.mintAuthority})`);
      }
    }
    if (
      filters.requireFreezeAuthorityRevoked &&
      safety.freezeAuthority !== null &&
      safety.freezeAuthority !== undefined
    ) {
      if (safety.freezeAuthority !== "revoked") {
        reasons.push(`freeze authority still set (${safety.freezeAuthority})`);
      }
    }
    // Incomplete holder/RPC data: fail closed when top-holder rules cannot be verified
    if (
      (safety.topHolderPercent === undefined || safety.top10HolderPercent === undefined) &&
      (safety.errors?.length || safety.notes?.some((n) => n.includes("largest")))
    ) {
      reasons.push("could not verify holder concentration (RPC limit/error) — blocked");
    }
    if (
      filters.requireMintAuthorityRevoked &&
      safety.mintAuthority === undefined &&
      safety.errors?.length
    ) {
      reasons.push("could not verify mint authority — blocked");
    }
    if (
      filters.requireFreezeAuthorityRevoked &&
      safety.freezeAuthority === undefined &&
      safety.errors?.length
    ) {
      reasons.push("could not verify freeze authority — blocked");
    }
  }

  return { pass: reasons.length === 0, reasons };
}

export function parseFilterSet(
  key: string,
  value: string,
  current: FilterConfig
): FilterConfig {
  const next = { ...current, denylistMints: [...current.denylistMints] };
  switch (key) {
    case "maxTopHolderPercent":
    case "maxTop10HolderPercent":
    case "maxBundlerPercent":
    case "minLiquidityUsd":
    case "minVolume24hUsd":
    case "minVolumeSpikeRatio":
    case "minTokenAgeMinutes":
    case "maxTokenAgeMinutes": {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`Invalid number for ${key}`);
      next[key] = n;
      break;
    }
    case "requireMintAuthorityRevoked":
    case "requireFreezeAuthorityRevoked": {
      next[key] = ["1", "true", "yes", "on"].includes(value.toLowerCase());
      break;
    }
    case "denylistMints": {
      next.denylistMints = value
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      break;
    }
    case "denylistAdd": {
      if (!next.denylistMints.includes(value)) next.denylistMints.push(value);
      break;
    }
    default:
      throw new Error(`Unknown filter key: ${key}. Valid: ${FILTER_KEYS.join(", ")}, denylistAdd`);
  }
  return next;
}

export function describeFilters(f: FilterConfig): string {
  return [
    `maxTopHolderPercent = ${f.maxTopHolderPercent}`,
    `maxTop10HolderPercent = ${f.maxTop10HolderPercent}`,
    `maxBundlerPercent = ${f.maxBundlerPercent}${f.maxBundlerPercent < 0 ? " (off)" : ""}`,
    `minLiquidityUsd = ${f.minLiquidityUsd}`,
    `minVolume24hUsd = ${f.minVolume24hUsd}${f.minVolume24hUsd <= 0 ? " (off)" : ""}`,
    `minVolumeSpikeRatio = ${f.minVolumeSpikeRatio}${f.minVolumeSpikeRatio <= 0 ? " (off)" : ""}`,
    `minTokenAgeMinutes = ${f.minTokenAgeMinutes}`,
    `maxTokenAgeMinutes = ${f.maxTokenAgeMinutes}`,
    `requireMintAuthorityRevoked = ${f.requireMintAuthorityRevoked}`,
    `requireFreezeAuthorityRevoked = ${f.requireFreezeAuthorityRevoked}`,
    `denylistMints = [${f.denylistMints.join(", ") || "none"}]`,
  ].join("\n");
}
