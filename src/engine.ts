/**
 * Background trading engine: only scans/buys/exits while bot.armed === true.
 * Dashboards toggle arm/disarm via state.ts; UI refresh is separate.
 */
import { loadConfig } from "./config.js";
import { loadBotState, markTick, markTicking } from "./bot-state.js";
import { monitorPositions, scanOnce, tryEnter } from "./strategy.js";

let timer: NodeJS.Timeout | null = null;
let running = false;

async function tickOnce(): Promise<void> {
  const state = loadBotState();
  if (!state.armed) {
    markTick("disarmed — idle (no scan/buy/exit)");
    return;
  }
  if (running) return;
  running = true;
  markTicking(true);
  try {
    await monitorPositions();
    const rows = await scanOnce();
    const passes = rows.filter((r) => r.filterPass);
    for (const r of passes.slice(0, 5)) {
      if (!loadBotState().armed) break;
      await tryEnter(r.token);
    }
    markTick(`armed tick: checked=${rows.length} pass=${passes.length}`);
  } catch (e) {
    markTick("tick failed", (e as Error).message);
  } finally {
    running = false;
    markTicking(false);
  }
}

/** Start interval that respects armed flag each tick. Idempotent. */
export function startEngine(): void {
  if (timer) return;
  const cfg = loadConfig();
  const interval = Math.max(5_000, cfg.scanIntervalMs);
  void tickOnce();
  timer = setInterval(() => {
    void tickOnce();
  }, interval);
}

export function stopEngine(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  running = false;
  markTicking(false);
}

export function isEngineStarted(): boolean {
  return timer !== null;
}

export async function forceTick(): Promise<void> {
  await tickOnce();
}
