/**
 * Windowed browser dashboard — Express on 127.0.0.1:8787
 * Serves public/ + JSON/SSE APIs. Toggle arms the entire bot.
 */
import express from "express";
import path from "node:path";
import { spawn } from "node:child_process";
import chalk from "chalk";
import { ROOT } from "../config.js";
import {
  buildSnapshot,
  toggleBotArmed,
  armBot,
  disarmBot,
  getBotState,
} from "../state.js";
import { startEngine, stopEngine, forceTick, isEngineStarted } from "../engine.js";
import { loadLastScan, saveLastScan } from "./last-scan.js";
import { scanOnce } from "../strategy.js";
import { getChatMessages, sendChat, chatHasXaiKey } from "../chat.js";

export const WEB_HOST = "127.0.0.1";
export const WEB_PORT = 8787;

function tryOpenBrowser(url: string): void {
  const cmds: Array<[string, string[]]> = [
    ["xdg-open", [url]],
    ["gio", ["open", url]],
    ["chromium", ["--new-window", url]],
    ["google-chrome", ["--new-window", url]],
    ["firefox", ["--new-window", url]],
  ];
  for (const [bin, args] of cmds) {
    try {
      const child = spawn(bin, args, { stdio: "ignore", detached: true });
      child.on("error", () => {
        /* try next */
      });
      child.unref();
      return;
    } catch {
      /* try next */
    }
  }
}

export async function runWeb(opts: { open?: boolean; port?: number } = {}): Promise<void> {
  const openBrowser = opts.open !== false;
  const port = opts.port && opts.port > 0 ? opts.port : WEB_PORT;
  startEngine();

  const app = express();
  app.use(express.json());

  const publicDir = path.join(ROOT, "public");
  app.use(express.static(publicDir));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, engine: isEngineStarted(), bot: getBotState() });
  });

  app.get("/api/snapshot", async (_req, res) => {
    try {
      const snap = await buildSnapshot();
      res.json({ ...snap, lastScan: loadLastScan() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.get("/api/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    let closed = false;
    const push = async () => {
      if (closed) return;
      try {
        const snap = await buildSnapshot();
        const payload = JSON.stringify({ ...snap, lastScan: loadLastScan() });
        res.write(`event: snapshot\ndata: ${payload}\n\n`);
        const chatPayload = JSON.stringify({
          hasXaiKey: chatHasXaiKey(),
          messages: getChatMessages(80),
        });
        res.write(`event: chat\ndata: ${chatPayload}\n\n`);
      } catch (e) {
        res.write(`event: error\ndata: ${JSON.stringify({ error: (e as Error).message })}\n\n`);
      }
    };

    void push();
    const timer = setInterval(() => {
      void push();
    }, 10_000);

    req.on("close", () => {
      closed = true;
      clearInterval(timer);
    });
  });

  app.post("/api/bot/toggle", (_req, res) => {
    const s = toggleBotArmed();
    res.json({ ok: true, armed: s.armed, bot: s });
  });

  app.post("/api/bot", (req, res) => {
    const armed = (req.body as { armed?: unknown })?.armed;
    if (typeof armed !== "boolean") {
      res.status(400).json({ error: 'body must be { "armed": true|false }' });
      return;
    }
    const s = armed ? armBot() : disarmBot();
    res.json({ ok: true, armed: s.armed, bot: s });
  });

  app.post("/api/bot/arm", (_req, res) => {
    res.json({ ok: true, bot: armBot() });
  });

  app.post("/api/bot/disarm", (_req, res) => {
    res.json({ ok: true, bot: disarmBot() });
  });

  app.post("/api/tick", async (_req, res) => {
    try {
      await forceTick();
      res.json({ ok: true, bot: getBotState() });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });

  app.post("/api/scan", async (_req, res) => {
    try {
      const rows = await scanOnce();
      const cache = saveLastScan(rows);
      res.json({
        ok: true,
        pass: rows.filter((r) => r.filterPass).length,
        total: rows.length,
        lastScan: cache,
      });
    } catch (e) {
      res.status(500).json({ error: (e as Error).message });
    }
  });


  app.get("/api/chat", (req, res) => {
    const lim = Number(req.query.limit) || 80;
    const hasXaiKey = chatHasXaiKey();
    res.json({
      ok: true,
      hasXaiKey,
      xaiConfigured: hasXaiKey,
      messages: getChatMessages(lim),
    });
  });

  app.post("/api/chat", async (req, res) => {
    try {
      const body = (req.body || {}) as { text?: unknown; message?: unknown };
      const text = String(body.text ?? body.message ?? "");
      const result = await sendChat(text);
      res.json({
        ok: result.ok,
        mode: result.mode,
        detail: result.detail,
        hasXaiKey: result.hasXaiKey,
        xaiConfigured: result.hasXaiKey,
        user: result.user,
        assistant: result.assistant,
        messages: getChatMessages(80),
      });
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
    }
  });

  const url = `http://${WEB_HOST}:${port}`;

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(port, WEB_HOST, () => {
      console.log(chalk.magentaBright("\n╔══════════════════════════════════════════════╗"));
      console.log(chalk.magentaBright("║   SOLANA BOT — WEB DASHBOARD                 ║"));
      console.log(chalk.magentaBright("╚══════════════════════════════════════════════╝\n"));
      console.log(chalk.bold("  URL:"), chalk.cyan(url));
      console.log(chalk.dim("  Engine started — toggle BOT ON in the UI to trade."));
      console.log(chalk.dim("  Ctrl+C to stop.\n"));
      if (openBrowser) {
        console.log(chalk.dim("  Opening browser window…"));
        tryOpenBrowser(url);
      }
      resolve();
    });
    server.on("error", reject);
  });

  const shutdown = () => {
    stopEngine();
    console.log(chalk.green("\nWeb dashboard stopped. Armed state kept in data/bot-state.json."));
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  await new Promise<void>(() => {
    /* keep alive */
  });
}
