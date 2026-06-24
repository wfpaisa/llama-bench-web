// Backend ligero en Bun + TypeScript.
// Gestiona un proceso llama-server, expone logs, ejecuta benchmarks reales
// contra la API de llama-server y consulta /metrics + stats de GPU.
//
// Sin dependencias externas: solo la stdlib de Bun (Bun.serve, subprocess).

import { spawn, type Subprocess } from "bun";
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ParsedScript,
  ServerStatus,
  StatusResponse,
  LogEntry,
  LogsResponse,
  BenchmarkResult,
  GpuInfo,
} from "./types.ts";

// ─── Configuración del entorno ────────────────────────────────────────────────
// Puerto del backend web. NO usar 8080: es el default de llama-server y
// chocaría/confundiría con él.
const PORT = Number(process.env.PORT ?? 8765);
const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), "data");
const HISTORY_FILE = join(DATA_DIR, "history.json");
// Script por defecto guardado desde la UI (botón "Guardar default").
// Vive fuera de git (.gitignore ignora data/*). Solo existe tras el primer guardado.
const SCRIPT_FILE = join(DATA_DIR, "script-default.txt");

// ─── Estado global del backend ────────────────────────────────────────────────
interface ManagedServer {
  proc: Subprocess<"ignore", "pipe", "pipe">;
  pid: number;
  startedAt: string;
  parsed: ParsedScript;
  // Resuelve cuando el proceso emite "server is listening" o al morir.
  ready: Promise<void>;
  readyResolve?: () => void;
  readyReject?: (e: Error) => void;
  done: boolean;
}

let managed: ManagedServer | null = null;
let status: ServerStatus = "stopped";
let statusError: string | null = null;

// Buffer circular de logs (mantenemos los últimos N en memoria).
const LOG_CAP = 5000;
const logBuffer: LogEntry[] = [];
const bootTime = Date.now();

function pushLog(stream: LogEntry["stream"], msg: string) {
  // Sin retener saltos de línea redundantes.
  const line = msg.replace(/\r?\n$/, "");
  if (!line) return;
  logBuffer.push({ t: Date.now() - bootTime, stream, msg: line });
  if (logBuffer.length > LOG_CAP)
    logBuffer.splice(0, logBuffer.length - LOG_CAP);
}
function systemLog(msg: string) {
  pushLog("system", `[backend] ${msg}`);
}

// ─── Utilidades ───────────────────────────────────────────────────────────────
function urlFor(c: { host: string; port: number }): string {
  const host = c.host || "127.0.0.1";
  return `http://${host}:${c.port}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── PARSEO DE SCRIPT ─────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════
// ESTA SECCIÓN ES LA QUE CONVIERTE EL SCRIPT CRUDO (editado en la UI) EN:
//   1. Tokens ejecutables (`binary` + `argv`) para Bun.spawn.
//   2. Escalares para display de historial y para armar el request del benchmark.
//
// El script es "binario + flags" estilo:
//   /path/llama-server \
//     -hf modelo \
//     --ctx-size 12000 \
//     --device Vulkan0,Vulkan1
//
// NO soporta pipes/redirecciones/variables de entorno de shell: son pasadas
// literalmente como argumentos. Es intencional (seguridad + fiabilidad del
// kill de grupo de proceso). Si el flag no está -> el escalar es null.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tokeniza un script de shell simple en argumentos.
 * - Colapsa continuaciones de línea (`\` al final de línea).
 * - Respeta comillas simples y dobles (sin expansión de variables).
 * - Ignora comentarios `#` que empiecen una línea (no tras argumentos).
 * Lanza Error si hay comillas sin cerrar.
 */
function tokenizeScript(script: string): string[] {
  // 1) Quitar comentarios de línea completa (línea cuyo primer no-espacio es #).
  const lines = script.split(/\r?\n/).filter((l) => {
    const t = l.trimStart();
    return !(t.startsWith("#"));
  });
  // 2) Unir continuaciones: una línea que termina en '\' se concatena con la
  //    siguiente reemplazando `\` + newline por un espacio.
  const joined = lines.join("\n").replace(/\\\n/g, " ");
  // 3) Tokenizar respetando comillas.
  const tokens: string[] = [];
  let i = 0;
  const n = joined.length;
  while (i < n) {
    // Saltar espacios.
    while (i < n && /\s/.test(joined[i])) i++;
    if (i >= n) break;
    let tok = "";
    while (i < n && !/\s/.test(joined[i])) {
      const ch = joined[i];
      if (ch === '"' || ch === "'") {
        // Leer hasta la comilla de cierre.
        const quote = ch;
        i++;
        const start = i;
        while (i < n && joined[i] !== quote) i++;
        if (i >= n) throw new Error(`Comilla ${quote} sin cerrar en el script.`);
        tok += joined.slice(start, i);
        i++; // consumir comilla de cierre
      } else {
        tok += ch;
        i++;
      }
    }
    if (tok !== "") tokens.push(tok);
  }
  return tokens;
}

/** Busca el valor de un flag de la forma `--flag valor` o `-x valor`. */
function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1];
  }
  return null;
}

