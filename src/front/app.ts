// Frontend en TypeScript (módulo ES). Sin frameworks.
// Comunica con el backend mediante fetch. Polling de logs cada 1s.
//
// La fuente de verdad de la configuración es un SCRIPT de shell crudo,
// editado en un CodeMirror con syntax highlighting bash. Se persiste en
// localStorage y se puede guardar/restablecer desde data/script-default.txt.
//
// Tipos compartidos importados de ../types.ts.

import { basicSetup, EditorView } from "https://esm.sh/codemirror@6.0.1";
import { oneDark } from "https://esm.sh/@codemirror/theme-one-dark@6.1.2";
import { StreamLanguage } from "https://esm.sh/@codemirror/language@6.11.2";
import { shell } from "https://esm.sh/@codemirror/legacy-modes@6.5.1/mode/shell";
import type {
  BenchmarkResult,
  GpuInfo,
  LogsResponse,
  ParsedScript,
  StatusResponse,
} from "../types.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T =>
  document.getElementById(id) as T;

// ── Clave de localStorage para el script ──
const STORAGE_SCRIPT_KEY = "llama-bench-script";
const STORAGE_PROMPT_KEY = "llama-bench-prompt";

// ── Placeholder del ejemplo (solo informativo, no se carga por defecto) ──
const EXAMPLE_SCRIPT = `/home/projects/ia/llama.cpp_vulkan/build-vulkan/bin/llama-server \\
  -hf unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-Q4_K_S \\
  --n-gpu-layers 999 \\
  --ctx-size 12000 \\
  --cache-type-k q4_0 \\
  --cache-type-v q4_0 \\
  --flash-attn on \\
  --jinja \\
  --no-mmproj \\
  --temp 0.6 \\
  --top-p 0.95 \\
  --top-k 20 \\
  --spec-type draft-mtp \\
  --spec-draft-n-max 2 \\
  --device Vulkan0,Vulkan1`;

// ── Editor CodeMirror ──
let editor: EditorView;

function initEditor(): void {
  const host = $("editor-host");
  // Texto vacío por defecto; el placeholder de ejemplo se muestra como pista
  // visual en el HTML (ya no se precarga).
  editor = new EditorView({
    doc: "",
    extensions: [
      basicSetup,
      StreamLanguage.define(shell),
      oneDark,
      EditorView.updateListener.of(() => {
        saveScriptToStorage();
      }),
    ],
    parent: host,
  });
  host.classList.add("editor-host");
}

// ── Lectura/escritura del editor ──
function getScript(): string {
  return editor.state.doc.toString();
}

function setScript(text: string): void {
  editor.dispatch({
    changes: { from: 0, to: editor.state.doc.length, insert: text },
  });
}

// ── Persistencia en localStorage ──
function saveScriptToStorage(): void {
  try {
    localStorage.setItem(STORAGE_SCRIPT_KEY, getScript());
  } catch {
    /* ignore quota */
  }
}

