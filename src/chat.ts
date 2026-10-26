/**
 * Techno chat — persist threads, optional xAI Grok replies, else operator bridge queue.
 * Never logs API keys or wallet secrets (public address only in model context).
 */
import fs from "node:fs";
import path from "node:path";
import { ROOT, loadConfig } from "./config.js";
import { safeWalletInfo } from "./wallet.js";
import { loadBotState } from "./bot-state.js";

export type ChatRole = "user" | "assistant" | "system";
export type ChatStatus = "queued" | "replied" | "relay-pending" | "error";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  at: string;
  status: ChatStatus;
  source?: "xai" | "relay" | "local";
}

export interface ChatLog {
  messages: ChatMessage[];
}

const CHAT_PATH = path.join(ROOT, "data", "chat-log.json");
const OUTBOUND_PATH = path.join(ROOT, "data", "chat-outbound.json");
const MAX_MESSAGES = 200;
/** Documented current xAI chat model; override with XAI_MODEL. */
const DEFAULT_MODEL = "grok-4.7";

function ensureDataDir(): void {
  const dir = path.join(ROOT, "data");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function readLog(): ChatLog {
  ensureDataDir();
  if (!fs.existsSync(CHAT_PATH)) return { messages: [] };
  try {
    const raw = JSON.parse(fs.readFileSync(CHAT_PATH, "utf8")) as ChatLog;
    return { messages: Array.isArray(raw.messages) ? raw.messages : [] };
  } catch {
    return { messages: [] };
  }
}

function writeLog(log: ChatLog): void {
  ensureDataDir();
  const trimmed = { messages: log.messages.slice(-MAX_MESSAGES) };
  fs.writeFileSync(CHAT_PATH, JSON.stringify(trimmed, null, 2) + "\n", "utf8");
}

function uid(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Queue a user message for the operator bridge (no key / API failure). */
function writeOutbound(msg: ChatMessage): void {
  ensureDataDir();
  let outbound: ChatMessage[] = [];
  if (fs.existsSync(OUTBOUND_PATH)) {
    try {
      const raw = JSON.parse(fs.readFileSync(OUTBOUND_PATH, "utf8")) as {
        outbound?: ChatMessage[];
        pending?: ChatMessage[];
      };
      outbound = Array.isArray(raw.outbound)
        ? raw.outbound
        : Array.isArray(raw.pending)
          ? raw.pending
          : [];
    } catch {
      outbound = [];
    }
  }
  outbound.push(msg);
  fs.writeFileSync(
    OUTBOUND_PATH,
    JSON.stringify(
      { outbound: outbound.slice(-50), updatedAt: new Date().toISOString() },
      null,
      2
    ) + "\n",
    "utf8"
  );
}

function publicBotContext(): string {
  const cfg = loadConfig();
  const wallet = safeWalletInfo();
  const bot = loadBotState();
  const addr = wallet.exists ? wallet.address : "(no wallet yet)";
  return [
    `Bot public address: ${addr}`,
    `BOT armed: ${bot.armed ? "ON" : "OFF"}`,
    `DRY_RUN: ${cfg.dryRun}`,
    `TP/SL: +${cfg.takeProfitPct}% / -${cfg.stopLossPct}%`,
    `Buy size: ${cfg.buyAmountSol} SOL (cap ${cfg.maxBuyAmountSol})`,
    `maxTopHolderPercent: ${cfg.filters.maxTopHolderPercent}`,
    "Never request or repeat private keys / seed phrases / API keys.",
  ].join("\n");
}

async function callXai(userText: string, history: ChatMessage[]): Promise<string> {
  const cfg = loadConfig();
  const key = cfg.xaiApiKey;
  if (!key) throw new Error("no XAI_API_KEY");

  const model = process.env.XAI_MODEL?.trim() || DEFAULT_MODEL;
  const recent = history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-12)
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.text }));

  const body = {
    model,
    messages: [
      {
        role: "system",
        content:
          "You are Techno, the Solana terminal trading bot co-pilot (Grok). " +
          "Be concise and practical. Help with filters, scans, BOT ON/OFF, dry-run vs live, " +
          "wallet funding (public address only), and TP/SL. " +
          "Remind the user DRY_RUN=true is the safe default. " +
          "Never ask for or repeat private keys, seed phrases, or API keys.\n\n" +
          "Current bot context:\n" +
          publicBotContext(),
      },
      ...recent,
      { role: "user", content: userText },
    ],
    temperature: 0.7,
    max_tokens: 800,
  };

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    // Never echo Authorization headers; truncate body only
    throw new Error(`xAI HTTP ${res.status}${errText ? `: ${errText.slice(0, 160)}` : ""}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty xAI response");
  return text;
}

export function getChatMessages(limit = 80): ChatMessage[] {
  return readLog().messages.slice(-Math.max(1, limit));
}

export function chatHasXaiKey(): boolean {
  return !!loadConfig().xaiApiKey;
}

export interface SendChatResult {
  ok: boolean;
  user: ChatMessage;
  assistant?: ChatMessage;
  mode: "xai" | "queued";
  detail: string;
  hasXaiKey: boolean;
}

const NO_KEY_CTA =
  "No XAI_API_KEY yet — message saved and queued for Techno (data/chat-outbound.json). " +
  "For local Grok replies: run `npm run bot -- setup` (or add XAI_API_KEY=… to .env from https://console.x.ai/).";

/** Append user message; reply via xAI if keyed, else CTA + outbound queue. */
export async function sendChat(text: string): Promise<SendChatResult> {
  const cleaned = (text || "").trim().slice(0, 4000);
  if (!cleaned) throw new Error("message is empty");

  const log = readLog();
  const userMsg: ChatMessage = {
    id: uid(),
    role: "user",
    text: cleaned,
    at: new Date().toISOString(),
    status: "queued",
  };
  log.messages.push(userMsg);
  writeLog(log);

  if (chatHasXaiKey()) {
    try {
      const reply = await callXai(cleaned, log.messages.slice(0, -1));
      userMsg.status = "replied";
      const assistant: ChatMessage = {
        id: uid(),
        role: "assistant",
        text: reply,
        at: new Date().toISOString(),
        status: "replied",
        source: "xai",
      };
      log.messages[log.messages.length - 1] = userMsg;
      log.messages.push(assistant);
      writeLog(log);
      return {
        ok: true,
        user: userMsg,
        assistant,
        mode: "xai",
        detail: "Techno replied via xAI",
        hasXaiKey: true,
      };
    } catch (e) {
      userMsg.status = "relay-pending";
      writeOutbound(userMsg);
      log.messages[log.messages.length - 1] = userMsg;
      const assistant: ChatMessage = {
        id: uid(),
        role: "assistant",
        text:
          `xAI call failed (${(e as Error).message}). Message queued in data/chat-outbound.json for Techno. ` +
          "Check XAI_API_KEY / network, or wait for operator relay.",
        at: new Date().toISOString(),
        status: "error",
        source: "local",
      };
      log.messages.push(assistant);
      writeLog(log);
      return {
        ok: false,
        user: userMsg,
        assistant,
        mode: "queued",
        detail: "xAI error — queued for relay",
        hasXaiKey: true,
      };
    }
  }

  userMsg.status = "relay-pending";
  writeOutbound(userMsg);
  log.messages[log.messages.length - 1] = userMsg;
  const assistant: ChatMessage = {
    id: uid(),
    role: "assistant",
    text: NO_KEY_CTA,
    at: new Date().toISOString(),
    status: "relay-pending",
    source: "local",
  };
  log.messages.push(assistant);
  writeLog(log);
  return {
    ok: true,
    user: userMsg,
    assistant,
    mode: "queued",
    detail: "Queued — add XAI_API_KEY for Grok replies",
    hasXaiKey: false,
  };
}
