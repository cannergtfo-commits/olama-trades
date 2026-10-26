/**
 * Keyword helpers: plain buzz words + Solana mint (contract) addresses.
 * Mints are base58 pubkeys (32–44 chars). Matching is exact + case-insensitive.
 */
import type { CandidateToken } from "./filters.js";
import type { AppConfig } from "./config.js";
import { openPositions } from "./positions.js";

/** Solana base58 pubkey / mint (excludes 0 O I l). */
const BASE58_MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function isMintAddress(value: string): boolean {
  const s = value.trim();
  if (!BASE58_MINT_RE.test(s)) return false;
  // Exclude the well-known wrapped SOL mint from "watch list" false positives when used as a word? Keep as mint.
  return true;
}

export function normalizeMint(mint: string): string {
  return mint.trim();
}

export function mintsEqual(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export interface ParsedKeywords {
  /** Lowercased buzz words (non-mint). */
  words: string[];
  /** Original-cased mint addresses from the keyword list. */
  mints: string[];
}

/** Split a keyword list into buzz words vs mint addresses. */
export function parseKeywords(keywords: string[]): ParsedKeywords {
  const words: string[] = [];
  const mints: string[] = [];
  const seenMint = new Set<string>();
  for (const raw of keywords) {
    const k = String(raw ?? "").trim();
    if (!k) continue;
    if (isMintAddress(k)) {
      const key = k.toLowerCase();
      if (!seenMint.has(key)) {
        seenMint.add(key);
        mints.push(k);
      }
    } else {
      words.push(k.toLowerCase());
    }
  }
  return { words, mints };
}

/**
 * Effective watch-list mints: configured keywords that are mints,
 * plus optional open-position mints and top hot-scan mints (transient).
 */
export function resolveWatchedMints(
  cfg: AppConfig,
  opts: { hotScanMints?: string[] } = {}
): string[] {
  const parsed = parseKeywords(cfg.twitter.keywords);
  const out: string[] = [...parsed.mints];
  const seen = new Set(out.map((m) => m.toLowerCase()));

  if (cfg.twitter.autoWatchOpenMints) {
    for (const p of openPositions()) {
      const m = p.mint?.trim();
      if (!m || !isMintAddress(m)) continue;
      const key = m.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(m);
      }
    }
  }

  if (cfg.twitter.autoWatchHotMints && opts.hotScanMints?.length) {
    for (const m of opts.hotScanMints) {
      const t = m?.trim();
      if (!t || !isMintAddress(t)) continue;
      const key = t.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(t);
      }
    }
  }

  return out;
}

/** True when candidate mint is on the watch list (exact, case-insensitive). */
export function candidateMatchesWatchedMint(
  token: CandidateToken,
  watchedMints: string[]
): boolean {
  return watchedMints.some((m) => mintsEqual(m, token.mint));
}

/** Buzz-word hit on symbol/name (mint keywords excluded — use candidateMatchesWatchedMint). */
export function candidateMatchesBuzzKeyword(
  token: CandidateToken,
  words: string[]
): boolean {
  const sym = (token.symbol || "").toLowerCase();
  const name = (token.name || "").toLowerCase();
  return words.some((k) => k && (sym.includes(k) || name.includes(k)));
}

/**
 * Build an X recent-search query that includes cashtag/symbol and any
 * configured mint addresses (contract searches on X).
 */
export function buildXSearchQuery(token: CandidateToken, keywords: string[]): string {
  const { mints } = parseKeywords(keywords);
  const parts = [`$${token.symbol}`, token.symbol, "solana"];
  // Prefer exact mint match for this candidate if watched; else include up to 2 configured mints
  const mintForToken = mints.find((m) => mintsEqual(m, token.mint));
  if (mintForToken) {
    parts.push(mintForToken);
  } else {
    for (const m of mints.slice(0, 2)) parts.push(m);
  }
  return `${parts.join(" OR ")} -is:retweet`;
}
