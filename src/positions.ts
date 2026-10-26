import fs from "node:fs";
import path from "node:path";
import { POSITIONS_PATH, ROOT } from "./config.js";

export interface Position {
  id: string;
  mint: string;
  symbol: string;
  entryPriceUsd: number;
  amountToken: number;
  amountSolSpent: number;
  takeProfitPct: number;
  stopLossPct: number;
  openedAt: string;
  status: "open" | "closed";
  closeReason?: "tp" | "sl" | "manual";
  closedAt?: string;
  exitPriceUsd?: number;
  dryRun: boolean;
  txBuy?: string;
  txSell?: string;
}

export interface PositionsStore {
  positions: Position[];
}

function ensureDataDir(): void {
  const dir = path.join(ROOT, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadPositions(): PositionsStore {
  ensureDataDir();
  if (!fs.existsSync(POSITIONS_PATH)) {
    return { positions: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(POSITIONS_PATH, "utf8")) as PositionsStore;
  } catch {
    return { positions: [] };
  }
}

export function savePositions(store: PositionsStore): void {
  ensureDataDir();
  fs.writeFileSync(POSITIONS_PATH, JSON.stringify(store, null, 2) + "\n", "utf8");
}

export function openPositions(): Position[] {
  return loadPositions().positions.filter((p) => p.status === "open");
}

export function addPosition(pos: Position): void {
  const store = loadPositions();
  store.positions.push(pos);
  savePositions(store);
}

export function closePosition(
  id: string,
  reason: "tp" | "sl" | "manual",
  exitPriceUsd: number,
  txSell?: string
): void {
  const store = loadPositions();
  const p = store.positions.find((x) => x.id === id);
  if (!p) return;
  p.status = "closed";
  p.closeReason = reason;
  p.closedAt = new Date().toISOString();
  p.exitPriceUsd = exitPriceUsd;
  if (txSell) p.txSell = txSell;
  savePositions(store);
}

export function hasOpenMint(mint: string): boolean {
  return openPositions().some((p) => p.mint === mint);
}
