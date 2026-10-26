import fs from "node:fs";
import path from "node:path";
import { ROOT } from "./config.js";

export interface BotRuntimeState {
  /** When true, scan + buy + TP/SL exits run. Primary ON/OFF control. */
  armed: boolean;
  /** Dashboard data auto-refresh (does not arm trading). */
  uiRefresh: boolean;
  uiRefreshMs: number;
  lastTickAt?: string;
  lastTickSummary?: string;
  lastError?: string;
  ticking: boolean;
}

const STATE_PATH = path.join(ROOT, "data", "bot-state.json");

const DEFAULTS: BotRuntimeState = {
  armed: false,
  uiRefresh: true,
  uiRefreshMs: 10_000,
  ticking: false,
};

function ensure(): void {
  const dir = path.join(ROOT, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadBotState(): BotRuntimeState {
  ensure();
  if (!fs.existsSync(STATE_PATH)) {
    saveBotState(DEFAULTS);
    return { ...DEFAULTS };
  }
  try {
    return { ...DEFAULTS, ...(JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) as BotRuntimeState) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveBotState(state: BotRuntimeState): void {
  ensure();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n", "utf8");
}

export function setArmed(armed: boolean): BotRuntimeState {
  const s = loadBotState();
  s.armed = armed;
  if (!armed) s.ticking = false;
  saveBotState(s);
  return s;
}

export function toggleArmed(): BotRuntimeState {
  return setArmed(!loadBotState().armed);
}

export function setUiRefresh(on: boolean): BotRuntimeState {
  const s = loadBotState();
  s.uiRefresh = on;
  saveBotState(s);
  return s;
}

export function toggleUiRefresh(): BotRuntimeState {
  return setUiRefresh(!loadBotState().uiRefresh);
}

export function markTick(summary: string, error?: string): void {
  const s = loadBotState();
  s.lastTickAt = new Date().toISOString();
  s.lastTickSummary = summary;
  s.lastError = error;
  s.ticking = false;
  saveBotState(s);
}

export function markTicking(on: boolean): void {
  const s = loadBotState();
  s.ticking = on;
  saveBotState(s);
}