/** Convierte a número o null si no es válido. */
function toNumOrNull(s: string | null): number | null {
  if (s === null) return null;
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

/**
 * Convierte el script crudo en ParsedScript.
 * Lanza Error si el binario está vacío (no hay nada que ejecutar).
 */
function parseScript(script: string): ParsedScript {
  const tokens = tokenizeScript(script);
  if (tokens.length === 0 || !tokens[0]) {
    throw new Error("El script está vacío: falta el binario de llama-server.");
  }
  const binary = tokens[0];
  const argv = tokens.slice(1);

  return {
    script,
    binary,
    argv,
    model: flagValue(argv, "-hf"),
    host: flagValue(argv, "--host") ?? "127.0.0.1",
    port: toNumOrNull(flagValue(argv, "--port")) ?? 8080,
    ctxSize: toNumOrNull(flagValue(argv, "--ctx-size")),
    batchSize: toNumOrNull(flagValue(argv, "--batch-size")),
    ubatchSize: toNumOrNull(flagValue(argv, "--ubatch-size")),
    cacheTypeK: flagValue(argv, "--cache-type-k"),
    cacheTypeV: flagValue(argv, "--cache-type-v"),
    device: flagValue(argv, "--device"),
    tensorSplit: flagValue(argv, "--tensor-split"),
    temp: toNumOrNull(flagValue(argv, "--temp")),
    topP: toNumOrNull(flagValue(argv, "--top-p")),
    topK: toNumOrNull(flagValue(argv, "--top-k")),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// ─── FIN PARSEO DE SCRIPT ─────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Gestión del proceso llama-server ─────────────────────────────────────────
async function startServer(parsed: ParsedScript): Promise<number> {
  if (managed)
    throw new Error("Ya hay un servidor corriendo. Detenlo primero.");

  const { binary, argv } = parsed;

  // Resolver el directorio del binario para:
  //   1. Ponerlo como cwd (refleja lo que el usuario hace en la terminal).
  //   2. Añadirlo a LD_LIBRARY_PATH para que encuentre .so relativas
  //      (p.ej. libllama-server-impl.so).
  const binAbs = resolve(binary);
  const binDir = dirname(binAbs);
  const env = { ...process.env } as Record<string, string>;
  const existing = env["LD_LIBRARY_PATH"] || "";
  env["LD_LIBRARY_PATH"] = existing ? `${binDir}:${existing}` : binDir;

  systemLog(`spawn: ${binary} ${argv.join(" ")}  (cwd=${binDir})`);

  let resolveReady: (() => void) | undefined;
  let rejectReady: ((e: Error) => void) | undefined;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const proc = spawn({
    cmd: [binary, ...argv],
    stdout: "pipe",
    stderr: "pipe",
    cwd: binDir,
    env,
    // Nuevo grupo de proceso (setsid): matamos a todo el árbol con kill(-pid).
    detached: true,
  });

  const pid = proc.pid!;
  managed = {
    proc,
    pid,
    startedAt: new Date().toISOString(),
    parsed,
    ready,
    readyResolve: resolveReady,
    readyReject: rejectReady,
    done: false,
  };

  status = "starting";
  statusError = null;

  // Consumir stdout/stderr en background.
  streamPipes(proc);

  // Race: o se vuelve ready o el proceso muere antes.
  void ready.then(
    () => {
      status = "running";
      systemLog("llama-server listo (server is listening).");
    },
    (e) => {
      if (status !== "error") status = "error";
      statusError = e.message;
    },
  );

  // Esperar el exit del proceso.
  void proc.exited.then((code) => {
    systemLog(`llama-server terminó (exit=${code}).`);
    const wasStarting = status === "starting";
    managed = null;
    if (status !== "error") status = "stopped";
    if (wasStarting && rejectReady) {
      rejectReady(
        new Error(`El proceso terminó antes de estar listo (exit=${code}).`),
      );
    }
  });

  // Timeout de arranque: 5 min para modelos grandes con offload.
  setTimeout(
    () => {
      if (managed && status === "starting") {
        // No lo matamos: modelos grandes tardan. Solo lo dejamos intentar.
        systemLog("Aviso: el servidor sigue en 'starting' tras 5 min.");
      }
    },
    5 * 60 * 1000,
  );

  return pid;
}

async function streamPipes(proc: Subprocess<"ignore", "pipe", "pipe">) {
  const readers: Promise<void>[] = [];
  if (proc.stdout) readers.push(drainStream(proc.stdout.getReader(), "stdout"));
  if (proc.stderr) readers.push(drainStream(proc.stderr.getReader(), "stderr"));
  await Promise.all(readers);
}

async function drainStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stream: LogEntry["stream"],
) {
  const decoder = new TextDecoder();
  let buf = "";
  const READY =
    /server is listening|llama server is listening|HTTP server listening|all slots are ready/i;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        pushLog(stream, line);
        if (READY.test(line) && managed?.readyResolve) {
          managed.readyResolve();
          managed.readyResolve = undefined;
          managed.readyReject = undefined;
        }
      }
    }
    if (buf) pushLog(stream, buf);
  } catch (e) {
    pushLog(
      "system",
      `[backend] error leyendo ${stream}: ${(e as Error).message}`,
    );
  }
}

