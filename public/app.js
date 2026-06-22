// Frontend en JavaScript puro. Sin frameworks.
// Comunica con el backend mediante fetch. Polling de logs cada 1s.

const $ = (id) => document.getElementById(id);
const fields = [
  "binary", "model", "ctxSize", "batchSize", "ubatchSize", "tensorSplit",
  "device", "nGpuLayers", "cacheTypeK", "cacheTypeV", "flashAttn", "cacheReuse",
  "host", "port", "specType", "specDraftNMax", "temp", "topP", "topK",
  "noMmap", "jinja", "noMmproj", "metrics", "logPrefix",
];

function readConfig() {
  const c = {};
  for (const f of fields) {
    const el = $(`cfg-${f}`);
    if (!el) continue;
    if (el.type === "checkbox") c[f] = el.checked;
    else if (el.type === "number") c[f] = el.value === "" ? 0 : Number(el.value);
    else c[f] = el.value;
  }
  return c;
}
function writeConfig(c) {
  for (const f of fields) {
    const el = $(`cfg-${f}`);
    if (!el) continue;
    if (el.type === "checkbox") el.checked = !!c[f];
    else el.value = c[f] ?? "";
  }
  updateArgvPreview();
}

function buildArgv(c) {
  const a = [];
  if (c.model) a.push("-hf", c.model);
  a.push("--n-gpu-layers", String(c.nGpuLayers));
  a.push("--ctx-size", String(c.ctxSize));
  a.push("--batch-size", String(c.batchSize));
  a.push("--ubatch-size", String(c.ubatchSize));
  if (c.cacheTypeK) a.push("--cache-type-k", c.cacheTypeK);
  if (c.cacheTypeV) a.push("--cache-type-v", c.cacheTypeV);
  if (c.cacheReuse > 0) a.push("--cache-reuse", String(c.cacheReuse));
  if (c.flashAttn === "on") a.push("--flash-attn", "on");
  if (c.noMmap) a.push("--no-mmap");
  if (c.jinja) a.push("--jinja");
  if (c.noMmproj) a.push("--no-mmproj");
  if (c.specType) { a.push("--spec-type", c.specType); a.push("--spec-draft-n-max", String(c.specDraftNMax)); }
  if (c.metrics) a.push("--metrics");
  if (c.logPrefix) a.push("--log-prefix");
  if (c.device) a.push("--device", c.device);
  if (c.tensorSplit) a.push("--tensor-split", c.tensorSplit);
  a.push("--host", c.host || "127.0.0.1");
  a.push("--port", String(c.port));
  return a;
}

function updateArgvPreview() {
  const argv = buildArgv(readConfig());
  $("argv-preview").textContent = `${readConfig().binary} ${argv.join(" ")}`;
}

