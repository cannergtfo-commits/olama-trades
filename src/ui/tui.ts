/**
 * Terminal dashboard — chalk redraw every 10s, keybinds for bot arm/disarm + Techno chat.
 * Does not print wallet secrets.
 */
import chalk from "chalk";
import readline from "node:readline";
import {
  buildSnapshot,
  toggleBotArmed,
  type AppSnapshot,
} from "../state.js";
import { startEngine, stopEngine, forceTick, isEngineStarted } from "../engine.js";
import { loadLastScan, saveLastScan, type LastScanCache } from "./last-scan.js";
import { scanOnce } from "../strategy.js";
import {
  getChatMessages,
  sendChat,
  chatHasXaiKey,
  type ChatMessage,
} from "../chat.js";

const REFRESH_MS = 10_000;
const BANNER = `
╔══════════════════════════════════════════════════════════════════╗
║   ███████╗ ██████╗ ██╗      █████╗ ███╗   ██╗ █████╗            ║
║   ██╔════╝██╔═══██╗██║     ██╔══██╗████╗  ██║██╔══██╗           ║
║   ███████╗██║   ██║██║     ███████║██╔██╗ ██║███████║           ║
║   ╚════██║██║   ██║██║     ██╔══██║██║╚██╗██║██╔══██║           ║
║   ███████║╚██████╔╝███████╗██║  ██║██║ ╚████║██║  ██║           ║
║   ╚══════╝ ╚═════╝ ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝           ║
║          ◆ TERMINAL TRADING BOT  ·  DEX · PUMP · JUP ◆          ║
╚══════════════════════════════════════════════════════════════════╝
`.trim();

function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}

function shortMint(m?: string): string {
  if (!m) return "—";
  return m.length > 12 ? `${m.slice(0, 4)}…${m.slice(-4)}` : m;
}

function fmtTime(iso?: string): string {
  if (!iso) return "—";
  try {
    return (
      new Date(iso).toLocaleString("en-US", {
        timeZone: "America/Los_Angeles",
        hour12: true,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }) + " PT"
    );
  } catch {
    return iso;
  }
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

function panel(title: string, body: string, color: (s: string) => string = chalk.cyan): string {
  const width = 66;
  const line = "─".repeat(width);
  const rows = body.split("\n").map((row) => {
    const plain = stripAnsi(row);
    const pad = Math.max(0, width - 2 - plain.length);
    return `${color("│")} ${row}${" ".repeat(pad)} ${color("│")}`;
  });
  return [
    `${color(`┌${line}┐`)}`,
    `${color("│")} ${chalk.bold(title.padEnd(width - 2).slice(0, width - 2))} ${color("│")}`,
    `${color(`├${line}┤`)}`,
    ...rows,
    `${color(`└${line}┘`)}`,
  ].join("\n");
}

function statusBadge(armed: boolean, dryRun: boolean): string {
  const bot = armed ? chalk.bgGreen.black.bold(" BOT ON ") : chalk.bgRed.white.bold(" BOT OFF ");
  const mode = dryRun ? chalk.bgYellow.black(" DRY RUN ") : chalk.bgMagenta.white.bold(" LIVE ");
  return `${bot}  ${mode}`;
}

function wrapLine(s: string, max = 60): string[] {
  const out: string[] = [];
  let rest = s.replace(/\s+/g, " ").trim();
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut < 20) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out.length ? out : [""];
}

function renderChatPanel(
  messages: ChatMessage[],
  focused: boolean,
  draft: string,
  sending: boolean
): string {
  const hasKey = chatHasXaiKey();
  const title = focused
    ? "TECHNO CHAT  [FOCUSED — Enter send · Esc leave]"
    : "TECHNO CHAT  press [c] to focus";
  const mode = hasKey ? chalk.green("Grok ON") : chalk.yellow("no XAI_API_KEY → setup");
  const rows: string[] = [`mode ${stripAnsi(mode)}  ·  ${hasKey ? "live replies" : "queue + CTA"}`];

  const recent = messages.slice(-6);
  if (!recent.length) {
    rows.push(chalk.dim("say hi — Techno stays with you while the bot runs"));
  } else {
    for (const m of recent) {
      const who = m.role === "user" ? chalk.cyan("you") : chalk.magenta("techno");
      const prefix = `${who}> `;
      const lines = wrapLine(m.text, 56);
      rows.push(`${prefix}${lines[0]}`);
      for (const extra of lines.slice(1)) rows.push(`      ${extra}`);
    }
  }

  if (focused) {
    const cursor = sending ? chalk.dim("(sending…)") : chalk.white(draft || "") + chalk.dim("▌");
    rows.push(chalk.bold("› ") + cursor);
  } else {
    rows.push(chalk.dim("› (press c to type)"));
  }

  return panel(title, rows.join("\n"), chalk.magenta);
}

