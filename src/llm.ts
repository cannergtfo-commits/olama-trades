/**
 * Shared LLM client for Olama Trades.
 * Primary: local Ollama (OpenAI-compatible /v1/chat/completions).
 * Optional fallback: xAI when CHAT_PROVIDER=auto|xai and XAI_API_KEY is set.
 * Never put secrets in prompts.
 */
import { loadConfig } from "./config.js";

export type ChatProvider = "ollama" | "xai" | "auto";
export type LlmBackend = "ollama" | "xai";

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionOptions {
  messages: ChatCompletionMessage[];
  temperature?: number;
  maxTokens?: number;
  /** Override model for this call (default from config). */
  model?: string;
  timeoutMs?: number;
  /** Prefer a specific backend for this call; still respects CHAT_PROVIDER. */
  prefer?: LlmBackend;
}

export interface ChatCompletionResult {
  text: string;
  backend: LlmBackend;
  model: string;
}

function normalizeOllamaV1Base(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed;
  return `${trimmed}/v1`;
}

function ollamaHostFromBase(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/v1")) return trimmed.slice(0, -3);
  return trimmed;
}

export function getChatProvider(): ChatProvider {
  const raw = (process.env.CHAT_PROVIDER || "ollama").trim().toLowerCase();
  if (raw === "xai" || raw === "auto" || raw === "ollama") return raw;
  return "ollama";
}

export function getOllamaBaseUrl(): string {
  return (
    process.env.OLLAMA_BASE_URL?.trim() ||
    process.env.OLLAMA_HOST?.trim() ||
    "http://127.0.0.1:11434"
  );
}

export function getOllamaModel(): string {
  return process.env.OLLAMA_MODEL?.trim() || "qwen2.5-coder:14b";
}

export function getXaiModel(defaultModel = "grok-4.7"): string {
  return process.env.XAI_MODEL?.trim() || defaultModel;
}

/** GET /api/tags — true when Ollama responds. */
export async function isOllamaReachable(timeoutMs = 3_000): Promise<boolean> {
  const host = ollamaHostFromBase(getOllamaBaseUrl());
  try {
    const res = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when the configured model appears in Ollama's tag list (best-effort). */
export async function ollamaHasModel(
  model = getOllamaModel(),
  timeoutMs = 3_000
): Promise<boolean> {
  const host = ollamaHostFromBase(getOllamaBaseUrl());
  try {
    const res = await fetch(`${host}/api/tags`, {
      method: "GET",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as {
      models?: Array<{ name?: string; model?: string }>;
    };
    const names = (data.models || []).map((m) => m.name || m.model || "");
    const want = model.trim();
    const wantBase = want.split(":")[0];
    return names.some((n) => n === want || n.startsWith(`${wantBase}:`) || n === wantBase);
  } catch {
    return false;
  }
}

export function missingOllamaModelHint(model = getOllamaModel()): string {
  return `Ollama is up but model "${model}" was not found. Run: ollama pull ${model}`;
}

export function ollamaOfflineHint(): string {
  const base = getOllamaBaseUrl();
  const model = getOllamaModel();
  return (
    `Ollama not reachable at ${base}. Start it (ollama serve), then: ollama pull ${model}. ` +
    `Or set OLLAMA_BASE_URL / OLLAMA_MODEL in .env.`
  );
}

async function callOllama(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const model = opts.model || getOllamaModel();
  const v1 = normalizeOllamaV1Base(getOllamaBaseUrl());
  const body = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 800,
    stream: false,
  };
  const res = await fetch(`${v1}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 120_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    const hint =
      res.status === 404
        ? ` — ${missingOllamaModelHint(model)}`
        : errText
          ? `: ${errText.slice(0, 160)}`
          : "";
    throw new Error(`Ollama HTTP ${res.status}${hint}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty Ollama response");
  return { text, backend: "ollama", model };
}

async function callXai(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const cfg = loadConfig();
  const key = cfg.xaiApiKey;
  if (!key) throw new Error("no XAI_API_KEY");
  const model = opts.model || getXaiModel();
  const body = {
    model,
    messages: opts.messages,
    temperature: opts.temperature ?? 0.7,
    max_tokens: opts.maxTokens ?? 800,
  };
  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`xAI HTTP ${res.status}${errText ? `: ${errText.slice(0, 160)}` : ""}`);
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("empty xAI response");
  return { text, backend: "xai", model };
}

/**
 * Resolve which backend to try, in order.
 * Default CHAT_PROVIDER=ollama → Ollama only.
 * auto → Ollama first if reachable, else xAI when keyed.
 * xai → xAI only (needs key).
 */
export async function resolveBackends(prefer?: LlmBackend): Promise<LlmBackend[]> {
  const provider = getChatProvider();
  const cfg = loadConfig();
  const hasXai = !!cfg.xaiApiKey;

  if (provider === "xai") {
    if (!hasXai) throw new Error("CHAT_PROVIDER=xai but XAI_API_KEY is not set");
    return ["xai"];
  }

  if (provider === "ollama") {
    return ["ollama"];
  }

  // auto
  const order: LlmBackend[] = [];
  if (prefer === "xai" && hasXai) {
    order.push("xai");
    order.push("ollama");
    return order;
  }
  const ollamaUp = await isOllamaReachable();
  if (ollamaUp) order.push("ollama");
  if (hasXai) order.push("xai");
  if (!order.length) order.push("ollama"); // try anyway for a clear error
  return order;
}

/** True when we expect a local/cloud model reply without operator relay. */
export async function llmReady(): Promise<boolean> {
  const provider = getChatProvider();
  const cfg = loadConfig();
  if (provider === "xai") return !!cfg.xaiApiKey;
  if (provider === "ollama") return isOllamaReachable();
  // auto
  if (await isOllamaReachable()) return true;
  return !!cfg.xaiApiKey;
}

/** Sync-ish hint for UI (does not probe network). Prefer llmReady() when async is OK. */
export function llmConfiguredHint(): {
  provider: ChatProvider;
  ollamaBase: string;
  ollamaModel: string;
  hasXaiKey: boolean;
} {
  return {
    provider: getChatProvider(),
    ollamaBase: getOllamaBaseUrl(),
    ollamaModel: getOllamaModel(),
    hasXaiKey: !!loadConfig().xaiApiKey,
  };
}

export async function chatCompletion(opts: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const backends = await resolveBackends(opts.prefer);
  let lastErr: Error | undefined;
  for (const backend of backends) {
    try {
      if (backend === "ollama") return await callOllama(opts);
      return await callXai(opts);
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw lastErr || new Error("no LLM backend available");
}