function loadScriptFromStorage(): string | null {
  try {
    const s = localStorage.getItem(STORAGE_SCRIPT_KEY);
    return s && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

// ── Carga inicial: localStorage > script-default > vacío ──
async function loadScript(): Promise<void> {
  const stored = loadScriptFromStorage();
  if (stored !== null) {
    setScript(stored);
    return;
  }
  // Intentar cargar el script-default del backend.
  try {
    const resp = await fetch("/script-default");
    if (resp.ok) {
      const text = await resp.text();
      if (text.length > 0) {
        setScript(text);
        saveScriptToStorage();
      }
    }
  } catch {
    /* 404 o sin backend → editor vacío */
  }
}

// ── Persistencia del prompt en localStorage ──
function getPromptEl(): HTMLTextAreaElement {
  return $("bench-prompt") as HTMLTextAreaElement;
}

function savePromptToStorage(): void {
  try {
    localStorage.setItem(STORAGE_PROMPT_KEY, getPromptEl().value);
  } catch {
    /* ignore quota */
  }
}

function loadPromptFromStorage(): string | null {
  try {
    const s = localStorage.getItem(STORAGE_PROMPT_KEY);
    return s && s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

// ── Carga inicial del prompt: localStorage > prompt-default > DEFAULT_PROMPT ──
const DEFAULT_PROMPT_UI = `Un agricultor tiene 17 ovejas. Todas menos 9 se escapan. ¿Cuántas ovejas le quedan? Explica tu razonamiento paso a paso.

Luego resuelve esto sin calculadora: ¿cuántos números primos hay entre 20 y 40? Lista cada uno y verifica brevemente por qué es primo.`;

async function loadPrompt(): Promise<void> {
  const stored = loadPromptFromStorage();
  if (stored !== null) {
    getPromptEl().value = stored;
    return;
  }
  // Intentar cargar el prompt-default del backend.
  try {
    const resp = await fetch("/prompt-default");
    if (resp.ok) {
      const text = await resp.text();
      if (text.length > 0) {
        getPromptEl().value = text;
        savePromptToStorage();
        return;
      }
    }
  } catch {
    /* 404 o sin backend */
  }
  // Último recurso: prompt por defecto hardcodeado.
  getPromptEl().value = DEFAULT_PROMPT_UI;
  savePromptToStorage();
}

// ── Autoguardado del prompt en localStorage ──
getPromptEl().addEventListener("input", () => savePromptToStorage());

// ── Toast ──
let toastTimer: ReturnType<typeof setTimeout> | undefined;
function toast(msg: string, isErr = false): void {
  let el = $("toast") as HTMLDivElement | null;
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
type ApiResult = Record<string, unknown> | null;

async function api<T extends ApiResult = ApiResult>(path: string, opts?: RequestInit): Promise<T> {
  const r = await fetch(path, opts);
  let data: T;
  try {
    data = (await r.json()) as T;
  } catch {
    data = null as T;
  }
  if (!r.ok) throw new Error(((data as { error?: string } | null)?.error) || `HTTP ${r.status}`);
  return data;
}

// ── Status ──
let lastStatus: StatusResponse | null = null;
async function pollStatus(): Promise<void> {
  try {
    const s = await api<StatusResponse & ApiResult>("/status");
    lastStatus = s;
    renderStatus(s);
    refreshButtons(s);
  } catch (e) {
    $("status-text").textContent = "error de backend";
    $("status-meta").textContent = (e as Error).message;
  }
}
function renderStatus(s: StatusResponse): void {
  const dot = $("status-dot");
  dot.className = "dot " + (s.status || "stopped");
  const labels: Record<string, string> = {
    stopped: "detenido",
    starting: "iniciando…",
    running: "corriendo",
    error: "error",
  };
  $("status-text").textContent = labels[s.status] || s.status;
  let meta = "";
  if (s.pid) meta += `pid ${s.pid} · `;
  if (s.url) meta += `${s.url} · `;
  if (s.error) meta += s.error;
  $("status-meta").textContent = meta;
}
function refreshButtons(s: StatusResponse): void {
  const running = s.status === "running" || s.status === "starting";
  ($("btn-start") as HTMLButtonElement).disabled = running;
  ($("btn-stop") as HTMLButtonElement).disabled = !running;
  ($("btn-benchmark") as HTMLButtonElement).disabled = running || benchRunning;
}

// ── Logs (polling cada 1s) ──
let logCursor = 0;
const logsEl = $("logs");
async function pollLogs(): Promise<void> {
  try {
    const data = await api<LogsResponse & ApiResult>(`/logs?since=${logCursor}`);
    if (data.entries.length) {
      const frag = document.createDocumentFragment();
      for (const e of data.entries) {
        const div = document.createElement("div");
        div.className = `ln-${e.stream}`;
        const ts = document.createElement("span");
        ts.className = "ts";
        ts.textContent = `+${(e.t / 1000).toFixed(1)}s`;
        div.appendChild(ts);
        div.appendChild(document.createTextNode(e.msg));
        frag.appendChild(div);
      }
      logsEl.appendChild(frag);
      while (logsEl.childNodes.length > 4000) {
        const first = logsEl.firstChild;
        if (first) logsEl.removeChild(first);
      }
      if (($("autoscroll") as HTMLInputElement).checked) logsEl.scrollTop = logsEl.scrollHeight;
      logCursor = data.cursor;
    }
  } catch {
    /* backend reiniciándose */
  }
}

// ── Start / Stop ──
$("btn-start").addEventListener("click", async () => {
  try {
    await api("/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: getScript() }),
    });
    toast("Servidor iniciando…");
  } catch (e) {
    toast((e as Error).message, true);
  }
});
$("btn-stop").addEventListener("click", async () => {
  try {
    await api("/stop", { method: "POST" });
    toast("Servidor detenido.");
  } catch (e) {
    toast((e as Error).message, true);
  }
});

// ── Guardar default / Restablecer default ──
$("btn-save-default").addEventListener("click", async () => {
  if (!confirm("¿Guardar el script actual como default en data/script-default.txt?")) return;
  try {
    await api("/script-default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ script: getScript() }),
    });
    toast("Default guardado ✓");
  } catch (e) {
    toast((e as Error).message, true);
  }
});

$("btn-restore-default").addEventListener("click", async () => {
  if (!confirm("¿Restablecer el script al default guardado? Se perderán los cambios no guardados.")) return;
  try {
    const resp = await fetch("/script-default");
    if (resp.ok) {
      const text = await resp.text();
      setScript(text);
      saveScriptToStorage();
      toast("Default restablecido ✓");
    } else {
      toast("No hay default guardado.", true);
    }
  } catch (e) {
    toast((e as Error).message, true);
  }
});

// ── Guardar default / Restablecer default (prompt) ──
$("btn-prompt-save-default").addEventListener("click", async () => {
  if (!confirm("¿Guardar el prompt actual como default en data/prompt-default.txt?")) return;
  try {
    await api("/prompt-default", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: getPromptEl().value }),
    });
    toast("Prompt default guardado ✓");
  } catch (e) {
    toast((e as Error).message, true);
  }
});