// ── Toast ──
let toastTimer;
function toast(msg, isErr = false) {
  let el = $("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.toggle("err", isErr);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}

// ── API helpers ──
async function api(path, opts) {
  const r = await fetch(path, opts);
  let data;
  try { data = await r.json(); } catch { data = null; }
  if (!r.ok) throw new Error(data?.error || `HTTP ${r.status}`);
  return data;
}

// ── Status ──
let lastStatus = null;
async function pollStatus() {
  try {
    const s = await api("/status");
    lastStatus = s;
    renderStatus(s);
    refreshButtons(s);
  } catch (e) {
    $("status-text").textContent = "error de backend";
    $("status-meta").textContent = e.message;
  }
}
function renderStatus(s) {
  const dot = $("status-dot");
  dot.className = "dot " + (s.status || "stopped");
  const labels = { stopped: "detenido", starting: "iniciando…", running: "corriendo", error: "error" };
  $("status-text").textContent = labels[s.status] || s.status;
  let meta = "";
  if (s.pid) meta += `pid ${s.pid} · `;
  if (s.url) meta += `${s.url} · `;
  if (s.error) meta += s.error;
  $("status-meta").textContent = meta;
}
function refreshButtons(s) {
  const running = s.status === "running" || s.status === "starting";
  $("btn-start").disabled = running;
  $("btn-stop").disabled = !running;
  // Benchmark requiere que no haya nada corriendo.
  $("btn-benchmark").disabled = running || benchRunning;
}

// ── Logs (polling cada 1s) ──
let logCursor = 0;
const logsEl = $("logs");
async function pollLogs() {
  try {
    const data = await api(`/logs?since=${logCursor}`);
    if (data.entries.length) {
      const frag = document.createDocumentFragment();
      for (const e of data.entries) {
        const div = document.createElement("div");
        div.className = `ln-${e.stream}`;
        const ts = document.createElement("span");
        ts.className = "ts";
        const d = new Date(Date.now() - 0); // e.t ya es relativo; mostramos solo segundos
        ts.textContent = `+${(e.t / 1000).toFixed(1)}s`;
        div.appendChild(ts);
        div.appendChild(document.createTextNode(e.msg));
        frag.appendChild(div);
      }
      logsEl.appendChild(frag);
      // Limitar DOM a últimas ~4000 líneas.
      while (logsEl.childNodes.length > 4000) logsEl.removeChild(logsEl.firstChild);
      if ($("autoscroll").checked) logsEl.scrollTop = logsEl.scrollHeight;
      logCursor = data.cursor;
    }
  } catch { /* backend reiniciándose */ }
}

// ── Start / Stop ──
$("btn-start").addEventListener("click", async () => {
  try {
    await api("/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(readConfig()),
    });
    toast("Servidor iniciando…");
  } catch (e) { toast(e.message, true); }
});
$("btn-stop").addEventListener("click", async () => {
  try {
    await api("/stop", { method: "POST" });
    toast("Servidor detenido.");
  } catch (e) { toast(e.message, true); }
});

// ── Restaurar default ──
$("btn-apply-default").addEventListener("click", async () => {
  try {
    const c = await api("/config");
    writeConfig(c);
    toast("Configuración por defecto cargada.");
  } catch (e) { toast(e.message, true); }
});

// Cada cambio actualiza preview.
for (const f of fields) {
  const el = $(`cfg-${f}`);
  if (el) ["input", "change"].forEach((ev) => el.addEventListener(ev, updateArgvPreview));
}

// ── Benchmark ──
let benchRunning = false;
$("btn-benchmark").addEventListener("click", async () => {
  if (benchRunning) return;
  benchRunning = true;
  $("btn-benchmark").disabled = true;
  $("bench-state").textContent = "iniciando servidor y midiendo… (puede tardar)";
  try {
    const data = await api("/benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ config: readConfig(), prompt: $("bench-prompt").value }),
    });
    if (data.ok && data.result) {
      renderLastResult(data.result);
      await loadHistory();
      const r = data.result;
      if (r.errors.length) toast(`Benchmark con errores: ${r.errors.join("; ")}`, true);
      else toast("Benchmark completado ✓");
    } else {
      toast(data.error || "Benchmark falló", true);
    }
  } catch (e) {
    toast(e.message, true);
  } finally {
    benchRunning = false;
    $("btn-benchmark").disabled = false;
    $("bench-state").textContent = "";
    pollStatus();
  }
});

// ── GPU ──
async function loadGpus() {
  try {
    const data = await api("/gpu");
    renderGpus(data.gpus);
  } catch { $("gpu-list").textContent = "—"; }
}
function renderGpus(gpus) {
  const el = $("gpu-list");
  if (!gpus || !gpus.length) { el.textContent = "—"; return; }
  el.innerHTML = "";
  for (const g of gpus) {
    const pct = g.gpuUtilPct ?? 0;
    const used = g.memUsedMiB != null ? Math.round(g.memUsedMiB) : null;
    const total = g.memTotalMiB != null ? Math.round(g.memTotalMiB) : null;
    const div = document.createElement("div");
    div.className = "gpu";
    div.innerHTML = `
      <div class="name">${g.index} <span class="muted">(${g.vendor})</span></div>
      <div>VRAM: ${used ?? "?"} / ${total ?? "?"} MiB</div>
      <div>Util: ${g.gpuUtilPct ?? "?"}%</div>
      <div class="bar"><span style="width:${Math.min(100, pct)}%"></span></div>`;
    el.appendChild(div);
  }
}
$("btn-gpu-refresh").addEventListener("click", loadGpus);

