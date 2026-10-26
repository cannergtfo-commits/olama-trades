import type { CandidateToken } from "../filters.js";

const BASE = "https://api.dexscreener.com";

interface DexPair {
  chainId?: string;
  pairAddress?: string;
  url?: string;
  baseToken?: { address?: string; symbol?: string; name?: string };
  quoteToken?: { address?: string; symbol?: string };
  priceUsd?: string;
  liquidity?: { usd?: number };
  volume?: { h24?: number; h1?: number; h6?: number; m5?: number };
  pairCreatedAt?: number;
  txns?: { h1?: { buys?: number; sells?: number }; m5?: { buys?: number; sells?: number } };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "solana-terminal-bot/1.0" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function toCandidate(p: DexPair, source: string): CandidateToken | null {
  if (p.chainId !== "solana") return null;
  const mint = p.baseToken?.address;
  if (!mint) return null;
  const priceUsd = Number(p.priceUsd ?? 0);
  const liquidityUsd = Number(p.liquidity?.usd ?? 0);
  const volume24hUsd = Number(p.volume?.h24 ?? 0);
  const vol1h = Number(p.volume?.h1 ?? 0);
  // Spike heuristic: 1h volume vs expected equal share of 24h (24h/24). Ratio > 1 = hot hour.
  const expectedHourly = volume24hUsd / 24;
  const volumeSpikeRatio = expectedHourly > 0 ? vol1h / expectedHourly : vol1h > 0 ? 10 : 0;
  const ageMs = p.pairCreatedAt ? Date.now() - p.pairCreatedAt : 0;
  const pairAgeMinutes = ageMs > 0 ? ageMs / 60_000 : 999_999;

  return {
    mint,
    symbol: p.baseToken?.symbol ?? "???",
    name: p.baseToken?.name ?? "",
    priceUsd,
    liquidityUsd,
    volume24hUsd,
    volumeSpikeRatio,
    pairAgeMinutes,
    source,
    pairAddress: p.pairAddress,
    url: p.url,
  };
}

/** Boosted / trending Solana tokens from DexScreener. */
export async function scanDexScreenerBoosts(): Promise<CandidateToken[]> {
  const data = await fetchJson<{ pairs?: DexPair[] } | DexPair[]>(`${BASE}/token-boosts/top/v1`);
  // token-boosts returns array of boost objects with tokenAddress — fall back to profiles + pairs
  const out: CandidateToken[] = [];

  if (Array.isArray(data)) {
    let boosts = 0;
    for (const item of data as Array<{ chainId?: string; tokenAddress?: string }>) {
      if (item.chainId !== "solana" || !item.tokenAddress) continue;
      const pairs = await fetchJson<{ pairs?: DexPair[] }>(
        `${BASE}/latest/dex/tokens/${item.tokenAddress}`
      );
      const best = pickBestSolPair(pairs?.pairs ?? []);
      if (best) out.push(best);
      boosts++;
      if (boosts >= 8) break;
      await sleep(250);
    }
  }

  // Also pull Solana search for high volume
  const search = await fetchJson<{ pairs?: DexPair[] }>(`${BASE}/latest/dex/search?q=SOL`);
  for (const p of search?.pairs ?? []) {
    const c = toCandidate(p, "dexscreener-search");
    if (c) out.push(c);
  }

  return dedupeByMint(out);
}

/** Pump.fun pairs via DexScreener (official Pump.fun API is awkward / rate-limited). */
export async function scanPumpFunViaDex(): Promise<CandidateToken[]> {
  // DexScreener indexes pump.fun; search "pump" on solana
  const search = await fetchJson<{ pairs?: DexPair[] }>(`${BASE}/latest/dex/search?q=pump`);
  const out: CandidateToken[] = [];
  for (const p of search?.pairs ?? []) {
    const c = toCandidate(p, "pumpfun-via-dexscreener");
    if (!c) continue;
    // Prefer pairs that look like pump launches (young + volume)
    out.push(c);
  }
  // Token profiles recently boosted on solana
  const profiles = await fetchJson<Array<{ url?: string; chainId?: string; tokenAddress?: string }>>(
    `${BASE}/token-profiles/latest/v1`
  );
  if (Array.isArray(profiles)) {
    let n = 0;
    for (const prof of profiles) {
      if (prof.chainId !== "solana" || !prof.tokenAddress) continue;
      const pairs = await fetchJson<{ pairs?: DexPair[] }>(
        `${BASE}/latest/dex/tokens/${prof.tokenAddress}`
      );
      const best = pickBestSolPair(pairs?.pairs ?? []);
      if (best) {
        best.source = "dexscreener-profiles";
        out.push(best);
      }
      n++;
      if (n >= 5) break;
      await sleep(300);
    }
  }
  return dedupeByMint(out);
}

function pickBestSolPair(pairs: DexPair[]): CandidateToken | null {
  const sol = pairs
    .map((p) => toCandidate(p, "dexscreener"))
    .filter((c): c is CandidateToken => c !== null)
    .sort((a, b) => b.liquidityUsd - a.liquidityUsd);
  return sol[0] ?? null;
}

function dedupeByMint(tokens: CandidateToken[]): CandidateToken[] {
  const map = new Map<string, CandidateToken>();
  for (const t of tokens) {
    const prev = map.get(t.mint);
    if (!prev || t.volumeSpikeRatio > prev.volumeSpikeRatio) map.set(t.mint, t);
  }
  return [...map.values()];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function getTokenPriceUsd(mint: string): Promise<number | null> {
  const data = await fetchJson<{ pairs?: DexPair[] }>(`${BASE}/latest/dex/tokens/${mint}`);
  const best = pickBestSolPair(data?.pairs ?? []);
  return best?.priceUsd ?? null;
}
