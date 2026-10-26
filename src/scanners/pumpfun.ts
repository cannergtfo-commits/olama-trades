import type { CandidateToken } from "../filters.js";
import { scanPumpFunViaDex } from "./dexscreener.js";

/**
 * Pump.fun scanner.
 *
 * Official frontend APIs (e.g. frontend-api.pump.fun) are unofficial, change often,
 * and aggressively rate-limit / block datacenter IPs. Primary path: DexScreener
 * pairs that index pump.fun liquidity. Optional direct attempt is best-effort.
 * Tracks bonding vs graduated when the API exposes `complete` / pool fields.
 */
export async function scanPumpFun(): Promise<{ tokens: CandidateToken[]; notes: string[] }> {
  const notes: string[] = [
    "Using DexScreener pump/search + profiles as Pump.fun proxy (official API rate-limits bots).",
  ];

  const viaDex = await scanPumpFunViaDex();

  // Best-effort direct: try public pump.fun coins endpoint; ignore failures
  try {
    const res = await fetch(
      "https://frontend-api.pump.fun/coins?offset=0&limit=20&sort=last_trade_timestamp&order=DESC&includeNsfw=false",
      {
        headers: { Accept: "application/json", "User-Agent": "solana-terminal-bot/1.0" },
        signal: AbortSignal.timeout(8_000),
      }
    );
    if (res.ok) {
      const coins = (await res.json()) as Array<{
        mint?: string;
        symbol?: string;
        name?: string;
        usd_market_cap?: number;
        created_timestamp?: number;
        volume_24h?: number;
        complete?: boolean;
        raydium_pool?: string | null;
        pumpkin_swap?: string | null;
        program?: string;
      }>;
      if (Array.isArray(coins)) {
        for (const c of coins) {
          if (!c.mint) continue;
          const ageMin = c.created_timestamp
            ? (Date.now() - c.created_timestamp) / 60_000
            : 999;
          const graduated = Boolean(c.complete || c.raydium_pool);
          viaDex.push({
            mint: c.mint,
            symbol: c.symbol ?? "???",
            name: c.name ?? "",
            priceUsd: 0, // filled later via Jupiter/Dex if needed
            liquidityUsd: Number(c.usd_market_cap ?? 0) * 0.1, // rough proxy
            volume24hUsd: Number(c.volume_24h ?? 0),
            volumeSpikeRatio: 3, // assume hot if on last_trade sort
            pairAgeMinutes: ageMin,
            bondingStatus: graduated ? "graduated" : "bonding",
            source: "pumpfun-frontend-api",
            sources: ["pumpfun-frontend-api"],
          });
        }
        notes.push("Direct pump.fun frontend API responded OK (bonding/graduated flagged).");
      }
    } else {
      notes.push(`Direct pump.fun API HTTP ${res.status}; relying on DexScreener.`);
    }
  } catch {
    notes.push("Direct pump.fun API unreachable; relying on DexScreener.");
  }

  const map = new Map<string, CandidateToken>();
  for (const t of viaDex) {
    const prev = map.get(t.mint);
    if (!prev || t.volumeSpikeRatio > prev.volumeSpikeRatio) map.set(t.mint, t);
  }
  return { tokens: [...map.values()], notes };
}
