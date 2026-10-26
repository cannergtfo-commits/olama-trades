import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(__dirname, "..");

dotenv.config({ path: path.join(ROOT, ".env") });

export interface FilterConfig {
  maxTopHolderPercent: number;
  maxTop10HolderPercent: number;
  /** Block buys when bundler/insider concentration % >= this (fail-closed if unknown). */
  maxBundlerPercent: number;
  minLiquidityUsd: number;
  minVolume24hUsd: number;
  minVolumeSpikeRatio: number;
  minTokenAgeMinutes: number;
  maxTokenAgeMinutes: number;
  requireMintAuthorityRevoked: boolean;
  requireFreezeAuthorityRevoked: boolean;
  denylistMints: string[];
}

export interface TwitterConfig {
  enabled: boolean;
  keywords: string[];
  minMentionsHeuristic: number;
  useMockWhenNoKey: boolean;
}

export interface AppConfig {
  rpcUrl: string;
  buyAmountSol: number;
  maxBuyAmountSol: number;
  /** Cap each buy as % of SOL balance (leave rest for fees). */
  maxPortfolioBuyPct: number;
  /** Absolute SOL to never spend (gas / rent). */
  minSolReserve: number;
  takeProfitPct: number;
  stopLossPct: number;
  slippageBps: number;
  dryRun: boolean;
  scanIntervalMs: number;
  maxOpenPositions: number;
  /** Min distinct source families (pump/dex/jup) before tryEnter. Default 1 keeps live bot fed. */
  minConfluenceSources: number;
  /** Soft vol24h/liquidity ratio flag (downrank / note; not a hard fail). */
  maxVolumeToLiquidityRatio: number;
  /** Prefer graduated tokens over still-on-curve for Jupiter routes. */
  preferGraduated: boolean;
  jupiterApiKey?: string;
  xBearerToken?: string;
  heliusApiKey?: string;
  xaiApiKey?: string;
  filters: FilterConfig;
  twitter: TwitterConfig;
}

const CONFIG_PATH = path.join(ROOT, "config.json");
const ENV_PATH = path.join(ROOT, ".env");

function num(env: string | undefined, fallback: number): number {
  if (env === undefined || env === "") return fallback;
  const n = Number(env);
  return Number.isFinite(n) ? n : fallback;
}

function bool(env: string | undefined, fallback: boolean): boolean {
  if (env === undefined || env === "") return fallback;
  return ["1", "true", "yes", "on"].includes(env.toLowerCase());
}

