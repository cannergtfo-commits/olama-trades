/**
 * UI-owned cache of the latest market scan (data/last-scan.json).
 * Populated by dashboard [s] / web /api/scan — not by the trading engine.
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT } from "../config.js";
import type { ScanReportRow } from "../strategy.js";

export interface LastScanRowView {
  symbol: string;
  mint: string;
  filterPass: boolean;
  reasons: string[];
  volumeSpikeRatio: number;
  liquidityUsd: number;
  volume24hUsd: number;
  source: string;
  twitter?: string;
  confluenceScore?: number;
  bondingStatus?: string;
  volumeSummary?: string;
  liquidityRiskNote?: string;
  sourceTags?: string[];
  momentumHint?: string;
  patternTags?: string[];
  patternScore?: number;
  patternBias?: string;
}

export interface LastScanCache {
  at: string;
  notes?: string[];
  rows: LastScanRowView[];
}

const PATH = path.join(ROOT, "data", "last-scan.json");

export function loadLastScan(): LastScanCache | null {
  if (!fs.existsSync(PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(PATH, "utf8")) as LastScanCache;
  } catch {
    return null;
  }
}

export function saveLastScan(rows: ScanReportRow[], notes?: string[]): LastScanCache {
  const cache: LastScanCache = {
    at: new Date().toISOString(),
    notes,
    rows: rows.slice(0, 40).map((r) => ({
      symbol: r.token.symbol,
      mint: r.token.mint,
      filterPass: r.filterPass,
      reasons: r.filterReasons,
      volumeSpikeRatio: r.token.volumeSpikeRatio,
      liquidityUsd: r.token.liquidityUsd,
      volume24hUsd: r.token.volume24hUsd,
      source: r.token.source,
      twitter: r.twitter,
      confluenceScore: r.confluenceScore ?? r.token.confluenceScore,
      bondingStatus: r.bondingStatus ?? r.token.bondingStatus,
      volumeSummary: r.volumeSummary,
      liquidityRiskNote: r.liquidityRiskNote,
      sourceTags: r.sourceTags ?? r.token.sourceTagList,
      momentumHint: r.token.momentumHint,
      patternTags: r.patternTags ?? r.token.patternTags,
      patternScore: r.patternScore ?? r.token.patternScore,
      patternBias: r.patternBias ?? r.token.patternBias,
    })),
  };
  const dir = path.dirname(PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PATH, JSON.stringify(cache, null, 2) + "\n", "utf8");
  return cache;
}