async function stopServer(): Promise<void> {
  if (!managed) {
    status = "stopped";
    return;
  }
  const m = managed;
  systemLog(`deteniendo llama-server (pid=${m.pid})…`);
  try {
    // SIGTERM a todo el grupo de proceso.
    process.kill(-m.pid, "SIGTERM");
  } catch {
    try {
      m.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  // Esperar salida ordenada; si no muere en 8s, SIGKILL.
  const exitTimeout = setTimeout(() => {
    try {
      process.kill(-m.pid, "SIGKILL");
    } catch {
      try {
        m.proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 8000);
  try {
    await m.proc.exited;
  } finally {
    clearTimeout(exitTimeout);
  }
  managed = null;
  status = "stopped";
}

// ─── Métricas de GPU (NVIDIA + AMD) ────────────────────────────────────────────
async function readNvidiaGpus(): Promise<GpuInfo[]> {
  let out = "";
  try {
    const p = spawn({
      cmd: [
        "nvidia-smi",
        "--query-gpu=index,utilization.gpu,memory.used,memory.total",
        "--format=csv,noheader,nounits",
      ],
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout] = await Promise.all([new Response(p.stdout).text()]);
    out = stdout;
    await p.exited;
  } catch {
    return [];
  }
  const gpus: GpuInfo[] = [];
  for (const raw of out.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",").map((s) => s.trim());
    if (parts.length < 4) continue;
    gpus.push({
      index: `nvidia${parts[0]}`,
      vendor: "nvidia",
      gpuUtilPct: numOrNull(parts[1]),
      memUsedMiB: numOrNull(parts[2]),
      memTotalMiB: numOrNull(parts[3]),
    });
  }
  return gpus;
}

/** Lee VRAM/util de GPUs AMD vía sysfs (sin depender de radeontop). */
async function readAmdGpus(): Promise<GpuInfo[]> {
  const gpus: GpuInfo[] = [];
  const base = "/sys/class/drm";
  let cards: string[];
  try {
    cards = await readdir(base);
  } catch {
    return [];
  }
  for (const c of cards) {
    if (!c.startsWith("card") || c.includes("-")) continue; // card0, no card0-DP-1
    const idx = Number(c.replace("card", ""));
    if (Number.isNaN(idx)) continue;
    const dev = join(base, c, "device");
    const memUsedPath = join(dev, "mem_info_vram_used");
    const memTotalPath = join(dev, "mem_info_vram_total");
    const utilPath = join(dev, "gpu_busy_percent");
    const vendorPath = join(dev, "vendor");
    // Solo AMD.
    let vendor = "";
    try {
      vendor = (await readFile(vendorPath, "utf8")).trim();
    } catch {
      continue;
    }
    if (!vendor.includes("0x1002") && !/amd|advanced micro/i.test(vendor))
      continue;
    const gi: GpuInfo = {
      index: `amdgpu-${c}`,
      vendor: "amd",
      memUsedMiB: null,
      memTotalMiB: null,
      gpuUtilPct: null,
    };
    const used = await readNumFile(memUsedPath);
    const total = await readNumFile(memTotalPath);
    const util = await readNumFile(utilPath);
    if (used !== null) gi.memUsedMiB = used / (1024 * 1024);
    if (total !== null) gi.memTotalMiB = total / (1024 * 1024);
    if (util !== null) gi.gpuUtilPct = util;
    gpus.push(gi);
  }
  return gpus;
}

async function readNumFile(p: string): Promise<number | null> {
  try {
    const s = (await readFile(p, "utf8")).trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}
function numOrNull(s: string): number | null {
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function readGpuStats(): Promise<GpuInfo[]> {
  const [nv, amd] = await Promise.all([readNvidiaGpus(), readAmdGpus()]);
  return [...nv, ...amd];
}

// ─── Parsing de métricas desde logs ──────────────────────────────────────────
interface ParsedMetrics {
  promptTokensPerSecond: number | null;
  generationTokensPerSecond: number | null;
  draftAcceptance: number | null;
  genDrafts: number | null;
  accDrafts: number | null;
  genTokens: number | null;
  accTokens: number | null;
  loadTimeSeconds: number | null;
}

/** Extrae métricas de las últimas N líneas de log relevantes. */
function parseMetricsFromLogs(lines: LogEntry[]): ParsedMetrics {
  const m: ParsedMetrics = {
    promptTokensPerSecond: null,
    generationTokensPerSecond: null,
    draftAcceptance: null,
    genDrafts: null,
    accDrafts: null,
    genTokens: null,
    accTokens: null,
    loadTimeSeconds: null,
  };
  // Tomamos desde el final para quedarnos con la última medición.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].msg;
    if (m.promptTokensPerSecond === null) {
      const mm = l.match(
        /prompt eval time.*?(\d+(?:\.\d+)?)\s*tokens per second/i,
      );
      if (mm) m.promptTokensPerSecond = Number(mm[1]);
    }
    if (m.generationTokensPerSecond === null) {
      const mm = l.match(/eval time.*?(\d+(?:\.\d+)?)\s*tokens per second/i);
      if (mm) m.generationTokensPerSecond = Number(mm[1]);
    }
    if (m.draftAcceptance === null) {
      const mm = l.match(/draft acceptance\s*=?\s*([0-9.]+)/i);
      if (mm) m.draftAcceptance = Number(mm[1]);
    }
    // draft-mtp: una sola línea con #gen drafts, #acc drafts, #gen tokens, #acc tokens.
    //   statistics        draft-mtp: #calls(b,g,a) = ..., #gen drafts =  418,
    //   #acc drafts = 403, #gen tokens = 836, #acc tokens = 783, ...
    if (m.genDrafts === null) {
      const mm = l.match(
        /draft-mtp:.*?#gen drafts\s*=\s*(\d+).*?#acc drafts\s*=\s*(\d+).*?#gen tokens\s*=\s*(\d+).*?#acc tokens\s*=\s*(\d+)/i,
      );
      if (mm) {
        m.genDrafts = Number(mm[1]);
        m.accDrafts = Number(mm[2]);
        m.genTokens = Number(mm[3]);
        m.accTokens = Number(mm[4]);
      }
    }
    if (m.loadTimeSeconds === null) {
      const mm = l.match(/model loaded.*?([0-9.]+)\s*ms/i);
      if (mm) m.loadTimeSeconds = Number(mm[1]) / 1000;
    }
    if (
      m.promptTokensPerSecond !== null &&
      m.generationTokensPerSecond !== null &&
      m.draftAcceptance !== null &&
      m.genDrafts !== null &&
      m.loadTimeSeconds !== null
    ) {
      break;
    }
  }
  // Fallback de load time: medir entre "loading model" y "model loaded".
  if (m.loadTimeSeconds === null) {
    let loadingIdx = -1;
    let loadedIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].msg.toLowerCase();
      if (loadingIdx === -1 && l.includes("loading model")) loadingIdx = i;
      if (l.includes("model loaded")) loadedIdx = i;
    }
    if (loadingIdx >= 0 && loadedIdx > loadingIdx) {
      m.loadTimeSeconds = (lines[loadedIdx].t - lines[loadingIdx].t) / 1000;
    }
  }
  return m;
}

// ─── Health-check del servidor ──────────────────────────────────────────────────
const HEALTH_POLL_MS = 500;
const HEALTH_TIMEOUT_MS = 120_000; // 2 min para modelos muy grandes.

/**
 * Hace polling a `GET /health` (o `GET /`) hasta que responda 200.
 * Los últimos llama.cpp exponen /health; si no existe, cae a "/".
 */
async function waitForServer(base: string): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const resp = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (resp.ok) return;
      // 404: endpoint no existe, probamos con "/".
      if (resp.status === 404) {
        const resp2 = await fetch(base, { signal: AbortSignal.timeout(3000) });
        if (resp2.ok) return;
      }
      systemLog(
        `benchmark: health-check respondió ${resp.status}, reintentando…`,
      );
    } catch (e) {
      // Connection refused / timeout — esperado mientras arranca.
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `Servidor no respondió tras ${(HEALTH_TIMEOUT_MS / 1000).toFixed(0)}s`,
      );
    }
    await sleep(HEALTH_POLL_MS);
  }
}