$("btn-prompt-restore-default").addEventListener("click", async () => {
  if (!confirm("¿Restablecer el prompt al default guardado? Se perderán los cambios no guardados.")) return;
  try {
    const resp = await fetch("/prompt-default");
    if (resp.ok) {
      const text = await resp.text();
      getPromptEl().value = text;
      savePromptToStorage();
      toast("Prompt default restablecido ✓");
    } else {
      toast("No hay prompt default guardado.", true);
    }
  } catch (e) {
    toast((e as Error).message, true);
  }
});

// ── Benchmark ──
let benchRunning = false;
$("btn-benchmark").addEventListener("click", async () => {
  if (benchRunning) return;
  benchRunning = true;
  ($("btn-benchmark") as HTMLButtonElement).disabled = true;
  $("bench-state").textContent = "iniciando servidor y midiendo… (puede tardar)";
  ($("response-card") as HTMLElement).hidden = true;
  try {
    const data = await api<{ ok: boolean; result?: BenchmarkResult; error?: string }>("/benchmark", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        script: getScript(),
        prompt: getPromptEl().value,
        max_tokens: parseInt(($("bench-max-tokens") as HTMLInputElement).value) || 8192,
      }),
    });
    if (data.ok && data.result) {
      renderLastResult(data.result);
      // Mostrar la respuesta del modelo.
      const respText = data.result.response || "—";
      ($("bench-response") as HTMLPreElement).textContent = respText;
      ($("response-card") as HTMLElement).hidden = false;
      await loadHistory();
      const r = data.result;
      if (r.errors.length) toast(`Benchmark con errores: ${r.errors.join("; ")}`, true);
      else toast("Benchmark completado ✓");
    } else {
      toast(data.error || "Benchmark falló", true);
    }
  } catch (e) {
    toast((e as Error).message, true);
  } finally {
    benchRunning = false;
    ($("btn-benchmark") as HTMLButtonElement).disabled = false;
    $("bench-state").textContent = "";
    pollStatus();
  }
});

