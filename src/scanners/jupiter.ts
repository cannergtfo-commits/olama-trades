import { SOL_MINT, loadConfig } from "../config.js";
import type { CandidateToken } from "../filters.js";
import { getAddress, walletExists } from "../wallet.js";

const ORDER_BASE = "https://api.jup.ag/swap/v2";
const LITE = "https://lite-api.jup.ag";

export interface JupiterQuoteLite {
  mint: string;
  inAmountLamports: string;
  outAmount: string;
  otherAmountThreshold: string;
  ok: boolean;
  error?: string;
}

function jupHeaders(): Record<string, string> {
  const cfg = loadConfig();
  const h: Record<string, string> = { Accept: "application/json" };
  if (cfg.jupiterApiKey) h["x-api-key"] = cfg.jupiterApiKey;
  return h;
}

/**
 * Lightweight route sanity check: ask Jupiter for an order quote buying `mint` with a tiny SOL amount.
 * Without API key, keep RPS low (caller should throttle).
 * Docs: https://api.jup.ag/swap/v2 — order then execute.
 */
export async function quoteBuySolForToken(
  mint: string,
  solAmount: number
): Promise<JupiterQuoteLite> {
  const lamports = Math.max(1, Math.floor(solAmount * 1e9));
  const url = new URL(`${ORDER_BASE}/order`);
  url.searchParams.set("inputMint", SOL_MINT);
  url.searchParams.set("outputMint", mint);
  url.searchParams.set("amount", String(lamports));
  // Use real wallet as taker — system-program placeholder returns "Insufficient funds"
  const taker = walletExists() ? getAddress() : "11111111111111111111111111111111";
  url.searchParams.set("taker", taker);

  try {
    const res = await fetch(url.toString(), {
      headers: jupHeaders(),
      signal: AbortSignal.timeout(12_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        mint,
        inAmountLamports: String(lamports),
        outAmount: "0",
        otherAmountThreshold: "0",
        ok: false,
        error: `HTTP ${res.status} ${text.slice(0, 120)}`,
      };
    }
    const data = (await res.json()) as {
      outAmount?: string;
      otherAmountThreshold?: string;
      errorMessage?: string;
      transaction?: string | null;
    };
    if (data.errorMessage) {
      return {
        mint,
        inAmountLamports: String(lamports),
        outAmount: "0",
        otherAmountThreshold: "0",
        ok: false,
        error: data.errorMessage,
      };
    }
    return {
      mint,
      inAmountLamports: String(lamports),
      outAmount: data.outAmount ?? "0",
      otherAmountThreshold: data.otherAmountThreshold ?? "0",
      ok: Number(data.outAmount ?? 0) > 0,
    };
  } catch (e) {
    return {
      mint,
      inAmountLamports: String(lamports),
      outAmount: "0",
      otherAmountThreshold: "0",
      ok: false,
      error: (e as Error).message,
    };
  }
}

/** Price in USD via Jupiter Price API v2 (public, low RPS). */
export async function jupiterPriceUsd(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) return {};
  const cfg = loadConfig();
  const url = `https://api.jup.ag/price/v2?ids=${mints.slice(0, 50).join(",")}`;
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (cfg.jupiterApiKey) headers["x-api-key"] = cfg.jupiterApiKey;
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return {};
    const data = (await res.json()) as { data?: Record<string, { price?: string }> };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(data.data ?? {})) {
      const p = Number(v?.price ?? 0);
      if (p > 0) out[k] = p;
    }
    return out;
  } catch {
    return {};
  }
}

interface JupTokenRow {
  id?: string;
  symbol?: string;
  name?: string;
  usdPrice?: number;
  liquidity?: number;
  mcap?: number;
  organicScore?: number;
  organicScoreLabel?: string;
  launchpad?: string | null;
  graduatedPool?: string | null;
  graduatedAt?: string | null;
  createdAt?: string;
  stats5m?: { buyVolume?: number; sellVolume?: number; priceChange?: number };
  stats1h?: { buyVolume?: number; sellVolume?: number; priceChange?: number };
  stats6h?: { buyVolume?: number; sellVolume?: number; priceChange?: number };
  stats24h?: { buyVolume?: number; sellVolume?: number; priceChange?: number };
}

