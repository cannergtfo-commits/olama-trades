import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./wallet.js";

export interface TokenSafety {
  mint: string;
  topHolderPercent?: number;
  top10HolderPercent?: number;
  /** Bundled / insider-network supply concentration % (0–100). Undefined = unknown. */
  bundlerPercent?: number;
  bundlerSource?: string;
  mintAuthority?: string | "revoked";
  freezeAuthority?: string | "revoked";
  supply?: number;
  errors?: string[];
  notes?: string[];
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

interface BundlerProbe {
  percent?: number;
  source?: string;
  note?: string;
  error?: string;
}

/**
 * RugCheck public report → bundler/insider concentration %.
 * Preferred signal: sum(insiderNetworks.currentHolding) / token.supply * 100.
 * Fallbacks: sum(topHolders where insider) pct; graphInsidersDetected==0 ⇒ 0%.
 */
export async function fetchBundlerFromRugCheck(mint: string): Promise<BundlerProbe> {
  const url = `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`;
  try {
    const res = await withTimeout(
      fetch(url, { headers: { Accept: "application/json" } }),
      12_000,
      "rugcheck"
    );
    if (!res.ok) {
      return { error: `rugcheck HTTP ${res.status}` };
    }
    const d = (await res.json()) as {
      token?: { supply?: number | string; decimals?: number };
      graphInsidersDetected?: number;
      insiderNetworks?: Array<{
        currentHolding?: number | string;
        tokenAmount?: number | string;
      }> | null;
      topHolders?: Array<{ pct?: number; insider?: boolean }>;
      risks?: Array<{ name?: string; value?: string; description?: string }>;
    };

    const supplyRaw = Number(d.token?.supply ?? 0);
    const networks = Array.isArray(d.insiderNetworks) ? d.insiderNetworks : [];

    if (networks.length > 0 && supplyRaw > 0) {
      const held = networks.reduce((acc, n) => {
        const h = Number(n.currentHolding ?? n.tokenAmount ?? 0);
        return acc + (Number.isFinite(h) ? h : 0);
      }, 0);
      const pct = Math.min(100, Math.max(0, (held / supplyRaw) * 100));
      return {
        percent: pct,
        source: "rugcheck:insiderNetworks",
        note: `RugCheck insider networks ${networks.length}; graphInsiders=${d.graphInsidersDetected ?? "?"}`,
      };
    }

    const top = Array.isArray(d.topHolders) ? d.topHolders : [];
    const insiderTopPct = top
      .filter((h) => h.insider)
      .reduce((acc, h) => acc + (Number(h.pct) || 0), 0);
    if (insiderTopPct > 0) {
      return {
        percent: Math.min(100, insiderTopPct),
        source: "rugcheck:topHolders.insider",
        note: "RugCheck topHolders marked insider",
      };
    }

    // Parse risk rows that explicitly mention bundle / sniper concentration
    for (const r of d.risks ?? []) {
      const blob = `${r.name ?? ""} ${r.value ?? ""} ${r.description ?? ""}`.toLowerCase();
      if (/(bundle|bundler|sniper)/.test(blob)) {
        const m = `${r.value ?? ""} ${r.description ?? ""}`.match(/(\d+(?:\.\d+)?)\s*%/);
        if (m) {
          return {
            percent: Math.min(100, Number(m[1])),
            source: "rugcheck:risks",
            note: `RugCheck risk: ${r.name ?? "bundle"}`,
          };
        }
      }
    }

    const graph = Number(d.graphInsidersDetected ?? 0);
    if (graph === 0 && networks.length === 0) {
      return {
        percent: 0,
        source: "rugcheck:none",
        note: "RugCheck: no insider networks / graph insiders detected",
      };
    }

    // Graph insiders reported but no holdings math available — unknown concentration
    if (graph > 0) {
      return {
        error: `rugcheck graphInsidersDetected=${graph} but no holding amounts to compute %`,
      };
    }

    return { percent: 0, source: "rugcheck:empty", note: "RugCheck report had no bundler signals" };
  } catch (e) {
    return { error: `rugcheck: ${(e as Error).message}` };
  }
}

/**
 * Solana Tracker bundlers endpoint (requires SOLANA_TRACKER_API_KEY).
 * Reads `percentage` (or nested total percentage) from the response.
 */
export async function fetchBundlerFromSolanaTracker(mint: string): Promise<BundlerProbe> {
  const key = process.env.SOLANA_TRACKER_API_KEY?.trim();
  if (!key) return { note: "solana-tracker skipped (no SOLANA_TRACKER_API_KEY)" };

  const url = `https://data.solanatracker.io/tokens/${encodeURIComponent(mint)}/bundlers`;
  try {
    const res = await withTimeout(
      fetch(url, {
        headers: {
          Accept: "application/json",
          "x-api-key": key,
          Authorization: `Bearer ${key}`,
        },
      }),
      12_000,
      "solana-tracker"
    );
    if (!res.ok) {
      return { error: `solana-tracker HTTP ${res.status}` };
    }
    const d = (await res.json()) as Record<string, unknown>;
    const direct = Number(d.percentage ?? d.percent ?? d.bundlerPercentage);
    if (Number.isFinite(direct)) {
      return {
        percent: Math.min(100, Math.max(0, direct)),
        source: "solana-tracker:percentage",
      };
    }
    const total = d.total;
    if (total && typeof total === "object") {
      const p = Number((total as { percentage?: number }).percentage);
      if (Number.isFinite(p)) {
        return {
          percent: Math.min(100, Math.max(0, p)),
          source: "solana-tracker:total.percentage",
        };
      }
    }
    return { error: "solana-tracker: percentage field missing" };
  } catch (e) {
    return { error: `solana-tracker: ${(e as Error).message}` };
  }
}

/** Prefer RugCheck (free); fall back to Solana Tracker when keyed. */
export async function resolveBundlerPercent(mint: string): Promise<BundlerProbe> {
  const rug = await fetchBundlerFromRugCheck(mint);
  if (rug.percent !== undefined && Number.isFinite(rug.percent)) return rug;

  const tracker = await fetchBundlerFromSolanaTracker(mint);
  if (tracker.percent !== undefined && Number.isFinite(tracker.percent)) return tracker;

  return {
    error: [rug.error, tracker.error].filter(Boolean).join("; ") || "bundler % unknown",
    note: [rug.note, tracker.note].filter(Boolean).join("; "),
  };
}

/**
 * Pre-buy safety using public RPC + RugCheck bundler probe (fail-fast on 429 / timeout).
 * Limitations documented in SECURITY.md.
 */
export async function checkTokenSafety(mint: string): Promise<TokenSafety> {
  const result: TokenSafety = { mint, notes: [], errors: [] };
  let mintPk: PublicKey;
  try {
    mintPk = new PublicKey(mint);
  } catch {
    result.errors!.push("invalid mint pubkey");
    return result;
  }

  const conn = getConnection();

  try {
    const mintInfo = await withTimeout(conn.getParsedAccountInfo(mintPk), 8_000, "mint info");
    const data = mintInfo.value?.data;
    if (data && typeof data === "object" && "parsed" in data) {
      const parsed = (data as { parsed: { info: Record<string, unknown> } }).parsed.info;
      const supplyStr = String(parsed.supply ?? "0");
      const decimals = Number(parsed.decimals ?? 0);
      result.supply = Number(supplyStr) / Math.pow(10, decimals);
      const ma = parsed.mintAuthority;
      const fa = parsed.freezeAuthority;
      result.mintAuthority = ma ? String(ma) : "revoked";
      result.freezeAuthority = fa ? String(fa) : "revoked";
    } else {
      result.notes!.push("could not parse mint account; authority checks skipped");
    }
  } catch (e) {
    result.errors!.push(`mint info RPC: ${(e as Error).message}`);
  }

  try {
    const largest = await withTimeout(conn.getTokenLargestAccounts(mintPk), 8_000, "largest accounts");
    const accounts = largest.value ?? [];
    if (accounts.length === 0) {
      result.notes!.push("no largest accounts returned");
    } else {
      const amounts = accounts.map((a) => Number(a.uiAmount ?? 0));
      const totalTracked = amounts.reduce((a, b) => a + b, 0);
      const denom = result.supply && result.supply > 0 ? result.supply : totalTracked;
      if (denom > 0) {
        result.topHolderPercent = (amounts[0] / denom) * 100;
        const top10 = amounts.slice(0, 10).reduce((a, b) => a + b, 0);
        result.top10HolderPercent = (top10 / denom) * 100;
      }
      result.notes!.push(
        "Holder % uses getTokenLargestAccounts; LP/pool wallets inflate top holders — heuristic only"
      );
    }
  } catch (e) {
    result.errors!.push(`largest accounts RPC: ${(e as Error).message}`);
  }

  // RugCheck fills holders / authorities when public RPC is rate-limited
  try {
    const url = `https://api.rugcheck.xyz/v1/tokens/${encodeURIComponent(mint)}/report`;
    const res = await withTimeout(fetch(url, { headers: { Accept: "application/json" } }), 12_000, "rugcheck-holders");
    if (res.ok) {
      const d = (await res.json()) as {
        mintAuthority?: string | null;
        freezeAuthority?: string | null;
        token?: { mintAuthority?: string | null; freezeAuthority?: string | null; supply?: number | string };
        topHolders?: Array<{ pct?: number }>;
      };
      if (result.mintAuthority === undefined) {
        const ma = d.mintAuthority ?? d.token?.mintAuthority;
        result.mintAuthority = ma ? String(ma) : "revoked";
        result.notes!.push("mint authority from RugCheck (RPC fallback)");
      }
      if (result.freezeAuthority === undefined) {
        const fa = d.freezeAuthority ?? d.token?.freezeAuthority;
        result.freezeAuthority = fa ? String(fa) : "revoked";
        result.notes!.push("freeze authority from RugCheck (RPC fallback)");
      }
      const top = Array.isArray(d.topHolders) ? d.topHolders : [];
      if (top.length > 0 && (result.topHolderPercent === undefined || result.top10HolderPercent === undefined)) {
        const pcts = top.map((h) => Number(h.pct) || 0);
        result.topHolderPercent = pcts[0];
        result.top10HolderPercent = pcts.slice(0, 10).reduce((a, b) => a + b, 0);
        result.notes!.push("Holder % from RugCheck topHolders (RPC fallback)");
        // Drop RPC largest-account errors so filters don't fail-closed spuriously
        result.errors = (result.errors ?? []).filter((e) => !e.includes("largest accounts RPC"));
      }
    }
  } catch (e) {
    result.notes!.push(`rugcheck holder fallback: ${(e as Error).message}`);
  }

  const bundler = await resolveBundlerPercent(mint);
  if (bundler.percent !== undefined && Number.isFinite(bundler.percent)) {
    result.bundlerPercent = bundler.percent;
    result.bundlerSource = bundler.source;
    if (bundler.note) result.notes!.push(bundler.note);
  } else {
    result.errors!.push(bundler.error || "bundler % unknown");
    if (bundler.note) result.notes!.push(bundler.note);
  }

  return result;
}

export async function rpcHealthy(): Promise<boolean> {
  try {
    const c = getConnection();
    const slot = await withTimeout(c.getSlot(), 5_000, "getSlot");
    return slot > 0;
  } catch {
    return false;
  }
}
