/**
 * Read-only + control helpers for TUI/web dashboards (sibling UI under src/ui / public).
 * Never exposes keypair secret material.
 */
import { loadConfig } from "./config.js";
import { describeFilters } from "./filters.js";
import {
  loadBotState,
  setArmed,
  toggleArmed,
  setUiRefresh,
  toggleUiRefresh,
  markTick,
  markTicking,
  type BotRuntimeState,
} from "./bot-state.js";
import { openPositions, loadPositions, type Position } from "./positions.js";
import {
  recentTx,
  loadHistory,
  explorerTxUrl,
  explorerTokenUrl,
  type TxRecord,
} from "./history.js";
import { safeWalletInfo, getBalanceSol, walletExists } from "./wallet.js";
import { rpcHealthy } from "./security-checks.js";

export type { BotRuntimeState, Position, TxRecord };

export interface PublicWalletView {
  exists: boolean;
  address: string;
  balanceSol: number | null;
  keypairPath: string;
  rpcHealthy: boolean;
}

export interface HistoryView extends TxRecord {
  explorerTx?: string;
  explorerToken?: string;
}

export interface AppSnapshot {
  at: string;
  timezone: "America/Los_Angeles";
  bot: BotRuntimeState;
  config: {
    dryRun: boolean;
    buyAmountSol: number;
    maxBuyAmountSol: number;
    takeProfitPct: number;
    stopLossPct: number;
    slippageBps: number;
    maxOpenPositions: number;
    scanIntervalMs: number;
    filters: ReturnType<typeof loadConfig>["filters"];
    filtersText: string;
  };
  wallet: PublicWalletView;
  positions: Position[];
  closedCount: number;
  history: HistoryView[];
}

export function getBotState(): BotRuntimeState {
  return loadBotState();
}

export function armBot(): BotRuntimeState {
  return setArmed(true);
}

export function disarmBot(): BotRuntimeState {
  return setArmed(false);
}

export function toggleBotArmed(): BotRuntimeState {
  return toggleArmed();
}

export function setDashboardRefresh(on: boolean): BotRuntimeState {
  return setUiRefresh(on);
}

export function toggleDashboardRefresh(): BotRuntimeState {
  return toggleUiRefresh();
}

export { markTick, markTicking };

export function getOpenPositions(): Position[] {
  return openPositions();
}

export function getRecentHistory(limit = 30): HistoryView[] {
  return recentTx(limit).map((t) => ({
    ...t,
    explorerTx: t.signature ? explorerTxUrl(t.signature) : undefined,
    explorerToken: t.mint ? explorerTokenUrl(t.mint) : undefined,
  }));
}

export function getFullHistory(): TxRecord[] {
  return loadHistory().transactions;
}

export async function getPublicWallet(): Promise<PublicWalletView> {
  const info = safeWalletInfo();
  let balanceSol: number | null = null;
  if (walletExists()) {
    try {
      balanceSol = await getBalanceSol();
    } catch {
      balanceSol = null;
    }
  }
  return {
    exists: info.exists,
    address: info.address,
    balanceSol,
    keypairPath: info.keypairPath,
    rpcHealthy: await rpcHealthy(),
  };
}

export async function buildSnapshot(): Promise<AppSnapshot> {
  const config = loadConfig();
  return {
    at: new Date().toISOString(),
    timezone: "America/Los_Angeles",
    bot: loadBotState(),
    config: {
      dryRun: config.dryRun,
      buyAmountSol: config.buyAmountSol,
      maxBuyAmountSol: config.maxBuyAmountSol,
      takeProfitPct: config.takeProfitPct,
      stopLossPct: config.stopLossPct,
      slippageBps: config.slippageBps,
      maxOpenPositions: config.maxOpenPositions,
      scanIntervalMs: config.scanIntervalMs,
      filters: config.filters,
      filtersText: describeFilters(config.filters),
    },
    wallet: await getPublicWallet(),
    positions: openPositions(),
    closedCount: loadPositions().positions.filter((p) => p.status === "closed").length,
    history: getRecentHistory(30),
  };
}
