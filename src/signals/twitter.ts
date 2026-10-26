import { loadConfig } from "../config.js";
import type { CandidateToken } from "../filters.js";

export interface TwitterSignal {
  mint: string;
  symbol: string;
  score: number;
  trending: boolean;
  source: "x-api" | "xai-grok" | "heuristic-mock" | "disabled";
  detail: string;
}

/**
 * Optional trend signal.
 * Priority:
 *  1. X_BEARER_TOKEN → X recent search
 *  2. XAI_API_KEY → light Grok judgment on volume/spike context
 *  3. Heuristic mock (volume spike + buzz keywords) when useMockWhenNoKey
 * Graceful degrade without keys — scanning still works.
 */
export async function checkTwitterSignal(token: CandidateToken): Promise<TwitterSignal> {
  const cfg = loadConfig();
  if (!cfg.twitter.enabled) {
    return {
      mint: token.mint,
      symbol: token.symbol,
      score: 1,
      trending: true,
      source: "disabled",
      detail: "Twitter checks disabled — treated as pass",
    };
  }

  const bearer = cfg.xBearerToken;
  if (bearer) {
    try {
      const q = encodeURIComponent(`$${token.symbol} OR ${token.symbol} solana -is:retweet`);
      const url = `https://api.x.com/2/tweets/search/recent?query=${q}&max_results=10`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = (await res.json()) as { meta?: { result_count?: number }; data?: unknown[] };
        const count = data.meta?.result_count ?? data.data?.length ?? 0;
        const trending = count >= cfg.twitter.minMentionsHeuristic;
        return {
          mint: token.mint,
          symbol: token.symbol,
          score: count,
          trending,
          source: "x-api",
          detail: `recent tweets matching cashtag/symbol: ${count}`,
        };
      }
      // fall through to xAI / heuristic
    } catch {
      /* fall through */
    }
  }

  if (cfg.xaiApiKey) {
    try {
      const prompt = `Solana memecoin quick trend check. Symbol=${token.symbol} name=${token.name} volumeSpike=${token.volumeSpikeRatio.toFixed(2)}x liquidityUsd=${Math.round(token.liquidityUsd)} vol24hUsd=${Math.round(token.volume24hUsd)}. Reply ONLY JSON: {"trending":true|false,"score":0-10,"reason":"short"}.`;
      const res = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.xaiApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "grok-2-latest",
          messages: [
            {
              role: "system",
              content: "You score speculative crypto social buzz. Be skeptical. Output JSON only.",
            },
            { role: "user", content: prompt },
          ],
          temperature: 0.2,
          max_tokens: 120,
        }),
        signal: AbortSignal.timeout(12_000),
      });
      if (res.ok) {
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = data.choices?.[0]?.message?.content ?? "";
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as {
            trending?: boolean;
            score?: number;
            reason?: string;
          };
          const score = Number(parsed.score) || 0;
          return {
            mint: token.mint,
            symbol: token.symbol,
            score,
            trending: !!parsed.trending,
            source: "xai-grok",
            detail: parsed.reason || `Grok score ${score}`,
          };
        }
      }
    } catch {
      /* fall through to heuristic */
    }
  }

  // No API key (or upstream failed): heuristic — volume spike + keyword-ish symbol
  const buzz = cfg.twitter.keywords.some(
    (k) => token.symbol.toLowerCase().includes(k) || token.name.toLowerCase().includes(k)
  );
  const trending =
    cfg.twitter.useMockWhenNoKey && (token.volumeSpikeRatio >= cfg.filters.minVolumeSpikeRatio || buzz);
  return {
    mint: token.mint,
    symbol: token.symbol,
    score: token.volumeSpikeRatio,
    trending,
    source: "heuristic-mock",
    detail: trending
      ? `No live social key — heuristic pass (spike ${token.volumeSpikeRatio.toFixed(2)}x${buzz ? ", buzz keyword" : ""})`
      : `No live social key — heuristic reject (low spike, no buzz)`,
  };
}
