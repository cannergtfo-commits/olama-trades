import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

export type TxKind = "buy" | "sell" | "withdraw";

export interface TxRecord {
  id: string;
  kind: TxKind;
  timestamp: string;
  mint?: string;
  symbol?: string;
  amountSol?: number;
  amountToken?: number;
  priceUsd?: number;
  pnlSol?: number;
  pnlPct?: number;
  signature?: string;
  dryRun: boolean;
  note?: string;
  destination?: string;
}

const HISTORY_PATH = path.join(ROOT, "data", "history.json");

export interface HistoryStore {
  transactions: TxRecord[];
}

function ensure(): void {
  const dir = path.join(ROOT, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadHistory(): HistoryStore {
  ensure();
  if (!fs.existsSync(HISTORY_PATH)) return { transactions: [] };
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8")) as HistoryStore;
  } catch {
    return { transactions: [] };
  }
}

export function saveHistory(store: HistoryStore): void {
  ensure();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function addTx(rec: Omit<TxRecord, "id" | "timestamp"> & { id?: string; timestamp?: string }): TxRecord {
  const store = loadHistory();
  const full: TxRecord = {
    id: rec.id ?? cryptoRandom(),
    timestamp: rec.timestamp ?? new Date().toISOString(),
    kind: rec.kind,
    mint: rec.mint,
    symbol: rec.symbol,
    amountSol: rec.amountSol,
    amountToken: rec.amountToken,
    priceUsd: rec.priceUsd,
    pnlSol: rec.pnlSol,
    pnlPct: rec.pnlPct,
    signature: rec.signature,
    dryRun: rec.dryRun,
    note: rec.note,
    destination: rec.destination,
  };
  store.transactions.unshift(full);
  // keep last 500
  if (store.transactions.length > 500) store.transactions.length = 500;
  saveHistory(store);
  return full;
}

function cryptoRandom(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function explorerTxUrl(signature: string): string {
  return `https://solscan.io/tx/${signature}`;
}

export function explorerTokenUrl(mint: string): string {
  return `https://solscan.io/token/${mint}`;
}

export function recentTx(limit = 20): TxRecord[] {
  return loadHistory().transactions.slice(0, limit);
}
