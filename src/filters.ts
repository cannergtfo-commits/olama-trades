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
  source: string;
  pairAddress?: string;
  url?: string;
}

export interface FilterResult {
  pass: boolean;
  reasons: string[];
}

const FILTER_KEYS: (keyof FilterConfig)[] = [
  "maxTopHolderPercent",
  "maxTop10HolderPercent",
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
  if (token.volume24hUsd < filters.minVolume24hUsd) {
    reasons.push(`volume24h $${token.volume24hUsd.toFixed(0)} < min $${filters.minVolume24hUsd}`);
  }
  if (token.volumeSpikeRatio < filters.minVolumeSpikeRatio) {
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
    `minLiquidityUsd = ${f.minLiquidityUsd}`,
    `minVolume24hUsd = ${f.minVolume24hUsd}`,
    `minVolumeSpikeRatio = ${f.minVolumeSpikeRatio}`,
    `minTokenAgeMinutes = ${f.minTokenAgeMinutes}`,
    `maxTokenAgeMinutes = ${f.maxTokenAgeMinutes}`,
    `requireMintAuthorityRevoked = ${f.requireMintAuthorityRevoked}`,
    `requireFreezeAuthorityRevoked = ${f.requireFreezeAuthorityRevoked}`,
    `denylistMints = [${f.denylistMints.join(", ") || "none"}]`,
  ].join("\n");
}