function loadJsonConfig(): Partial<AppConfig> & {
  filters?: Partial<FilterConfig>;
  twitter?: Partial<TwitterConfig>;
} {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

/** Prefer config.json for filters (CLI `filters set`), then env, then defaults. */
export function loadConfig(): AppConfig {
  // Re-read .env each call so runtime edits apply; filters still prefer config.json
  dotenv.config({ path: ENV_PATH, override: false });
  const file = loadJsonConfig();

  const filters: FilterConfig = {
    maxTopHolderPercent: file.filters?.maxTopHolderPercent ?? num(process.env.MAX_TOP_HOLDER_PCT, 20),
    maxTop10HolderPercent: file.filters?.maxTop10HolderPercent ?? num(process.env.MAX_TOP10_HOLDER_PCT, 50),
    maxBundlerPercent: file.filters?.maxBundlerPercent ?? num(process.env.MAX_BUNDLER_PCT, 1),
    minLiquidityUsd: file.filters?.minLiquidityUsd ?? num(process.env.MIN_LIQUIDITY_USD, 10_000),
    minVolume24hUsd: file.filters?.minVolume24hUsd ?? num(process.env.MIN_VOLUME_24H_USD, 5_000),
    minVolumeSpikeRatio: file.filters?.minVolumeSpikeRatio ?? num(process.env.MIN_VOLUME_SPIKE_RATIO, 2),
    minTokenAgeMinutes: file.filters?.minTokenAgeMinutes ?? num(process.env.MIN_TOKEN_AGE_MINUTES, 5),
    maxTokenAgeMinutes: file.filters?.maxTokenAgeMinutes ?? num(process.env.MAX_TOKEN_AGE_MINUTES, 10_080),
    requireMintAuthorityRevoked:
      file.filters?.requireMintAuthorityRevoked ??
      bool(process.env.REQUIRE_MINT_AUTHORITY_REVOKED, true),
    requireFreezeAuthorityRevoked:
      file.filters?.requireFreezeAuthorityRevoked ??
      bool(process.env.REQUIRE_FREEZE_AUTHORITY_REVOKED, true),
    denylistMints: Array.isArray(file.filters?.denylistMints) ? [...file.filters!.denylistMints!] : [],
  };

  const twitter: TwitterConfig = {
    enabled: file.twitter?.enabled ?? true,
    keywords: file.twitter?.keywords ?? ["pump", "solana", "gem", "moon"],
    minMentionsHeuristic: file.twitter?.minMentionsHeuristic ?? 3,
    useMockWhenNoKey: file.twitter?.useMockWhenNoKey ?? true,
  };

  let buyAmountSol = num(process.env.BUY_AMOUNT_SOL, file.buyAmountSol ?? 0.05);
  const maxBuyAmountSol = num(process.env.MAX_BUY_AMOUNT_SOL, file.maxBuyAmountSol ?? 0.25);
  const maxPortfolioBuyPct = num(process.env.MAX_PORTFOLIO_BUY_PCT, file.maxPortfolioBuyPct ?? 90);
  const minSolReserve = num(process.env.MIN_SOL_RESERVE, file.minSolReserve ?? 0.01);
  if (buyAmountSol > maxBuyAmountSol) buyAmountSol = maxBuyAmountSol;

  let slippageBps = num(process.env.SLIPPAGE_BPS, file.slippageBps ?? 100);
  if (slippageBps < 10) slippageBps = 10;
  if (slippageBps > 500) slippageBps = 500;

  return {
    rpcUrl: process.env.RPC_URL || "https://api.mainnet-beta.solana.com",
    buyAmountSol,
    maxBuyAmountSol,
    maxPortfolioBuyPct,
    minSolReserve,
    takeProfitPct: num(process.env.TAKE_PROFIT_PCT, file.takeProfitPct ?? 10),
    stopLossPct: num(process.env.STOP_LOSS_PCT, file.stopLossPct ?? 25),
    slippageBps,
    dryRun: bool(process.env.DRY_RUN, file.dryRun ?? true),
    scanIntervalMs: num(process.env.SCAN_INTERVAL_MS, file.scanIntervalMs ?? 30_000),
    maxOpenPositions: num(process.env.MAX_OPEN_POSITIONS, file.maxOpenPositions ?? 3),
    minConfluenceSources: num(process.env.MIN_CONFLUENCE_SOURCES, file.minConfluenceSources ?? 1),
    maxVolumeToLiquidityRatio: num(
      process.env.MAX_VOLUME_TO_LIQUIDITY_RATIO,
      file.maxVolumeToLiquidityRatio ?? 40
    ),
    preferGraduated: bool(process.env.PREFER_GRADUATED, file.preferGraduated ?? true),
    jupiterApiKey: process.env.JUPITER_API_KEY || undefined,
    xBearerToken: process.env.X_BEARER_TOKEN || process.env.TWITTER_BEARER_TOKEN || undefined,
    heliusApiKey: process.env.HELIUS_API_KEY || undefined,
    xaiApiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY || undefined,
    filters,
    twitter,
  };
}

const FILTER_ENV_MAP: Record<keyof Omit<FilterConfig, "denylistMints">, string> = {
  maxTopHolderPercent: "MAX_TOP_HOLDER_PCT",
  maxTop10HolderPercent: "MAX_TOP10_HOLDER_PCT",
  maxBundlerPercent: "MAX_BUNDLER_PCT",
  minLiquidityUsd: "MIN_LIQUIDITY_USD",
  minVolume24hUsd: "MIN_VOLUME_24H_USD",
  minVolumeSpikeRatio: "MIN_VOLUME_SPIKE_RATIO",
  minTokenAgeMinutes: "MIN_TOKEN_AGE_MINUTES",
  maxTokenAgeMinutes: "MAX_TOKEN_AGE_MINUTES",
  requireMintAuthorityRevoked: "REQUIRE_MINT_AUTHORITY_REVOKED",
  requireFreezeAuthorityRevoked: "REQUIRE_FREEZE_AUTHORITY_REVOKED",
};

/** Upsert KEY=VALUE in .env. Never logs the value. */
export function writeEnvKey(key: string, value: string): void {
  if (!fs.existsSync(ENV_PATH)) {
    fs.writeFileSync(ENV_PATH, `${key}=${value}\n`, "utf8");
    return;
  }
  let text = fs.readFileSync(ENV_PATH, "utf8");
  const re = new RegExp(`^${key}=.*$`, "m");
  if (re.test(text)) {
    text = text.replace(re, `${key}=${value}`);
  } else {
    text = text.replace(/\s*$/, `\n${key}=${value}\n`);
  }
  fs.writeFileSync(ENV_PATH, text, "utf8");
}

export function saveFilters(filters: FilterConfig): void {
  const file = loadJsonConfig() as Record<string, unknown>;
  file.filters = filters;
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + "\n", "utf8");

  // Keep .env in sync so status/tools that read env stay consistent
  for (const [k, envKey] of Object.entries(FILTER_ENV_MAP) as [keyof typeof FILTER_ENV_MAP, string][]) {
    const v = filters[k];
    writeEnvKey(envKey, String(v));
  }
}

export function saveConfigPartial(partial: Record<string, unknown>): void {
  const file = loadJsonConfig() as Record<string, unknown>;
  Object.assign(file, partial);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(file, null, 2) + "\n", "utf8");
}

export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const WALLET_DIR = path.join(ROOT, ".wallet");
export const KEYPAIR_PATH = path.join(WALLET_DIR, "keypair.json");
export const POSITIONS_PATH = path.join(ROOT, "data", "positions.json");
