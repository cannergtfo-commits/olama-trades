/**
 * Background trading engine: only scans/buys/exits while bot.armed === true.
 * Dashboards toggle arm/disarm via state.ts; UI refresh is separate.
 * Cross-process lock prevents duplicate engines (web + tui + run) fighting.
 */
import fs from "node:fs";
import path from "node:path";
import { loadConfig, ROOT } from "./config.js";
import { loadBotState, markTick, markTicking } from "./bot-state.js";
import { monitorPositions, scanOnce, tryEnter } from "./strategy.js";
import { sortForTryEnter } from "./confluence.js";

const LOCK_PATH = path.join(ROOT, "data", "engine.lock");

let timer: NodeJS.Timeout | null = null;
let running = false;
let holdsLock = false;

function tryAcquireLock(): boolean {
  try {
    const dir = path.dirname(LOCK_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    // Stale lock: if pid is dead, take over
    if (fs.existsSync(LOCK_PATH)) {
      try {
        const prev = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as { pid?: number };
        if (prev.pid && prev.pid !== process.pid) {
          try {
            process.kill(prev.pid, 0);
            return false; // other live process holds lock
          } catch {
            /* dead pid — steal */
          }
        }
      } catch {
        /* corrupt — steal */
      }
    }
    fs.writeFileSync(
      LOCK_PATH,
      JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + "\n",
      "utf8"
    );
    holdsLock = true;
    return true;
  } catch {
    return false;
  }
}

function releaseLock(): void {
  if (!holdsLock) return;
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const prev = JSON.parse(fs.readFileSync(LOCK_PATH, "utf8")) as { pid?: number };
      if (prev.pid === process.pid) fs.unlinkSync(LOCK_PATH);
    }
  } catch {
    /* ignore */
  }
  holdsLock = false;
}

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
    // High-confluence first (scanOnce sorts by score)
    const passes = sortForTryEnter(
      rows.filter((r) => r.filterPass),
      loadConfig()
    );
    for (const r of passes.slice(0, 5)) {
      if (!loadBotState().armed) break;
      await tryEnter(r.token);
    }
    markTick(
      `armed tick: checked=${rows.length} pass=${passes.length} topConf=${passes[0]?.confluenceScore ?? "—"}`
    );
  } catch (e) {
    markTick("tick failed", (e as Error).message);
  } finally {
    running = false;
    markTicking(false);
  }
}

/** Start interval that respects armed flag each tick. Idempotent. Single-process lock. */
export function startEngine(): void {
  if (timer) return;
  if (!tryAcquireLock()) {
    // Another live process already owns the trading engine — UI-only mode
    // Do not clobber lastTickSummary owned by the engine process.
    console.log("[engine] lock held by another process — this process is UI-only");
    return;
  }
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
  releaseLock();
}

export function isEngineStarted(): boolean {
  return timer !== null;
}

export async function forceTick(): Promise<void> {
  // Manual tick always allowed from UI even if this process is UI-only
  await tickOnce();
}

process.on("exit", releaseLock);
process.on("SIGINT", releaseLock);
process.on("SIGTERM", releaseLock);