function render(
  snap: AppSnapshot,
  lastScan: LastScanCache | null,
  msg: string,
  scanning: boolean,
  chat: { messages: ChatMessage[]; focused: boolean; draft: string; sending: boolean }
): string {
  const { bot, wallet, config, positions, history, closedCount } = snap;
  const lines: string[] = [];

  lines.push(chalk.magentaBright(BANNER));
  lines.push("");
  lines.push(`  ${statusBadge(bot.armed, config.dryRun)}   refresh every ${REFRESH_MS / 1000}s`);
  lines.push(
    chalk.dim(
      `  snapshot ${fmtTime(snap.at)}  ·  engine ${isEngineStarted() ? "running" : "stopped"}  ·  ticking=${bot.ticking}`
    )
  );
  if (msg) lines.push(`  ${msg}`);
  lines.push("");

  const bal =
    wallet.balanceSol === null ? "(RPC n/a)" : `${wallet.balanceSol.toFixed(6)} SOL`;
  const walletBody = [
    `address  ${wallet.exists ? wallet.address : "(no wallet — run wallet create)"}`,
    `balance  ${bal}   rpc ${wallet.rpcHealthy ? "ok" : "down"}`,
    `TP/SL    +${config.takeProfitPct}% / -${config.stopLossPct}%   buy ${config.buyAmountSol} SOL (cap ${config.maxBuyAmountSol})`,
  ].join("\n");
  lines.push(panel("WALLET", walletBody, chalk.green));

  const botBody = [
    `armed    ${bot.armed ? "YES — trading loop active" : "NO  — idle (no buys/exits)"}`,
    `lastTick ${fmtTime(bot.lastTickAt)}`,
    `summary  ${(bot.lastTickSummary || "—").slice(0, 54)}`,
    `error    ${(bot.lastError || "—").slice(0, 54)}`,
  ].join("\n");
  lines.push(panel("BOT CONTROL", botBody, bot.armed ? chalk.green : chalk.red));

  let posBody: string;
  if (!positions.length) {
    posBody = "no open positions";
  } else {
    posBody = positions
      .slice(0, 6)
      .map(
        (p) =>
          `${p.symbol.padEnd(8)} ${shortMint(p.mint)}  entry $${p.entryPriceUsd.toPrecision(4)}  ${p.amountSolSpent} SOL${p.dryRun ? " dry" : ""}`
      )
      .join("\n");
  }
  lines.push(panel(`OPEN POSITIONS (${positions.length})  closed=${closedCount}`, posBody, chalk.blue));

  const filtLines = config.filtersText.split("\n").slice(0, 6).join("\n");
  lines.push(panel("FILTERS (buy blockers)", filtLines, chalk.yellow));

  let histBody: string;
  if (!history.length) {
    histBody = "no transactions yet — history in data/history.json";
  } else {
    histBody = history
      .slice(0, 8)
      .map((t) => {
        const when = fmtTime(t.timestamp).replace(" PT", "");
        const sym = (t.symbol || t.kind).padEnd(8);
        const sig = t.signature
          ? `solscan.io/tx/${t.signature.slice(0, 8)}…`
          : t.dryRun
            ? "dry-run"
            : "—";
        return `${when.slice(-11)} ${t.kind.padEnd(4)} ${sym} ${sig}`;
      })
      .join("\n");
  }
  lines.push(panel("TX HISTORY (Solscan)", histBody, chalk.cyan));

  let scanBody: string;
  if (scanning) {
    scanBody = "scanning markets…";
  } else if (!lastScan || !lastScan.rows.length) {
    scanBody = "press [s] to scan (or arm bot for engine ticks)";
  } else {
    const head = `cached ${fmtTime(lastScan.at)}`;
    const rows = lastScan.rows
      .slice(0, 6)
      .map((r) => {
        const tag = r.filterPass ? "PASS" : "BLOCK";
        return `${tag} ${r.symbol.padEnd(8)} spike=${r.volumeSpikeRatio.toFixed(1)}x liq=$${Math.round(r.liquidityUsd)} ${r.source}`;
      })
      .join("\n");
    scanBody = `${head}\n${rows}`;
  }
  lines.push(panel("LAST SCAN", scanBody, chalk.magenta));

  lines.push(renderChatPanel(chat.messages, chat.focused, chat.draft, chat.sending));

  lines.push("");
  lines.push(
    chalk.bold("  KEYBINDS  ") +
      chalk.white("[b]") +
      " bot ON/OFF   " +
      chalk.white("[c]") +
      " chat   " +
      chalk.white("[r]") +
      " refresh   " +
      chalk.white("[s]") +
      " scan   " +
      chalk.white("[t]") +
      " tick   " +
      chalk.white("[q]") +
      " quit"
  );
  lines.push(
    chalk.dim(
      "  Tip: chat needs XAI_API_KEY for Grok (`npm run bot -- setup`). Web: npm run bot -- web"
    )
  );
  lines.push("");

  return lines.join("\n");
}