/** Resta la baseline de GPU stats para obtener solo el delta consumido por el benchmark. */
function subtractGpuBaseline(final: GpuInfo[], baseline: GpuInfo[]): GpuInfo[] {
  const baselineMap = new Map(baseline.map((g) => [g.index, g]));
  return final.map((g) => {
    const base = baselineMap.get(g.index);
    if (!base) return { ...g };
    const usedDelta =
      g.memUsedMiB !== null && base.memUsedMiB !== null
        ? Math.max(0, g.memUsedMiB - base.memUsedMiB)
        : g.memUsedMiB;
    return {
      ...g,
      memUsedMiB: usedDelta,
    };
  });
}

// ─── Benchmark real contra la API de llama-server ─────────────────────────────
const DEFAULT_PROMPT = "Explica qué es Vulkan en 100 palabras";

async function runBenchmark(
  script: string,
  prompt: string,
): Promise<BenchmarkResult> {
  const errors: string[] = [];

  // 0) Parsear el script. Si falla, no hay nada que ejecutar.
  let parsed: ParsedScript;
  try {
    parsed = parseScript(script);
  } catch (e) {
    return finalize(null, prompt, [
      `Script inválido: ${(e as Error).message}`,
    ], 0);
  }

  // Marcador: índice del log desde el cual parsear al final.
  const logStartIndex = logBuffer.length;

  // 0b) Capturar baseline de GPU antes de iniciar (para restar VRAM ya usada).
  const gpuBaseline = await readGpuStats();

  // 1) Arrancar servidor.
  systemLog("benchmark: iniciando llama-server…");
  try {
    await startServer(parsed);
  } catch (e) {
    errors.push(`No se pudo iniciar el servidor: ${(e as Error).message}`);
    return finalize(parsed, prompt, errors, logStartIndex);
  }

  try {
    // 2) Esperar que el servidor acepte conexiones HTTP.
    //    "server is listening" puede aparecer antes de que el socket esté
    //    realmente listo, especialmente con modelos grandes.
    const base = urlFor(parsed);
    await waitForServer(base);
    systemLog("benchmark: servidor responde, ejecutando request…");

    // 3) Request de benchmark. Se omite cualquier parámetro de sampling que
    //    no estuviera en el script (temp/topP/topK = null).
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: prompt }],
      max_tokens: 256,
      stream: false,
    };
    if (parsed.model) {
      body.model = parsed.model.split(":")[0] ?? parsed.model;
    }
    if (parsed.temp !== null) body.temperature = parsed.temp;
    if (parsed.topP !== null) body.top_p = parsed.topP;
    if (parsed.topK !== null) body.top_k = parsed.topK;

    const t0 = performance.now();
    let responseText = "";
    try {
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        errors.push(`HTTP ${resp.status} en /v1/chat/completions`);
      } else {
        const data = await resp.json();
        responseText = data?.choices?.[0]?.message?.content ?? "";
      }
    } catch (e) {
      errors.push(`Fallo en request: ${(e as Error).message}`);
    }
    const requestLatencyMs = performance.now() - t0;

    // Dar un pequeño margen para que el servidor flushee las líneas de timing.
    await sleep(400);

    // 3) Parsear métricas de logs.
    const relevantLines = logBuffer.slice(logStartIndex);
    const parsedMetrics = parseMetricsFromLogs(relevantLines);

    // 4) GPU stats finales y restar baseline.
    const gpusFinal = await readGpuStats();
    const gpus = subtractGpuBaseline(gpusFinal, gpuBaseline);

    const result: BenchmarkResult = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      config: parsed,
      promptTokensPerSecond: parsedMetrics.promptTokensPerSecond,
      generationTokensPerSecond: parsedMetrics.generationTokensPerSecond,
      draftAcceptance: parsedMetrics.draftAcceptance,
      genDrafts: parsedMetrics.genDrafts,
      accDrafts: parsedMetrics.accDrafts,
      genTokens: parsedMetrics.genTokens,
      accTokens: parsedMetrics.accTokens,
      loadTimeSeconds: parsedMetrics.loadTimeSeconds,
      requestLatencyMs,
      prompt,
      response: responseText.slice(0, 4000),
      gpus,
      errors,
    };

    await saveResult(result);
    systemLog("benchmark: finalizado y guardado.");
    return result;
  } finally {
    // 7) Detener el servidor automáticamente.
    await stopServer();
  }
}

