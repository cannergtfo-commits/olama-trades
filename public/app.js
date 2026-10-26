const $ = (id) => document.getElementById(id);

function fmtTime(iso) {
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

function short(m, n = 4) {
  if (!m) return "—";
  return m.length > n * 2 + 1 ? `${m.slice(0, n)}…${m.slice(-n)}` : m;
}

function toast(msg, err = false) {
  const el = $("toast");
  el.hidden = false;
  el.textContent = msg;
  el.classList.toggle("err", !!err);
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.hidden = true;
  }, 4500);
}

function renderBadges(snap) {
  const armed = snap.bot?.armed;
  const dry = snap.config?.dryRun;
  $("badges").innerHTML = `
    <span class="badge ${armed ? "on" : "off"}">${armed ? "BOT ON" : "BOT OFF"}</span>
    <span class="badge ${dry ? "dry" : "live"}">${dry ? "DRY RUN" : "LIVE"}</span>
  `;
  $("btn-toggle").textContent = armed ? "Turn BOT OFF" : "Turn BOT ON";
}

function renderWallet(snap) {
  const w = snap.wallet || {};
  const c = snap.config || {};
  const bal = w.balanceSol == null ? "(RPC n/a)" : `${Number(w.balanceSol).toFixed(6)} SOL`;
  $("wallet").innerHTML = `
    <div class="kv">
      <div><span class="label">address</span><span class="addr">${w.exists ? w.address : "(no wallet)"}</span></div>
      <div><span class="label">balance</span><span>${bal}</span></div>
      <div><span class="label">rpc</span><span>${w.rpcHealthy ? "ok" : "down"}</span></div>
      <div><span class="label">TP / SL</span><span>+${c.takeProfitPct}% / -${c.stopLossPct}%</span></div>
      <div><span class="label">buy size</span><span>${c.buyAmountSol} SOL (cap ${c.maxBuyAmountSol})</span></div>
    </div>
  `;
}

function renderBot(snap) {
  const b = snap.bot || {};
  $("bot").innerHTML = `
    <div class="kv">
      <div><span class="label">armed</span><span>${b.armed ? "YES — trading active" : "NO — idle"}</span></div>
      <div><span class="label">ticking</span><span>${b.ticking ? "yes" : "no"}</span></div>
      <div><span class="label">last tick</span><span>${fmtTime(b.lastTickAt)}</span></div>
      <div><span class="label">summary</span><span>${b.lastTickSummary || "—"}</span></div>
      <div><span class="label">error</span><span>${b.lastError || "—"}</span></div>
    </div>
  `;
}