// ── GPU ──
async function loadGpus(): Promise<void> {
  try {
    const data = await api<{ gpus: GpuInfo[] }>("/gpu");
    renderGpus(data.gpus);
  } catch {
    $("gpu-list").textContent = "—";
  }
}
function renderGpus(gpus: GpuInfo[] | null): void {
  const el = $("gpu-list");
  if (!gpus || !gpus.length) {
    el.textContent = "—";
    return;
  }
  el.innerHTML = "";
  for (const g of gpus) {
    const pct = g.gpuUtilPct ?? 0;
    const used = g.memUsedMiB != null ? Math.round(g.memUsedMiB) : null;
    const total = g.memTotalMiB != null ? Math.round(g.memTotalMiB) : null;
    const vramPct = used != null && total != null && total > 0 ? Math.round((used / total) * 100) : 0;
    function alertCls(p: number): string {
      return p > 90 ? "red" : p > 70 ? "yellow" : "green";
    }
    const div = document.createElement("div");
    div.className = "gpu";
    div.innerHTML = `
      <div class="name">${g.index} <span class="muted">(${g.vendor})</span></div>
      <div>VRAM: ${(used != null ? (used / 1024).toFixed(1) : "?")} / ${(total != null ? (total / 1024).toFixed(1) : "?")} GB</div>
      <div class="bar vram-bar ${alertCls(vramPct)}"><span style="width:${Math.min(100, vramPct)}%"></span></div>
      <div>Util: ${g.gpuUtilPct ?? "?"}%</div>
      <div class="bar util-bar ${alertCls(pct)}"><span style="width:${Math.min(100, pct)}%"></span></div>`;
    el.appendChild(div);
  }
}
$("btn-gpu-refresh").addEventListener("click", loadGpus);

// ── Resultado actual ──
function metric(k: string, v: number | string | null, unit = "", cls = "", sub = ""): string {
  const val = v == null ? "—" : typeof v === "number" ? v.toFixed(2) : v;
  const subHtml = sub ? `<div class="k-sub">${sub}</div>` : "";
  return `<div class="metric"><div class="k">${k}</div>${subHtml}<div class="v ${cls}">${val}<small style="font-size:12px;color:var(--muted)"> ${unit}</small></div></div>`;
}
function renderLastResult(r: BenchmarkResult): void {
  ($("last-result-card") as HTMLElement).hidden = false;
  const gpuLine = r.gpus.map((g) => `${g.index}: ${(g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : "?")} GB`).join(" · ") || "—";
  $("last-result").innerHTML =
    metric("Prompt T/s", r.promptTokensPerSecond, "tok/s", "green", "Reading (prompt processing)") +
    metric("Gen T/s", r.generationTokensPerSecond, "tok/s", "green", "Generation (token output)") +
    metric("Draft acc", r.draftAcceptance, "", "amber") +
    metric("Gen drafts", r.genDrafts, "", "") +
    metric("Acc drafts", r.accDrafts, "", "") +
    metric("Gen tokens", r.genTokens, "", "") +
    metric("Acc tokens", r.accTokens, "", "") +
    metric("Load time", r.loadTimeSeconds, "s") +
    metric("Latencia req", r.requestLatencyMs, "ms") +
    `<div class="metric" style="grid-column: span 2"><div class="k">VRAM</div><div class="v" style="font-size:13px">${gpuLine}</div></div>`;
  if (r.errors.length) {
    $("last-result").innerHTML += `<div class="metric" style="grid-column:1/-1"><div class="k">Errores</div><div class="v" style="font-size:12px;color:var(--red)">${r.errors.join(" · ")}</div></div>`;
  }
}

