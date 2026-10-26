import { PublicKey } from "@solana/web3.js";
import { getConnection } from "./wallet.js";

export interface TokenSafety {
  mint: string;
  topHolderPercent?: number;
  top10HolderPercent?: number;
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

/**
 * Pre-buy safety using public RPC (fail-fast on 429 / timeout).
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