function renderPositions(snap) {
  const rows = snap.positions || [];
  if (!rows.length) {
    $("positions").innerHTML = `<p class="empty">No open positions · closed=${snap.closedCount ?? 0}</p>`;
    return;
  }
  $("positions").innerHTML = `
    <table>
      <thead><tr><th>Symbol</th><th>Mint</th><th>Entry USD</th><th>SOL</th><th>Opened</th><th>Mode</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (p) => `<tr>
            <td>${p.symbol}</td>
            <td><a href="https://solscan.io/token/${p.mint}" target="_blank" rel="noopener">${short(p.mint)}</a></td>
            <td>$${Number(p.entryPriceUsd).toPrecision(4)}</td>
            <td>${p.amountSolSpent}</td>
            <td>${fmtTime(p.openedAt)}</td>
            <td>${p.dryRun ? "dry" : "live"}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function renderFilters(snap) {
  $("filters").textContent = snap.config?.filtersText || "—";
}

function renderHistory(snap) {
  const rows = snap.history || [];
  if (!rows.length) {
    $("history").innerHTML = `<p class="empty">No transactions yet (data/history.json)</p>`;
    return;
  }
  $("history").innerHTML = `
    <table>
      <thead><tr><th>When</th><th>Kind</th><th>Symbol</th><th>SOL</th><th>PnL%</th><th>Explorer</th><th>Note</th></tr></thead>
      <tbody>
        ${rows
          .map((t) => {
            const link = t.explorerTx
              ? `<a href="${t.explorerTx}" target="_blank" rel="noopener">${short(t.signature, 6)}</a>`
              : t.dryRun
                ? "dry-run"
                : "—";
            return `<tr>
              <td>${fmtTime(t.timestamp)}</td>
              <td><span class="tag ${t.kind}">${t.kind}</span></td>
              <td>${t.symbol || "—"}</td>
              <td>${t.amountSol ?? "—"}</td>
              <td>${t.pnlPct != null ? Number(t.pnlPct).toFixed(2) : "—"}</td>
              <td>${link}</td>
              <td>${t.note || ""}</td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderScan(snap) {
  const ls = snap.lastScan;
  if (!ls || !ls.rows?.length) {
    $("scan").innerHTML = `<p class="empty">No scan cache yet — click Scan (markets only, no buys)</p>`;
    return;
  }
  $("scan").innerHTML = `
    <p class="meta" style="margin:0 0 8px">Cached ${fmtTime(ls.at)}</p>
    <table>
      <thead><tr><th></th><th>Symbol</th><th>Spike</th><th>Liq</th><th>Vol24h</th><th>Source</th><th>Mint</th></tr></thead>
      <tbody>
        ${ls.rows
          .slice(0, 25)
          .map(
            (r) => `<tr>
            <td><span class="tag ${r.filterPass ? "pass" : "block"}">${r.filterPass ? "PASS" : "BLOCK"}</span></td>
            <td>${r.symbol}</td>
            <td>${Number(r.volumeSpikeRatio).toFixed(2)}x</td>
            <td>$${Math.round(r.liquidityUsd)}</td>
            <td>$${Math.round(r.volume24hUsd)}</td>
            <td>${r.source}</td>
            <td><a href="https://solscan.io/token/${r.mint}" target="_blank" rel="noopener">${short(r.mint)}</a></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}

function render(snap) {
  renderBadges(snap);
  renderWallet(snap);
  renderBot(snap);
  renderPositions(snap);
  renderFilters(snap);
  renderHistory(snap);
  renderScan(snap);
  $("meta").textContent = `Snapshot ${fmtTime(snap.at)} · timezone ${snap.timezone || "America/Los_Angeles"} · auto-refresh 10s`;
}

async function fetchSnapshot() {
  const res = await fetch("/api/snapshot");
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  return res.json();
}

function connectSSE() {
  const es = new EventSource("/api/events");
  es.addEventListener("snapshot", (ev) => {
    try {
      render(JSON.parse(ev.data));
    } catch (e) {
      toast(String(e), true);
    }
  });
  es.addEventListener("chat", (ev) => {
    try {
      renderChat(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  });
  es.addEventListener("error", () => {
    /* browser will retry; fall back poll */
  });
  es.onerror = () => {
    /* keep poll as backup */
  };
  return es;
}

async function post(path) {
  const res = await fetch(path, { method: "POST" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

$("btn-toggle").addEventListener("click", async () => {
  try {
    $("btn-toggle").disabled = true;
    const data = await post("/api/bot/toggle");
    toast(data.armed ? "BOT ON — trading armed" : "BOT OFF — trading disarmed");
    render(await fetchSnapshot());
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("btn-toggle").disabled = false;
  }
});

$("btn-refresh").addEventListener("click", async () => {
  try {
    render(await fetchSnapshot());
    toast("Refreshed");
  } catch (e) {
    toast(e.message, true);
  }
});

$("btn-scan").addEventListener("click", async () => {
  try {
    $("btn-scan").disabled = true;
    toast("Scanning markets…");
    const data = await post("/api/scan");
    toast(`Scan done — ${data.pass}/${data.total} pass`);
    render(await fetchSnapshot());
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("btn-scan").disabled = false;
  }
});

$("btn-tick").addEventListener("click", async () => {
  try {
    $("btn-tick").disabled = true;
    await post("/api/tick");
    toast("Force tick complete");
    render(await fetchSnapshot());
  } catch (e) {
    toast(e.message, true);
  } finally {
    $("btn-tick").disabled = false;
  }
});

connectSSE();
fetchSnapshot()
  .then(render)
  .catch((e) => toast(e.message, true));

// Backup poll if SSE stalls
setInterval(() => {
  fetchSnapshot().then(render).catch(() => {});
}, 10_000);

/* —— Techno chat —— */
function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderChat(payload) {
  const log = $("chat-log");
  const status = $("chat-status");
  const hint = $("chat-hint");
  if (!log) return;

  const hasKey = !!(payload.hasXaiKey || payload.xaiConfigured);
  if (status) {
    status.textContent = hasKey
      ? "Grok replies ON (XAI_API_KEY)"
      : "No XAI_API_KEY — messages queued for Techno";
    status.className = "chat-status " + (hasKey ? "ok" : "warn");
  }
  if (hint) {
    hint.innerHTML = hasKey
      ? "Talk while the dashboard runs. Secrets stay out of chat context."
      : 'Add a key: <code>npm run bot -- setup</code> or set <code>XAI_API_KEY</code> in <code>.env</code> (<a href="https://console.x.ai/" target="_blank" rel="noopener">console.x.ai</a>). Queues to <code>data/chat-outbound.json</code>.';
  }

  const msgs = payload.messages || [];
  if (!msgs.length) {
    log.innerHTML = `<p class="chat-empty">Say hi — Techno stays with you while the bot runs.</p>`;
    return;
  }
  log.innerHTML = msgs
    .map((m) => {
      const role = m.role === "user" ? "user" : "assistant";
      const who = role === "user" ? "you" : "techno";
      const st =
        m.status === "relay-pending"
          ? ` <span class="status">queued</span>`
          : m.status === "error"
            ? ` <span class="status">error</span>`
            : "";
      return `<div class="chat-bubble ${role}"><span class="who">${who}${st}</span>${escapeHtml(m.text)}</div>`;
    })
    .join("");
  log.scrollTop = log.scrollHeight;
}

async function refreshChat() {
  try {
    const res = await fetch("/api/chat");
    if (!res.ok) return;
    renderChat(await res.json());
  } catch {
    /* ignore */
  }
}

const chatForm = $("chat-form");
if (chatForm) {
  chatForm.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const input = $("chat-input");
    const btn = $("chat-send");
    const text = (input.value || "").trim();
    if (!text) return;
    try {
      btn.disabled = true;
      input.disabled = true;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, text }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      input.value = "";
      renderChat(data);
      toast(data.detail || (data.mode === "xai" ? "Techno replied" : "Queued for Techno"));
    } catch (e) {
      toast(e.message, true);
    } finally {
      btn.disabled = false;
      input.disabled = false;
      input.focus();
    }
  });
}

refreshChat();
setInterval(refreshChat, 8_000);