// ── Historial ──
let history: BenchmarkResult[] = [];

// ── Sort state ──
const STORAGE_SORT_KEY = "llama-bench-sort";
const savedSort: { col: string; dir: "asc" | "desc" } = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_SORT_KEY) as string);
  } catch {
    return null as unknown as { col: string; dir: "asc" | "desc" };
  }
})() || { col: "date", dir: "desc" };
let sortCol: string = savedSort.col;
let sortDir: "asc" | "desc" = savedSort.dir;

const sortFns: Record<string, (r: BenchmarkResult) => number> = {
  date: (r) => new Date(r.timestamp).getTime(),
  ctx: (r) => r.config.ctxSize ?? -Infinity,
  promptTps: (r) => r.promptTokensPerSecond ?? -Infinity,
  genTps: (r) => r.generationTokensPerSecond ?? -Infinity,
  draftAcc: (r) => r.draftAcceptance ?? -Infinity,
  loadTime: (r) => r.loadTimeSeconds ?? Infinity,
  totalVram: (r) => r.gpus.reduce((s, g) => s + (g.memUsedMiB ?? 0), 0),
};

function applySort(): void {
  const fn = sortFns[sortCol];
  if (!fn) return;
  history.sort((a, b) => {
    const x = fn(a),
      y = fn(b);
    return sortDir === "asc" ? (x > y ? 1 : x < y ? -1 : 0) : y > x ? 1 : y < x ? -1 : 0;
  });
}

function updateSortUI(): void {
  document.querySelectorAll<HTMLElement>("#history-table th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    th.classList.toggle("sort-active", th.dataset.sort === sortCol);
    if (th.dataset.sort === sortCol) th.classList.add("sort-" + sortDir);
  });
  localStorage.setItem(STORAGE_SORT_KEY, JSON.stringify({ col: sortCol, dir: sortDir }));
}

const selected = new Set<string>();
async function loadHistory(): Promise<void> {
  try {
    const data = await api<{ results: BenchmarkResult[] }>("/history");
    history = data.results || [];
    populateModelFilter();
    applySort();
    renderHistory();
    updateSortUI();
  } catch {
    /* ignore */
  }
}

/** Llena el <select> de filtro de modelo con los modelos base únicos del historial. */
function populateModelFilter(): void {
  const sel = $<HTMLSelectElement>("model-filter");
  if (!sel) return;
  const bases = new Set<string>();
  for (const r of history) {
    const b = modelBase(r.config?.model);
    if (b) bases.add(b);
  }
  const sorted = [...bases].sort((a, b) => a.localeCompare(b));
  // Preservar selección actual aunque ya no esté en la lista.
  const current = sel.value;
  sel.innerHTML =
    `<option value="">Todos</option>` +
    sorted.map((b) => `<option value="${escapeHtml(b)}">${escapeHtml(b)}</option>`).join("");
  if (sorted.includes(current)) sel.value = current;
  else {
    modelFilter = "";
    localStorage.setItem(STORAGE_MODEL_FILTER_KEY, "");
  }
}
function fmt(n: number | null | undefined, d = 2): string {
  return n == null ? "—" : Number(n).toFixed(d);
}
function shortModel(m: string | null | undefined): string {
  if (!m) return "—";
  const base = m.split(":")[0];
  return base.split("/").pop()?.slice(0, 22) || base;
}

/**
 * Normaliza un modelo a su base comparable (sin org/ ni sufijo de quant tras ':')
 * para agrupar/filtrar. p.ej. "unsloth/Qwen3.6-35B-A3B-UD-Q4_K_S" -> "Qwen3.6-35B-A3B".
 */
function modelBase(m: string | null | undefined): string | null {
  if (!m) return null;
  const noOrg = m.split(":")[0].split("/").pop() || m;
  return noOrg;
}