export async function runTui(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error(chalk.red("Dashboard needs an interactive TTY. Use: npm run bot -- web"));
    process.exitCode = 1;
    return;
  }

  startEngine();
  let msg = chalk.yellow("Dashboard live — [b] arm bot · [c] chat with Techno");
  let scanning = false;
  let refreshing = false;
  let timer: NodeJS.Timeout | null = null;
  let alive = true;
  let chatFocused = false;
  let chatDraft = "";
  let chatSending = false;
  let chatMessages = getChatMessages(80);

  const paint = async () => {
    if (refreshing || !alive) return;
    refreshing = true;
    try {
      const snap = await buildSnapshot();
      const lastScan = loadLastScan();
      if (!chatSending) chatMessages = getChatMessages(80);
      clearScreen();
      process.stdout.write(
        render(snap, lastScan, msg, scanning, {
          messages: chatMessages,
          focused: chatFocused,
          draft: chatDraft,
          sending: chatSending,
        })
      );
    } catch (e) {
      msg = chalk.red(`refresh error: ${(e as Error).message}`);
    } finally {
      refreshing = false;
    }
  };

  const cleanup = () => {
    if (timer) clearInterval(timer);
    timer = null;
    try {
      process.stdin.setRawMode(false);
    } catch {
      /* ignore */
    }
    process.stdin.removeListener("keypress", onKey);
    stopEngine();
  };

  const onKey = (str: string, key: readline.Key) => {
    if (!alive) return;
    if (key.ctrl && key.name === "c") {
      alive = false;
      cleanup();
      process.exit(0);
      return;
    }

    // Chat focus mode
    if (chatFocused) {
      if (key.name === "escape") {
        chatFocused = false;
        msg = chalk.dim("chat unfocused");
        void paint();
        return;
      }
      if (key.name === "return") {
        if (chatSending || !chatDraft.trim()) return;
        const text = chatDraft.trim();
        chatDraft = "";
        chatSending = true;
        msg = chalk.dim("sending to Techno…");
        void (async () => {
          try {
            await paint();
            const result = await sendChat(text);
            chatMessages = getChatMessages(80);
            msg = result.hasXaiKey
              ? chalk.green(result.detail)
              : chalk.yellow(result.detail);
          } catch (e) {
            msg = chalk.red(`chat error: ${(e as Error).message}`);
          } finally {
            chatSending = false;
            await paint();
          }
        })();
        return;
      }
      if (key.name === "backspace") {
        chatDraft = chatDraft.slice(0, -1);
        void paint();
        return;
      }
      // Printable character (ignore control keys)
      if (str && str.length === 1 && !key.ctrl && !key.meta && str >= " ") {
        if (chatDraft.length < 500) chatDraft += str;
        void paint();
      }
      return;
    }

    const k = (key.name || "").toLowerCase();
    void (async () => {
      if (k === "q") {
        alive = false;
        cleanup();
        clearScreen();
        console.log(
          chalk.green("Dashboard closed. Armed state preserved in data/bot-state.json.")
        );
        process.exit(0);
      }
      if (k === "c") {
        chatFocused = true;
        msg = chalk.magenta("chat focused — type + Enter · Esc to leave");
        await paint();
        return;
      }
      if (k === "b") {
        const s = toggleBotArmed();
        msg = s.armed
          ? chalk.green("BOT ON — trading armed")
          : chalk.red("BOT OFF — trading disarmed");
        await paint();
        return;
      }
      if (k === "r") {
        msg = chalk.dim("forced refresh…");
        await paint();
        msg = chalk.green(`refreshed ${fmtTime(new Date().toISOString())}`);
        await paint();
        return;
      }
      if (k === "t") {
        msg = chalk.dim("force tick…");
        await paint();
        try {
          await forceTick();
          msg = chalk.green("tick complete");
        } catch (e) {
          msg = chalk.red(`tick error: ${(e as Error).message}`);
        }
        await paint();
        return;
      }
      if (k === "s") {
        if (scanning) return;
        scanning = true;
        msg = chalk.dim("scanning markets (no buys)…");
        await paint();
        try {
          const rows = await scanOnce();
          saveLastScan(rows);
          msg = chalk.green(
            `scan done — ${rows.filter((r) => r.filterPass).length}/${rows.length} pass`
          );
        } catch (e) {
          msg = chalk.red(`scan error: ${(e as Error).message}`);
        } finally {
          scanning = false;
        }
        await paint();
      }
    })();
  };

  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("keypress", onKey);

  process.on("SIGINT", () => {
    alive = false;
    cleanup();
    process.exit(0);
  });

  await paint();
  timer = setInterval(() => {
    void paint();
  }, REFRESH_MS);

  await new Promise<void>(() => {
    /* keep alive until quit */
  });
}