function volSum(s?: { buyVolume?: number; sellVolume?: number }): number {
  return Number(s?.buyVolume ?? 0) + Number(s?.sellVolume ?? 0);
}

function fromJupRow(row: JupTokenRow, source: string): CandidateToken | null {
  const mint = row.id;
  if (!mint || mint === SOL_MINT) return null;
  // Skip majors / stables that organic endpoint surfaces
  const sym = (row.symbol || "").toUpperCase();
  if (["SOL", "USDC", "USDT", "WSOL", "JUP", "MSOL"].includes(sym)) return null;

  const volume5mUsd = volSum(row.stats5m);
  const volume1hUsd = volSum(row.stats1h);
  const volume6hUsd = volSum(row.stats6h);
  const volume24hUsd = volSum(row.stats24h);
  const expectedHourly = volume24hUsd / 24;
  const volumeSpikeRatio =
    expectedHourly > 0 ? volume1hUsd / expectedHourly : volume1hUsd > 0 ? 10 : 0;

  let bondingStatus: CandidateToken["bondingStatus"] = "unknown";
  if (row.graduatedPool || row.graduatedAt) bondingStatus = "graduated";
  else if (row.launchpad && String(row.launchpad).toLowerCase().includes("pump")) {
    bondingStatus = "bonding";
  }

  const createdMs = row.createdAt ? Date.parse(row.createdAt) : NaN;
  const pairAgeMinutes = Number.isFinite(createdMs)
    ? Math.max(0, (Date.now() - createdMs) / 60_000)
    : 999_999;

  return {
    mint,
    symbol: row.symbol ?? "???",
    name: row.name ?? "",
    priceUsd: Number(row.usdPrice ?? 0),
    liquidityUsd: Number(row.liquidity ?? 0),
    volume24hUsd,
    volume5mUsd,
    volume1hUsd,
    volume6hUsd,
    volumeSpikeRatio,
    pairAgeMinutes,
    priceChange5m: row.stats5m?.priceChange,
    priceChange1h: row.stats1h?.priceChange,
    priceChange6h: row.stats6h?.priceChange,
    priceChange24h: row.stats24h?.priceChange,
    bondingStatus,
    organicScore: Number(row.organicScore ?? 0) || undefined,
    source,
    sources: [source],
  };
}

/**
 * Free Jupiter discovery: organic score leaderboard + recent launches.
 * Portal "Organic" UI filters are mirrored by lite-api toporganicscore (no paid key).
 * Paid portal-only views are documented as skipped in README if unavailable.
 */
export async function scanJupiterOrganic(): Promise<{ tokens: CandidateToken[]; notes: string[] }> {
  const notes: string[] = [];
  const out: CandidateToken[] = [];

  try {
    const res = await fetch(`${LITE}/tokens/v2/toporganicscore/5m`, {
      headers: jupHeaders(),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const rows = (await res.json()) as JupTokenRow[];
      let n = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        const c = fromJupRow(row, "jupiter-organic");
        if (!c) continue;
        // Prefer memecoin-ish: lower mcap / has launchpad or non-zero organic on small caps
        if ((row.mcap ?? 0) > 500_000_000) continue;
        out.push(c);
        n++;
        if (n >= 25) break;
      }
      notes.push(`Jupiter organic (lite-api toporganicscore/5m): ${n} candidates`);
    } else {
      notes.push(`Jupiter organic HTTP ${res.status} — skipped this cycle`);
    }
  } catch (e) {
    notes.push(`Jupiter organic unreachable: ${(e as Error).message}`);
  }

  try {
    const res = await fetch(`${LITE}/tokens/v2/recent`, {
      headers: jupHeaders(),
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const rows = (await res.json()) as JupTokenRow[];
      let n = 0;
      for (const row of Array.isArray(rows) ? rows : []) {
        const c = fromJupRow(row, "jupiter-recent");
        if (!c) continue;
        out.push(c);
        n++;
        if (n >= 20) break;
      }
      notes.push(`Jupiter recent (lite-api): ${n} candidates`);
    } else {
      notes.push(`Jupiter recent HTTP ${res.status} — skipped`);
    }
  } catch (e) {
    notes.push(`Jupiter recent unreachable: ${(e as Error).message}`);
  }

  return { tokens: out, notes };
}