// ── Filtro por modelo (persistido) ──
const STORAGE_MODEL_FILTER_KEY = "llama-bench-model-filter";
let modelFilter: string = (() => {
  try {
    return localStorage.getItem(STORAGE_MODEL_FILTER_KEY) || "";
  } catch {
    return "";
  }
})();

// Patrones para partir el nombre del modelo en piezas (badges).
const SIZE_RE = /^(\d+B(?:-A\d+B)?|MoE|A\d+B)$/i;
// Quant: tokens tipo "Q4_K_S", "Q4_K_M", "Q8_0", "F16", "BF16", "UD-Q4_K_S", "IQL", etc.
const QUANT_RE = /^(UD-)?(I?Q\d[_A-Z0-9]*|IQ\d[_A-Z0-9]*|F16|F32|BF16|FP16|FP8|TQ\d[_A-Z0-9]*)$/i;

interface ParsedModel {
  base: string;
  size: string | null;
  quant: string | null;
  mtp: boolean;
}

/**
 * Parte un nombre de modelo en { base, size, quant, mtp }.
 *   "Qwen3.6-35B-A3B-UD-Q4_K_S" -> { base:"Qwen3.6", size:"35B-A3B", quant:"UD-Q4_K_S", mtp:false }
 *   "Modelo-7B-MTP"             -> { base:"Modelo", size:"7B", quant:null, mtp:true }
 */
function parseModel(m: string | null | undefined): ParsedModel | null {
  if (!m) return null;
  const full = modelBase(m) ?? m;
  const hasMtp = /MTP/i.test(full);
  // Sufijo de quant tras ':' (p.ej. "Qwen...:UD-Q4_K_S").
  let quant: string | null = null;
  let body = full;
  if (m.includes(":")) {
    quant = m.split(":").slice(1).join(":");
    body = m.split(":")[0].split("/").pop() || full;
  }
  const parts = body.split(/-/).filter(Boolean);
  let size: string | null = null;
  let sizeStart = -1;
  let sizeEnd = -1;
  // Localizar el token de tamaño (p.ej. "35B", agrupado con un posible "A3B" MoE).
  for (let i = 0; i < parts.length; i++) {
    if (SIZE_RE.test(parts[i])) {
      sizeStart = i;
      if (i + 1 < parts.length && /^A\d+B$/i.test(parts[i + 1])) {
        size = `${parts[i]}-${parts[i + 1]}`;
        sizeEnd = i + 1;
      } else {
        size = parts[i];
        sizeEnd = i;
      }
      break;
    }
  }
  // base = todo lo anterior al tamaño (o el primer token si no hay tamaño).
  const baseEnd = sizeStart >= 0 ? sizeStart : 1;
  const base = parts.slice(0, baseEnd).join("-") || body;
  // Quant por sufijo si no vino en ':'.
  if (!quant) {
    for (let i = sizeEnd + 1; i < parts.length; i++) {
      if (QUANT_RE.test(parts[i])) {
        quant = parts.slice(i).join("-");
        break;
      }
    }
  }
  return { base, size, quant, mtp: hasMtp };
}

/** Render HTML de la celda de modelo con badges. */
function renderModelCell(m: string | null | undefined): string {
  const p = parseModel(m);
  if (!p) return "—";
  let html = `<span class="model-cell" title="${m ?? ""}">`;
  html += `<span class="model-name">${escapeHtml(p.base)}</span>`;
  if (p.size) html += `<span class="badge badge-size">${escapeHtml(p.size)}</span>`;
  if (p.quant) html += `<span class="badge badge-quant">${escapeHtml(p.quant)}</span>`;
  if (p.mtp) html += `<span class="badge badge-mtp">MTP</span>`;
  html += "</span>";
  return html;
}

