import {
  VersionedTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { SOL_MINT, loadConfig } from "./config.js";
import { getConnection, loadKeypair } from "./wallet.js";

export interface SwapResult {
  ok: boolean;
  dryRun: boolean;
  signature?: string;
  outAmount?: string;
  error?: string;
  detail?: string;
}

function jupHeaders(): Record<string, string> {
  const cfg = loadConfig();
  const h: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cfg.jupiterApiKey) h["x-api-key"] = cfg.jupiterApiKey;
  return h;
}

/**
 * Jupiter Swap API v2: GET /swap/v2/order → sign VersionedTransaction → POST /swap/v2/execute
 * Official only: https://api.jup.ag/swap/v2
 */
export async function swapSolToToken(outputMint: string, solAmount: number): Promise<SwapResult> {
  const cfg = loadConfig();
  if (solAmount <= 0 || solAmount > cfg.maxBuyAmountSol) {
    return { ok: false, dryRun: cfg.dryRun, error: `Buy size ${solAmount} outside (0, ${cfg.maxBuyAmountSol}]` };
  }
  const amount = Math.floor(solAmount * LAMPORTS_PER_SOL);
  return executeSwap({
    inputMint: SOL_MINT,
    outputMint,
    amount,
    direction: "buy",
  });
}

export async function swapTokenToSol(inputMint: string, rawTokenAmount: bigint | number): Promise<SwapResult> {
  const amount = typeof rawTokenAmount === "bigint" ? rawTokenAmount : BigInt(Math.floor(rawTokenAmount));
  if (amount <= 0n) {
    return { ok: false, dryRun: loadConfig().dryRun, error: "Token amount must be > 0" };
  }
  return executeSwap({
    inputMint,
    outputMint: SOL_MINT,
    amount: amount,
    direction: "sell",
  });
}

async function executeSwap(params: {
  inputMint: string;
  outputMint: string;
  amount: number | bigint;
  direction: "buy" | "sell";
}): Promise<SwapResult> {
  const cfg = loadConfig();
  const kp = loadKeypair();
  const taker = kp.publicKey.toBase58();

  const orderUrl = new URL("https://api.jup.ag/swap/v2/order");
  orderUrl.searchParams.set("inputMint", params.inputMint);
  orderUrl.searchParams.set("outputMint", params.outputMint);
  orderUrl.searchParams.set("amount", String(params.amount));
  orderUrl.searchParams.set("taker", taker);
  orderUrl.searchParams.set("slippageBps", String(cfg.slippageBps));

  let order: {
    transaction?: string | null;
    requestId?: string;
    outAmount?: string;
    errorMessage?: string;
    router?: string;
  };

  try {
    const res = await fetch(orderUrl.toString(), {
      headers: jupHeaders(),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    try {
      order = JSON.parse(text) as typeof order;
    } catch {
      return { ok: false, dryRun: cfg.dryRun, error: `Order non-JSON: HTTP ${res.status} ${text.slice(0, 200)}` };
    }
    if (!res.ok || order.errorMessage) {
      return {
        ok: false,
        dryRun: cfg.dryRun,
        error: order.errorMessage || `Order HTTP ${res.status}`,
      };
    }
  } catch (e) {
    return { ok: false, dryRun: cfg.dryRun, error: `Order fetch: ${(e as Error).message}` };
  }

  if (cfg.dryRun) {
    return {
      ok: true,
      dryRun: true,
      outAmount: order.outAmount,
      detail: `DRY_RUN ${params.direction}: would swap ${params.amount} of ${params.inputMint} → ${params.outputMint} (est out ${order.outAmount ?? "?"}) via ${order.router ?? "jupiter"}`,
    };
  }

  if (!order.transaction || !order.requestId) {
    return {
      ok: false,
      dryRun: false,
      error: "Order missing transaction or requestId — cannot execute",
      outAmount: order.outAmount,
    };
  }

  try {
    const txBuf = Buffer.from(order.transaction, "base64");
    const vtx = VersionedTransaction.deserialize(txBuf);
    vtx.sign([kp]);
    const signedTx = Buffer.from(vtx.serialize()).toString("base64");

    const execRes = await fetch("https://api.jup.ag/swap/v2/execute", {
      method: "POST",
      headers: jupHeaders(),
      body: JSON.stringify({
        signedTransaction: signedTx,
        requestId: order.requestId,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    const execJson = (await execRes.json()) as {
      signature?: string;
      status?: string;
      error?: string;
      code?: number;
    };
    if (!execRes.ok || execJson.error || (execJson.status && execJson.status !== "Success")) {
      // Fallback: send via our RPC if execute endpoint complains
      if (execJson.signature) {
        return { ok: true, dryRun: false, signature: execJson.signature, outAmount: order.outAmount };
      }
      const conn = getConnection();
      const sig = await conn.sendRawTransaction(vtx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });
      await conn.confirmTransaction(sig, "confirmed");
      return { ok: true, dryRun: false, signature: sig, outAmount: order.outAmount, detail: "sent via RPC fallback" };
    }
    return {
      ok: true,
      dryRun: false,
      signature: execJson.signature,
      outAmount: order.outAmount,
    };
  } catch (e) {
    return { ok: false, dryRun: false, error: `Sign/execute: ${(e as Error).message}` };
  }
}
