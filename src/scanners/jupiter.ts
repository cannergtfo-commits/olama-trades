import { SOL_MINT, loadConfig } from "../config.js";

const ORDER_BASE = "https://api.jup.ag/swap/v2";

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
  url.searchParams.set("taker", "11111111111111111111111111111111"); // placeholder for quote-only probe

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