// ── Resultado actual ──
function metric(k, v, unit = "", cls = "") {
  const val = v == null ? "—" : (typeof v === "number" ? v.toFixed(2) : v);
  return `<div class="metric"><div class="k">${k}</div><div class="v ${cls}">${val}<small style="font-size:12px;color:var(--muted)"> ${unit}</small></div></div>`;
}
function renderLastResult(r) {
  $("last-result-card").hidden = false;
  const gpuLine = r.gpus.map((g) => `${g.index}: ${Math.round(g.memUsedMiB ?? 0)} MiB`).join(" · ") || "—";
  $("last-result").innerHTML =
    metric("Prompt T/s", r.promptTokensPerSecond, "tok/s", "green") +
    metric("Gen T/s", r.generationTokensPerSecond, "tok/s", "green") +
    metric("Draft acc", r.draftAcceptance, "", "amber") +
    metric("Load time", r.loadTimeSeconds, "s") +
    metric("Latencia req", r.requestLatencyMs, "ms") +
    `<div class="metric" style="grid-column: span 2"><div class="k">VRAM</div><div class="v" style="font-size:13px">${gpuLine}</div></div>`;
  if (r.errors.length) {
    $("last-result").innerHTML += `<div class="metric" style="grid-column:1/-1"><div class="k">Errores</div><div class="v" style="font-size:12px;color:var(--red)">${r.errors.join(" · ")}</div></div>`;
  }
}

// ── Historial ──
let history = [];
const selected = new Set();
async function loadHistory() {
  try {
    const data = await api("/history");
    history = data.results || [];
    renderHistory();
  } catch { /* ignore */ }
}
function fmt(n, d = 2) { return n == null ? "—" : Number(n).toFixed(d); }
function shortModel(m) {
  if (!m) return "—";
  const base = m.split(":")[0];
  return base.split("/").pop()?.slice(0, 22) || base;
}
function renderHistory() {
  const tbody = $("history-table").querySelector("tbody");
  tbody.innerHTML = "";
  // Mejores valores por columna (para resaltar).
  const best = {
    p: Math.max(...history.map((h) => h.promptTokensPerSecond ?? -Infinity), -Infinity),
    g: Math.max(...history.map((h) => h.generationTokensPerSecond ?? -Infinity), -Infinity),
    d: Math.max(...history.map((h) => h.draftAcceptance ?? -Infinity), -Infinity),
    l: Math.min(...history.map((h) => h.loadTimeSeconds ?? Infinity), Infinity),
  };
  for (const r of history) {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    if (selected.has(r.id)) tr.classList.add("selected");
    const gpuTxt = r.gpus.map((g) => `${g.index.replace(/^(nvidia|amdgpu-)/i, "")}:${Math.round(g.memUsedMiB ?? 0)}`).join(" ") || "—";
    const date = new Date(r.timestamp);
    const cells = [
      `<input type="checkbox" class="sel" ${selected.has(r.id) ? "checked" : ""}/>`,
      date.toLocaleString(),
      `<span title="${r.config.model}">${shortModel(r.config.model)}</span>`,
      r.config.ctxSize, `${r.config.batchSize}/${r.config.ubatchSize}`,
      `${r.config.cacheTypeK}/${r.config.cacheTypeV}`,
      r.config.device || "—", r.config.tensorSplit || "—",
      fmt(r.promptTokensPerSecond), fmt(r.generationTokensPerSecond),
      fmt(r.draftAcceptance, 3), fmt(r.loadTimeSeconds, 2),
      gpuTxt,
      `<button class="ghost tiny del">✕</button>`,
    ];
    tr.innerHTML = cells.map((c, i) => {
      const cls = i >= 8 && i <= 11 ? "num" : "";
      let extra = "";
      if (i === 8 && r.promptTokensPerSecond === best.p && best.p > -Infinity) extra = "best";
      if (i === 9 && r.generationTokensPerSecond === best.g && best.g > -Infinity) extra = "best";
      if (i === 10 && r.draftAcceptance === best.d && best.d > -Infinity) extra = "best";
      if (i === 11 && r.loadTimeSeconds === best.l && best.l < Infinity) extra = "best";
      return `<td class="${cls} ${extra}">${c}</td>`;
    }).join("");
    tbody.appendChild(tr);
  }
  // Eventos por fila.
  tbody.querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.id;
    tr.querySelector(".sel").addEventListener("change", (e) => {
      if (e.target.checked) selected.add(id); else selected.delete(id);
      tr.classList.toggle("selected", e.target.checked);
    });
    tr.querySelector(".del").addEventListener("click", async (e) => {
      e.stopPropagation();
      await api(`/history/${encodeURIComponent(id)}`, { method: "DELETE" });
      selected.delete(id);
      await loadHistory();
      toast("Resultado eliminado.");
    });
  });
}