function finalize(
  parsed: ParsedScript | null,
  prompt: string,
  errors: string[],
  _logStartIndex: number,
): BenchmarkResult {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    config: parsed ?? {
      script: "",
      binary: "",
      argv: [],
      model: null,
      host: "127.0.0.1",
      port: 8080,
      ctxSize: null,
      batchSize: null,
      ubatchSize: null,
      cacheTypeK: null,
      cacheTypeV: null,
      device: null,
      tensorSplit: null,
      temp: null,
      topP: null,
      topK: null,
    },
    promptTokensPerSecond: null,
    generationTokensPerSecond: null,
    draftAcceptance: null,
    genDrafts: null,
    accDrafts: null,
    genTokens: null,
    accTokens: null,
    loadTimeSeconds: null,
    requestLatencyMs: null,
    prompt,
    response: "",
    gpus: [],
    errors,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Persistencia del historial ──────────────────────────────────────────────
async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}
async function saveResult(r: BenchmarkResult) {
  await ensureDataDir();
  const all = await loadHistory();
  all.unshift(r);
  // Limitar tamaño del historial (200 entradas).
  const trimmed = all.slice(0, 200);
  await writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}
async function loadHistory(): Promise<BenchmarkResult[]> {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}
async function deleteResult(id: string) {
  const all = await loadHistory();
  const next = all.filter((r) => r.id !== id);
  await writeFile(HISTORY_FILE, JSON.stringify(next, null, 2));
}
async function clearHistory() {
  await ensureDataDir();
  await writeFile(HISTORY_FILE, "[]");
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
let benchmarkRunning = false;

async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: cors });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: { "Content-Type": "application/json", ...cors },
    });

  // ── Estado y control del proceso ──
  if (path === "/status" && req.method === "GET") {
    const m = managed;
    const body: StatusResponse = {
      status,
      pid: m?.pid ?? null,
      startedAt: m?.startedAt ?? null,
      url: m ? urlFor(m.parsed) : null,
      error: statusError,
    };
    return json(body);
  }

  // ── Script por defecto (guardar / leer) ──
  if (path === "/script-default" && req.method === "GET") {
    try {
      const content = await readFile(SCRIPT_FILE, "utf8");
      return new Response(content, { headers: { "Content-Type": "text/plain", ...cors } });
    } catch {
      return new Response("Not found", { status: 404, headers: cors });
    }
  }
  if (path === "/script-default" && req.method === "POST") {
    try {
      const body = await req.json();
      if (typeof body?.script !== "string") {
        return json({ ok: false, error: "Falta el campo 'script'." }, 400);
      }
      await ensureDataDir();
      await writeFile(SCRIPT_FILE, body.script, "utf8");
      systemLog("script-default guardado.");
      return json({ ok: true });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    }
  }

  // ── Iniciar servidor manual ──
  if (path === "/start" && req.method === "POST") {
    if (managed)
      return json({ ok: false, error: "Ya hay un servidor corriendo." }, 409);
    let script: string;
    try {
      const body = await req.json();
      script = body?.script ?? "";
    } catch {
      return json({ ok: false, error: "Falta el campo 'script'." }, 400);
    }
    try {
      const parsed = parseScript(script);
      const pid = await startServer(parsed);
      // Resolvemos la promesa de ready en background; respondemos ya.
      return json({ ok: true, pid });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    }
  }

  if (path === "/stop" && req.method === "POST") {
    await stopServer();
    return json({ ok: true });
  }

  if (path === "/logs" && req.method === "GET") {
    const since = Number(url.searchParams.get("since") ?? "0");
    const entries = logBuffer.slice(since);
    const cursor = logBuffer.length;
    const body: LogsResponse = { entries, cursor };
    return json(body);
  }

  // ── Métricas de GPU en vivo ──
  if (path === "/gpu" && req.method === "GET") {
    return json({ gpus: await readGpuStats() });
  }

  // ── Benchmark ──
  if (path === "/benchmark" && req.method === "POST") {
    if (benchmarkRunning)
      return json({ ok: false, error: "Ya hay un benchmark corriendo." }, 409);
    if (managed)
      return json(
        {
          ok: false,
          error: "Detén el servidor manual antes de benchmark automático.",
        },
        409,
      );
    benchmarkRunning = true;
    let script = "";
    let prompt = DEFAULT_PROMPT;
    try {
      const body = await req.json().catch(() => ({}));
      if (typeof body?.script === "string") script = body.script;
      if (typeof body?.prompt === "string" && body.prompt.trim())
        prompt = body.prompt;
    } catch {
      /* usa defaults */
    }
    try {
      const result = await runBenchmark(script, prompt);
      return json({ ok: true, result });
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500);
    } finally {
      benchmarkRunning = false;
    }
  }

  // ── Historial ──
  if (path === "/history" && req.method === "GET") {
    return json({ results: await loadHistory() });
  }
  if (path === "/history" && req.method === "DELETE") {
    await clearHistory();
    return json({ ok: true });
  }
  if (path.startsWith("/history/") && req.method === "DELETE") {
    const id = decodeURIComponent(path.slice("/history/".length));
    await deleteResult(id);
    return json({ ok: true });
  }

  // ── Exportar/limpiar logs ──
  if (path === "/logs/clear" && req.method === "POST") {
    logBuffer.length = 0;
    return json({ ok: true });
  }

  // ── Archivos estáticos (frontend) ──
  const staticRoot = join(dirname(fileURLToPath(import.meta.url)), "public");
  let filePath = join(staticRoot, path === "/" ? "index.html" : path);
  // Evitar path traversal.
  if (!filePath.startsWith(staticRoot))
    return new Response("Forbidden", { status: 403 });
  if (path === "/" || path === "/index.html")
    filePath = join(staticRoot, "index.html");
  else if (path === "/app.js") filePath = join(staticRoot, "app.js");
  else if (path === "/style.css") filePath = join(staticRoot, "style.css");
  else return new Response("Not found", { status: 404, headers: cors });

  const file = Bun.file(filePath);
  if (!(await file.exists()))
    return new Response("Not found", { status: 404, headers: cors });
  return new Response(file);
}

// Bootstrap.
await ensureDataDir();
if (existsSync(HISTORY_FILE) === false) await writeFile(HISTORY_FILE, "[]");

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: handleRequest,
});

systemLog(`backend escuchando en http://localhost:${server.port}`);
console.log(`→ http://localhost:${server.port}`);