function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return map[c];
  });
}
function renderHistory(): void {
  const tbody = $("history-table").querySelector("tbody") as HTMLTableSectionElement;
  tbody.innerHTML = "";
  const best = {
    p: Math.max(...history.map((h) => h.promptTokensPerSecond ?? -Infinity), -Infinity),
    g: Math.max(...history.map((h) => h.generationTokensPerSecond ?? -Infinity), -Infinity),
    d: Math.max(...history.map((h) => h.draftAcceptance ?? -Infinity), -Infinity),
    l: Math.min(...history.map((h) => h.loadTimeSeconds ?? Infinity), Infinity),
  };
  for (const r of history) {
    // Filtro por modelo base.
    if (modelFilter && modelBase(r.config?.model) !== modelFilter) continue;

    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    if (selected.has(r.id)) tr.classList.add("selected");

    // Leer config escalares; backward-compat con ServerConfig vieja.
    const c: Partial<ParsedScript> = r.config ?? {};
    const gpuTxt =
      r.gpus
        .map((g) => {
          const vendor = (g.vendor || "gpu").replace(/^amdgpu/i, "AmdGPU");
          const val = g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : "?";
          return `${vendor}:${val}`;
        })
        .join(", ") || "—";
    const totalVram = r.gpus.reduce((sum, g) => sum + (g.memUsedMiB ?? 0), 0) / 1024;
    const totalVramStr = totalVram > 0 ? `${totalVram.toFixed(1)} GB` : "—";
    const date = new Date(r.timestamp);

    // Botón ↗ aplicar: solo disponible si el resultado tiene campo `script`.
    const hasScript = typeof c.script === "string" && c.script.length > 0;
    const applyBtn = hasScript
      ? `<button class="ghost tiny apply" title="Cargar script en editor">↗</button>`
      : "";

    // Índices: 0 sel, 1 fecha, 2 modelo, 3 ctx, 4 batch, 5 cache, 6 device,
    // 7 tsplit, 8 promptTps, 9 genTps, 10 draftAcc, 11 genDrafts, 12 accDrafts,
    // 13 genTokens, 14 accTokens, 15 loadTime, 16 vram, 17 totalVram, 18 apply, 19 del.
    const cells = [
      `<input type="checkbox" class="sel" ${selected.has(r.id) ? "checked" : ""}/>`,
      date.toLocaleString(),
      renderModelCell(c.model),
      fmt(c.ctxSize),
      `${fmt(c.batchSize)}/${fmt(c.ubatchSize)}`,
      `${c.cacheTypeK ?? "—"}/${c.cacheTypeV ?? "—"}`,
      c.device ?? "—",
      c.tensorSplit ?? "—",
      fmt(r.promptTokensPerSecond),
      fmt(r.generationTokensPerSecond),
      fmt(r.draftAcceptance, 3),
      fmt(r.genDrafts, 0),
      fmt(r.accDrafts, 0),
      fmt(r.genTokens, 0),
      fmt(r.accTokens, 0),
      fmt(r.loadTimeSeconds, 2),
      gpuTxt,
      totalVramStr,
      applyBtn,
      `<button class="ghost tiny del">✕</button>`,
    ];
    tr.innerHTML = cells
      .map((cell, i) => {
        // Columnas numéricas: promptTps(8)..loadTime(15).
        const cls = i >= 8 && i <= 15 ? "num" : "";
        let extra = "";
        if (i === 8 && r.promptTokensPerSecond === best.p && best.p > -Infinity) extra = "best";
        if (i === 9 && r.generationTokensPerSecond === best.g && best.g > -Infinity) extra = "best";
        if (i === 10 && r.draftAcceptance === best.d && best.d > -Infinity) extra = "best";
        if (i === 15 && r.loadTimeSeconds === best.l && best.l < Infinity) extra = "best";
        return `<td class="${cls} ${extra}">${cell}</td>`;
      })
      .join("");
    tbody.appendChild(tr);
  }
  tbody.querySelectorAll("tr").forEach((tr) => {
    const id = tr.dataset.id as string;
    tr.querySelector(".sel")!.addEventListener("change", (e) => {
      if ((e.target as HTMLInputElement).checked) selected.add(id);
      else selected.delete(id);
      tr.classList.toggle("selected", (e.target as HTMLInputElement).checked);
    });
    tr.querySelector(".del")!.addEventListener("click", async (e) => {
      e.stopPropagation();
      await api(`/history/${encodeURIComponent(id)}`, { method: "DELETE" });
      selected.delete(id);
      await loadHistory();
      toast("Resultado eliminado.");
    });
    const applyEl = tr.querySelector<HTMLButtonElement>(".apply");
    if (applyEl) {
      applyEl.addEventListener("click", (e) => {
        e.stopPropagation();
        const item = history.find((h) => h.id === id);
        if (item?.config?.script) {
          setScript(item.config.script);
          saveScriptToStorage();
          toast(`Script de ${shortModel(item.config.model)} cargado.`);
        }
      });
    }
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
  if (items.length < 2) {
    toast("Selecciona 2 o más resultados.", true);
    return;
  }
  renderCompare(items);
  ($("compare-modal") as HTMLElement).hidden = false;
});
$("btn-compare-close").addEventListener("click", () => (($("compare-modal") as HTMLElement).hidden = true));

function renderCompare(items: BenchmarkResult[]): void {
  const cols: [string, (r: BenchmarkResult) => string][] = [
    ["Modelo", (r) => shortModel(r.config?.model)],
    ["ctx", (r) => String(r.config?.ctxSize ?? "—")],
    ["batch/ubatch", (r) => `${r.config?.batchSize ?? "—"}/${r.config?.ubatchSize ?? "—"}`],
    ["cache", (r) => `${r.config?.cacheTypeK ?? "—"}/${r.config?.cacheTypeV ?? "—"}`],
    ["device", (r) => r.config?.device || "—"],
    ["tensor-split", (r) => r.config?.tensorSplit || "—"],
    ["Prompt T/s", (r) => fmt(r.promptTokensPerSecond)],
    ["Gen T/s", (r) => fmt(r.generationTokensPerSecond)],
    ["Draft acc", (r) => fmt(r.draftAcceptance, 3)],
    ["Gen drafts", (r) => fmt(r.genDrafts, 0)],
    ["Acc drafts", (r) => fmt(r.accDrafts, 0)],
    ["Gen tokens", (r) => fmt(r.genTokens, 0)],
    ["Acc tokens", (r) => fmt(r.accTokens, 0)],
    ["Load (s)", (r) => fmt(r.loadTimeSeconds, 2)],
    ["Latencia (ms)", (r) => fmt(r.requestLatencyMs, 0)],
    [
      "VRAM (GB)",
      (r) => r.gpus.map((g) => (g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : "?")).join(" + ") || "—",
    ],
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
async function init(): Promise<void> {
  // 1) Inicializar editor CodeMirror.
  initEditor();

  // 2) Cargar script: localStorage > script-default > vacío.
  await loadScript();

  // 3) Cargar prompt: localStorage > prompt-default > DEFAULT_PROMPT_UI.
  await loadPrompt();

  await pollStatus();
  await loadHistory();
  await loadGpus();

  // Sort header click handlers.
  document.querySelectorAll<HTMLElement>("#history-table th[data-sort]").forEach((th) => {
    th.addEventListener("click", () => {
      if (sortCol === th.dataset.sort) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
      } else {
        sortCol = th.dataset.sort as string;
        sortDir = "desc";
      }
      applySort();
      renderHistory();
      updateSortUI();
    });
  });

  // Filtro por modelo.
  const modelSel = $<HTMLSelectElement>("model-filter");
  if (modelSel) {
    modelSel.value = modelFilter;
    modelSel.addEventListener("change", () => {
      modelFilter = modelSel.value;
      localStorage.setItem(STORAGE_MODEL_FILTER_KEY, modelFilter);
      renderHistory();
    });
  }

  // Polling.
  setInterval(pollStatus, 1500);
  setInterval(pollLogs, 1000);
  setInterval(loadGpus, 4000);
}
init();