$("btn-clear-history").addEventListener("click", async () => {
  if (!confirm("¿Borrar todo el historial de benchmarks?")) return;
  await api("/history", { method: "DELETE" });
  selected.clear();
  await loadHistory();
  toast("Historial limpiado.");
});

$("btn-clear-logs").addEventListener("click", async () => {
  await api("/logs/clear", { method: "POST" });
  logsEl.innerHTML = "";
  logCursor = 0;
});

// ── Comparación ──
$("btn-compare").addEventListener("click", () => {
  const items = history.filter((h) => selected.has(h.id));
  if (items.length < 2) { toast("Selecciona 2 o más resultados.", true); return; }
  renderCompare(items);
  $("compare-modal").hidden = false;
});
$("btn-compare-close").addEventListener("click", () => ($("compare-modal").hidden = true));

function renderCompare(items) {
  const cols = [
    ["Modelo", (r) => shortModel(r.config.model)],
    ["ctx", (r) => r.config.ctxSize],
    ["batch/ubatch", (r) => `${r.config.batchSize}/${r.config.ubatchSize}`],
    ["cache", (r) => `${r.config.cacheTypeK}/${r.config.cacheTypeV}`],
    ["device", (r) => r.config.device || "—"],
    ["tensor-split", (r) => r.config.tensorSplit || "—"],
    ["Prompt T/s", (r) => fmt(r.promptTokensPerSecond)],
    ["Gen T/s", (r) => fmt(r.generationTokensPerSecond)],
    ["Draft acc", (r) => fmt(r.draftAcceptance, 3)],
    ["Load (s)", (r) => fmt(r.loadTimeSeconds, 2)],
    ["Latencia (ms)", (r) => fmt(r.requestLatencyMs, 0)],
    ["VRAM (MiB)", (r) => r.gpus.map((g) => Math.round(g.memUsedMiB ?? 0)).join(" + ") || "—"],
  ];
  let html = '<div class="table-wrap"><table><thead><tr><th>Métrica</th>';
  for (const r of items) html += `<th>${new Date(r.timestamp).toLocaleString()}</th>`;
  html += "</tr></thead><tbody>";
  for (const [label, fn] of cols) {
    html += `<tr><td>${label}</td>`;
    for (const r of items) html += `<td class="num">${fn(r)}</td>`;
    html += "</tr>";
  }
  html += "</tbody></table></div>";
  $("compare-body").innerHTML = html;
}

// ── Bootstrap ──
async function init() {
  try {
    const c = await api("/config");
    writeConfig(c);
  } catch { updateArgvPreview(); }
  await pollStatus();
  await loadHistory();
  await loadGpus();

  // Polling.
  setInterval(pollStatus, 1500);
  setInterval(pollLogs, 1000);
  setInterval(loadGpus, 4000);
}
init();
