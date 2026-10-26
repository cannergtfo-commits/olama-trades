import { loadConfig } from "../config.js";
import type { CandidateToken } from "../filters.js";
import {
  buildXSearchQuery,
  candidateMatchesBuzzKeyword,
  candidateMatchesWatchedMint,
  parseKeywords,
  resolveWatchedMints,
} from "../keywords.js";

export interface TwitterSignal {
  mint: string;
  symbol: string;
  score: number;
  trending: boolean;
  source: "x-api" | "ollama" | "xai-grok" | "heuristic-mock" | "watched-mint" | "disabled";
  detail: string;
  /** True when candidate mint matches a configured/transient mint keyword. */
  watchedMintMatch?: boolean;
}

/**
 * Optional trend signal.
 * Priority:
 *  0. Watched mint keyword exact match → strong pass / boost
 *  1. X_BEARER_TOKEN → X recent search (cashtag + mint keywords)
 *  2. Ollama (qwen2.5-coder:14b) → light local judgment on volume/spike context
 *  3. XAI_API_KEY → optional cloud fallback when CHAT_PROVIDER=auto|xai
 *  4. Heuristic mock (volume spike + buzz keywords) when useMockWhenNoKey
 * Graceful degrade without keys — scanning still works.
 */
export async function checkTwitterSignal(
  token: CandidateToken,
  opts: { watchedMints?: string[]; hotScanMints?: string[] } = {}
): Promise<TwitterSignal> {
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

  const watched =
    opts.watchedMints ??
    resolveWatchedMints(cfg, { hotScanMints: opts.hotScanMints });
  const mintHit = candidateMatchesWatchedMint(token, watched);
  if (mintHit) {
    token.watchedMintMatch = true;
  }

  // Exact mint keyword match: treat as social/watchlist pass + boost
  if (mintHit) {
    return {
      mint: token.mint,
      symbol: token.symbol,
      score: Math.max(10, cfg.twitter.minMentionsHeuristic + 5),
      trending: true,
      source: "watched-mint",
      detail: `watched mint keyword match (exact): ${token.mint.slice(0, 8)}…`,
      watchedMintMatch: true,
    };
  }

  const bearer = cfg.xBearerToken;
  if (bearer) {
    try {
      const q = encodeURIComponent(buildXSearchQuery(token, cfg.twitter.keywords));
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
          detail: `recent tweets matching cashtag/symbol/mint: ${count}`,
          watchedMintMatch: false,
        };
      }
      // fall through to xAI / heuristic
    } catch {
      /* fall through */
    }
  }

  // Local Ollama (primary) or optional xAI — shared llm client
  try {
    const { chatCompletion } = await import("../llm.js");
    const prompt = `Solana memecoin quick trend check. Symbol=${token.symbol} name=${token.name} mint=${token.mint} volumeSpike=${token.volumeSpikeRatio.toFixed(2)}x liquidityUsd=${Math.round(token.liquidityUsd)} vol24hUsd=${Math.round(token.volume24hUsd)}. Reply ONLY JSON: {"trending":true|false,"score":0-10,"reason":"short"}.`;
    const result = await chatCompletion({
      messages: [
        {
          role: "system",
          content: "You score speculative crypto social buzz. Be skeptical. Output JSON only. Never ask for keys.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.2,
      maxTokens: 120,
      timeoutMs: 30_000,
    });
    const match = result.text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as {
        trending?: boolean;
        score?: number;
        reason?: string;
      };
      const score = Number(parsed.score) || 0;
      const src = result.backend === "ollama" ? "ollama" as const : "xai-grok" as const;
      return {
        mint: token.mint,
        symbol: token.symbol,
        score,
        trending: !!parsed.trending,
        source: src,
        detail: parsed.reason || `${result.backend} score ${score}`,
        watchedMintMatch: false,
      };
    }
  } catch {
    /* fall through to heuristic */
  }

  // No API key (or upstream failed): heuristic — volume spike + buzz word (not mint)
  const { words } = parseKeywords(cfg.twitter.keywords);
  const buzz = candidateMatchesBuzzKeyword(token, words);
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
    watchedMintMatch: false,
  };
}
