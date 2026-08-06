// Router HTTP: path matching manual + CORS. En dev es solo API JSON (el frontend
// vive en front/, servido aparte por ng serve). En modo empaquetado (env
// FRONT_DIST seteada por Electron) sirve además los estáticos del frontend en
// el mismo puerto → same-origin, sin CORS ni mixed-content. Sin frameworks:
// handleRequest() despacha a cada módulo según el path.

import { createReadStream, existsSync, statSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import type { LogsResponse, StatusResponse } from './types.ts'
import { managed, benchmarkRunning, setBenchmarkRunning, benchAbortController, status, statusError } from './state.ts'
import { parseScript } from './script-parser.ts'
import { startServer, stopServer, urlFor, assertBinaryExists } from './server-manager.ts'
import { readGpuStats } from './gpu.ts'
import { readRamStats } from './mem.ts'
import { runBenchmark } from './benchmark.ts'
import { DEFAULT_PROMPT } from './metrics.ts'
import { clearHistory, deleteResult, deleteResults, ensureDataDir, loadHistory, setFavorite, setRating } from './history.ts'
import { currentCursor, entriesSince, onLog, systemLog } from './logs.ts'
import { clearLogBuffer } from './state.ts'
import { SCRIPT_FILE, PROMPT_FILE, FLAGS_FAV_FILE } from './config.ts'
import { listDevices } from './devices.ts'
import { parseModelMeta, buildEstimateResponse, resolveModelFile } from './optimizer.ts'
import { runDryfit } from './dryfit.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Respuesta JSON con los headers CORS de la API. */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  })
}

/** Respuesta de texto plano con los headers CORS de la API. */
function text(body: string, status = 200): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'text/plain', ...CORS } })
}

/**
 * Una ruta de la API. `path` es la ruta exacta o un predicado (para las rutas
 * con parámetro, p.ej. /history/:id).
 */
interface Route {
  method: string
  path: string | ((p: string) => boolean)
  handler: (req: Request, url: URL) => Promise<Response> | Response
}

/**
 * Tabla de rutas de la API, evaluada EN ORDEN: la primera que casa responde.
 * El orden importa donde hay solapamiento (`/history/delete` antes que el
 * comodín `/history/:id`).
 */
const ROUTES: Route[] = [
  // ── Estado y control del proceso ──
  { method: 'GET', path: '/status', handler: () => json(statusSnapshot()) },
  { method: 'POST', path: '/start', handler: startHandler },
  { method: 'POST', path: '/stop', handler: stopHandler },

  // ── Defaults de script y prompt ──
  { method: 'GET', path: '/script-default', handler: getScriptDefault },
  { method: 'POST', path: '/script-default', handler: saveScriptDefault },
  { method: 'GET', path: '/prompt-default', handler: getPromptDefault },
  { method: 'POST', path: '/prompt-default', handler: savePromptDefault },

  // ── Flags destacadas del editor ──
  { method: 'GET', path: '/flags-favorites', handler: getFlagsFavorites },
  { method: 'POST', path: '/flags-favorites', handler: saveFlagsFavorites },

  // ── Logs: stream en vivo (principal) + polling (fallback) ──
  { method: 'GET', path: '/events', handler: eventsHandler },
  { method: 'GET', path: '/logs', handler: logsHandler },
  { method: 'POST', path: '/logs/clear', handler: clearLogsHandler },

  // ── Métricas de hardware ──
  { method: 'GET', path: '/gpu', handler: gpuHandler },

  // ── Benchmark y calibración ──
  { method: 'POST', path: '/benchmark', handler: benchmarkHandler },
  { method: 'POST', path: '/benchmark/stop', handler: benchmarkStopHandler },
  { method: 'POST', path: '/dryfit', handler: dryfitHandler },
  { method: 'POST', path: '/estimate', handler: estimateHandler },

  // ── Historial ── (las rutas exactas van antes que el comodín /history/:id)
  { method: 'GET', path: '/history', handler: async () => json({ results: await loadHistory() }) },
  {
    method: 'DELETE',
    path: '/history',
    handler: async () => {
      await clearHistory()
      return json({ ok: true })
    },
  },
  { method: 'POST', path: '/history/delete', handler: deleteSelectedHandler },
  { method: 'DELETE', path: isHistoryItem, handler: deleteResultHandler },
  { method: 'PATCH', path: isHistoryItem, handler: patchResultHandler },
]

/** ¿Es una ruta de item del historial (/history/:id)? */
function isHistoryItem(p: string): boolean {
  return p.startsWith('/history/')
}

/**
 * Despacha una request HTTP a la respuesta correspondiente: primero la tabla de
 * rutas de la API y, solo si ninguna casa, los estáticos del frontend (modo
 * empaquetado). Ese orden garantiza que /status, /logs, /history… nunca
 * colisionen con un archivo del build.
 */
export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  for (const route of ROUTES) {
    if (route.method !== req.method) continue
    const match = typeof route.path === 'string' ? path === route.path : route.path(path)
    if (match) return route.handler(req, url)
  }

  // ── Estáticos del frontend (solo en modo empaquetado) ──
  // Cuando la env FRONT_DIST está seteada (la inyecta Electron al spawn), el
  // backend sirve el build de Angular desde el mismo puerto → same-origin.
  // Fallback SPA a index.html.
  const dist = process.env.FRONT_DIST
  if (dist && req.method === 'GET') return serveStatic(dist, path)

  return new Response('Not found', { status: 404, headers: CORS })
}

// ── Handlers de la API ───────────────────────────────────────────────────────

// ── Script por defecto (guardar / leer) ──
async function getScriptDefault(): Promise<Response> {
  try {
    return text(await readFile(SCRIPT_FILE, 'utf8'))
  } catch {
    return new Response('Not found', { status: 404, headers: CORS })
  }
}

async function saveScriptDefault(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    if (typeof body?.script !== 'string') {
      return json({ ok: false, error: "Falta el campo 'script'." }, 400)
    }
    await ensureDataDir()
    await writeFile(SCRIPT_FILE, body.script, 'utf8')
    systemLog('script-default guardado.')
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}

// ── Prompt por defecto (guardar / leer) ──
// Si no hay prompt guardado en disco, se devuelve DEFAULT_PROMPT (default
// built-in) en lugar de 404: así "Restablecer default" siempre tiene un texto.
async function getPromptDefault(): Promise<Response> {
  try {
    return text(await readFile(PROMPT_FILE, 'utf8'))
  } catch {
    return text(DEFAULT_PROMPT)
  }
}

async function savePromptDefault(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    if (typeof body?.prompt !== 'string') {
      return json({ ok: false, error: "Falta el campo 'prompt'." }, 400)
    }
    await ensureDataDir()
    await writeFile(PROMPT_FILE, body.prompt, 'utf8')
    systemLog('prompt-default guardado.')
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}

// ── Flags destacadas (favoritos) del editor de script ──
// Array JSON de flags largas canónicas. Si no existe el archivo → array vacío.
async function getFlagsFavorites(): Promise<Response> {
  try {
    const arr = JSON.parse(await readFile(FLAGS_FAV_FILE, 'utf8'))
    const favorites = Array.isArray(arr) && arr.every((x) => typeof x === 'string') ? arr : []
    return json({ favorites })
  } catch {
    return json({ favorites: [] })
  }
}

async function saveFlagsFavorites(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    const favorites = body?.favorites
    if (!Array.isArray(favorites) || !favorites.every((x) => typeof x === 'string')) {
      return json({ ok: false, error: "'favorites' debe ser un array de strings." }, 400)
    }
    await ensureDataDir()
    await writeFile(FLAGS_FAV_FILE, JSON.stringify(favorites, null, 2), 'utf8')
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}

async function startHandler(req: Request): Promise<Response> {
  {
    if (managed) return json({ ok: false, error: 'Ya hay un servidor corriendo.' }, 409)
    let script: string
    try {
      const body = await req.json()
      script = body?.script ?? ''
    } catch {
      return json({ ok: false, error: "Falta el campo 'script'." }, 400)
    }
    try {
      const parsed = parseScript(script)
      // Validar el binario antes de spawn: evita un ENOENT críptico de
      // posix_spawn y da un mensaje accionable al usuario.
      assertBinaryExists(parsed.binary)
      const pid = (await startServer(parsed)).pid
      // Resolvemos la promesa de ready en background; respondemos ya.
      return json({ ok: true, pid })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    }
  }
}

async function stopHandler(): Promise<Response> {
  await stopServer()
  return json({ ok: true })
}

// Stream de logs + status en vivo (SSE). Es el transporte principal del visor;
// /logs queda como fallback si EventSource no consigue mantener la conexión.
function eventsHandler(req: Request, url: URL): Response {
  return sseStream(Number(url.searchParams.get('since') ?? '0'), req.signal)
}

// Fallback por polling. `since` es un `seq` (cursor absoluto), no un índice:
// así un recorte del buffer no desincroniza al cliente.
function logsHandler(_req: Request, url: URL): Response {
  const since = Number(url.searchParams.get('since') ?? '0')
  const body: LogsResponse = { entries: entriesSince(since), cursor: currentCursor() }
  return json(body)
}

// Vacía el buffer pero conserva la secuencia global: los clientes conectados
// no rebobinan ni reciben de nuevo lo ya descartado.
function clearLogsHandler(): Response {
  clearLogBuffer()
  return json({ ok: true })
}

// ── Métricas de hardware en vivo (GPU + RAM) ──
async function gpuHandler(): Promise<Response> {
  const [gpus, ram] = await Promise.all([readGpuStats(), readRamStats()])
  return json({ gpus, ram })
}

// ── Benchmark ──
async function benchmarkHandler(req: Request): Promise<Response> {
  {
    if (benchmarkRunning) return json({ ok: false, error: 'Ya hay un benchmark corriendo.' }, 409)
    if (managed)
      return json(
        {
          ok: false,
          error: 'Detén el servidor manual antes de benchmark automático.',
        },
        409
      )
    setBenchmarkRunning(true)
    let script = ''
    let prompt = DEFAULT_PROMPT
    let maxTokens: number | null = 2048
    try {
      const body = await req.json().catch(() => ({}))
      if (typeof body?.script === 'string') script = body.script
      if (typeof body?.prompt === 'string' && body.prompt.trim()) prompt = body.prompt

      if (body?.max_tokens === null) maxTokens = null
      else if (typeof body?.max_tokens === 'number' && body.max_tokens > 0) maxTokens = body.max_tokens
    } catch {
      /* usa defaults */
    }
    try {
      const result = await runBenchmark(script, prompt, maxTokens)
      return json({ ok: true, result })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    } finally {
      setBenchmarkRunning(false)
    }
  }
}

function benchmarkStopHandler(): Response {
  if (benchAbortController) {
    benchAbortController.abort()
    return json({ ok: true })
  }
  return json({ ok: false, error: 'No hay un benchmark en ejecución.' }, 404)
}

// ── Calibración real del optimizador (dry-fit) ──
// Arranca llama-server con el script, espera a que el modelo cargue, mide la
// VRAM real consumida (delta de --list-devices) y detiene el servidor. NO
// envía inferencia. Mismo guard de concurrencia que /benchmark (ocupa el
// mismo puerto 8080 y reusa el benchAbortController → /benchmark/stop cancela).
// El dryfit NO lanza en errores esperados: devuelve { ok:true, dryfit:{error} }
// para que el frontend muestre el error inline; solo 500 en excepciones raras.
async function dryfitHandler(req: Request): Promise<Response> {
  {
    if (benchmarkRunning) return json({ ok: false, error: 'Ya hay un benchmark o calibración corriendo.' }, 409)
    if (managed) return json({ ok: false, error: 'Detén el servidor manual antes de calibrar.' }, 409)
    setBenchmarkRunning(true)
    let script = ''
    try {
      const body = await req.json().catch(() => ({}))
      if (typeof body?.script === 'string') script = body.script
    } catch {
      /* script vacío → runDryfit devuelve error de parseo */
    }
    try {
      const dryfit = await runDryfit(script)
      return json({ ok: true, dryfit })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    } finally {
      setBenchmarkRunning(false)
    }
  }
}

// ── Optimizador: estimación heurística (sin arrancar el binario) ──
// Body: { script, params?, priority? }.
// Devuelve devices disponibles + heurística con los params indicados +
// recomendación automática que cabe en la VRAM libre.
async function estimateHandler(req: Request): Promise<Response> {
  {
    try {
      const body = await req.json().catch(() => ({}))
      if (typeof body?.script !== 'string') {
        return json({ ok: false, error: "Falta el campo 'script'." }, 400)
      }
      let parsed
      try {
        parsed = parseScript(body.script)
      } catch (e) {
        return json({ ok: false, error: `Script inválido: ${(e as Error).message}` }, 400)
      }

      // Validar que el binario exista antes de intentar listar devices: si no
      // existe, listDevices devolvería [] en silencio y el modal del frontend
      // se quedaría colgado en "Detectando dispositivos…".
      try {
        assertBinaryExists(parsed.binary)
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, 400)
      }

      // Enumerar devices del backend (--list-devices).
      const devices = await listDevices(parsed.binary)
      const meta = parseModelMeta(parsed.model)

      // Resolver el archivo real del modelo (-hf → HF cache, --model → ruta)
      // para medir su tamaño exacto en disco y leer su arquitectura del header
      // GGUF (capas, kv_heads, head_dim reales → KV cache exacto).
      const resolved = resolveModelFile(parsed.model, parsed.modelFile)
      meta.weightsFileMiB = resolved.sizeMiB
      meta.weightsFile = resolved.file
      meta.mmprojSizeMiB = resolved.mmprojSizeMiB
      // Sobrescribir la arquitectura adivinada con la real del GGUF si se leyó.
      if (resolved.arch) {
        if (resolved.arch.layers != null) meta.layers = resolved.arch.layers
        if (resolved.arch.kvHeads != null) meta.kvHeads = resolved.arch.kvHeads
        if (resolved.arch.keyLength != null) meta.headDim = resolved.arch.keyLength
        // Capas de atención (modelos híbridos SSM/Attention): si se detectó,
        // sobrescribe para que el KV cache se calcule solo sobre esas capas.
        if (resolved.arch.attentionLayers != null) meta.attentionLayers = resolved.arch.attentionLayers
      }

      // Params: los que vienen en el body, si no, los del script parseado.
      const params = {
        ctxSize: body.params?.ctxSize ?? parsed.ctxSize ?? 8192,
        ngl: body.params?.ngl ?? parsed.ngl ?? 999,
        cacheTypeK: body.params?.cacheTypeK ?? parsed.cacheTypeK ?? 'f16',
        cacheTypeV: body.params?.cacheTypeV ?? parsed.cacheTypeV ?? 'f16',
        batchSize: body.params?.batchSize ?? parsed.batchSize ?? 512,
        ubatchSize: body.params?.ubatchSize ?? parsed.ubatchSize ?? 128,
        flashAttn: body.params?.flashAttn ?? parsed.flashAttn ?? true,
        device:
          body.params?.device ??
          (parsed.device
            ? parsed.device
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            : []),
        tensorSplit: body.params?.tensorSplit ?? (parsed.tensorSplit ? parsed.tensorSplit.split(',').map(Number).filter(Number.isFinite) : null),
        nCpuMoe: body.params?.nCpuMoe ?? parsed.nCpuMoe ?? 0,
        cacheReuse: body.params?.cacheReuse ?? parsed.cacheReuse ?? 0,
        noMmproj: body.params?.noMmproj ?? parsed.noMmproj ?? false,
        specDraftMax: body.params?.specDraftMax ?? parsed.specDraftNMax ?? 0,
        cacheRam: body.params?.cacheRam ?? parsed.cacheRam ?? 8192,
      }
      const priority = body.priority === 'quality' ? 'quality' : 'ctx'

      const estimate = buildEstimateResponse({ meta, devices, params, priority })
      return json({ ok: true, estimate })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    }
  }
}

// ── Historial ──
async function deleteResultHandler(_req: Request, url: URL): Promise<Response> {
  const id = decodeURIComponent(url.pathname.slice('/history/'.length))
  await deleteResult(id)
  return json({ ok: true })
}

// POST /history/delete  body: { ids: string[] }
async function deleteSelectedHandler(req: Request): Promise<Response> {
  try {
    const body = await req.json()
    const ids: unknown[] = body?.ids
    if (!Array.isArray(ids) || ids.length === 0) {
      return json({ ok: false, error: 'ids debe ser un array no vacío.' }, 400)
    }
    await deleteResults(ids.map(String))
    return json({ ok: true })
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 500)
  }
}

// ── Calificación (1-10 estrellas) y favorito (corazón) de un resultado ──
// PATCH /history/:id  body: { rating?: number | null, favorite?: boolean }
// Ambos campos son opcionales: se persiste solo el que venga en el body.
async function patchResultHandler(req: Request, url: URL): Promise<Response> {
  {
    const id = decodeURIComponent(url.pathname.slice('/history/'.length))
    try {
      const body = await req.json()
      // Se devuelve el resultado ya actualizado para que el frontend no tenga
      // que recargar el historial entero por un clic en una estrella.
      let updated: Awaited<ReturnType<typeof setRating>> = null

      // rating: null explícito = "sin calificar"; number entre 0 y 10.
      if (body && 'rating' in body) {
        const rating = body.rating
        const normalized = rating == null ? null : typeof rating === 'number' && Number.isFinite(rating) ? rating : Number(rating)
        if (normalized !== null && (typeof normalized !== 'number' || normalized < 0 || normalized > 10)) {
          return json({ ok: false, error: 'rating debe estar entre 0 y 10.' }, 400)
        }
        updated = await setRating(id, normalized)
        if (!updated) return json({ ok: false, error: 'Resultado no encontrado.' }, 404)
      }

      // favorite: boolean para destacar (corazón).
      if (body && 'favorite' in body) {
        updated = await setFavorite(id, Boolean(body.favorite))
        if (!updated) return json({ ok: false, error: 'Resultado no encontrado.' }, 404)
      }

      return json({ ok: true, result: updated })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    }
  }
}

// ── Stream de eventos en vivo (SSE) ──────────────────────────────────────────

/** Intervalo de muestreo del estado del proceso dentro del stream. */
const SSE_STATUS_POLL_MS = 400
/**
 * Heartbeat: comentario SSE que mantiene viva la conexión.
 * Debe quedar POR DEBAJO del `idleTimeout` de Bun.serve (10 s por defecto): si
 * no, el servidor corta el socket en cada periodo de silencio y el cliente ve
 * un ERR_INCOMPLETE_CHUNKED_ENCODING y reconecta cada 10 s.
 */
const SSE_HEARTBEAT_MS = 5_000

/** Estado del proceso tal como se emite por el stream. */
function statusSnapshot(): StatusResponse {
  const m = managed
  return {
    status,
    pid: m?.pid ?? null,
    startedAt: m?.startedAt ?? null,
    url: m ? urlFor(m.parsed) : null,
    error: statusError,
  }
}

/**
 * Abre un stream SSE que empuja:
 *   - `log`: cada línea nueva, en cuanto se encola (sin esperar a un tick).
 *   - `status`: el estado del proceso, solo cuando cambia respecto al último
 *     enviado (se muestrea cada SSE_STATUS_POLL_MS; es lectura de memoria).
 *
 * Al conectar manda el backlog posterior a `since` en un único evento `log`,
 * para que un reconexión no pierda líneas ni las duplique.
 */
function sseStream(since: number, signal: AbortSignal): Response {
  let unsubscribe: (() => void) | undefined
  let statusTimer: ReturnType<typeof setInterval> | undefined
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder()
      let closed = false

      const send = (event: string, data: unknown): void => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          // El cliente cerró entre el check y el enqueue: cerramos y salimos.
          cleanup()
        }
      }

      const cleanup = (): void => {
        if (closed) return
        closed = true
        unsubscribe?.()
        if (statusTimer) clearInterval(statusTimer)
        if (heartbeatTimer) clearInterval(heartbeatTimer)
        try {
          controller.close()
        } catch {
          /* ya cerrado */
        }
      }

      // 1) Backlog + estado actual, para que el cliente pinte de inmediato.
      const backlog = entriesSince(since)
      if (backlog.length) send('log', { entries: backlog, cursor: currentCursor() })
      let lastStatus = JSON.stringify(statusSnapshot())
      send('status', statusSnapshot())

      // 2) Cada línea nueva se empuja al instante.
      unsubscribe = onLog((entry) => send('log', { entries: [entry], cursor: entry.seq }))

      // 3) Estado del proceso: solo cuando cambia.
      statusTimer = setInterval(() => {
        const snapshot = statusSnapshot()
        const serialized = JSON.stringify(snapshot)
        if (serialized === lastStatus) return
        lastStatus = serialized
        send('status', snapshot)
      }, SSE_STATUS_POLL_MS)

      // 4) Heartbeat (comentario SSE, el cliente lo ignora).
      heartbeatTimer = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(': ping\n\n'))
        } catch {
          cleanup()
        }
      }, SSE_HEARTBEAT_MS)

      // 5) El cliente se fue (pestaña cerrada, recarga, red caída).
      signal.addEventListener('abort', cleanup, { once: true })
    },
    cancel() {
      unsubscribe?.()
      if (statusTimer) clearInterval(statusTimer)
      if (heartbeatTimer) clearInterval(heartbeatTimer)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Evita el buffering de proxies intermedios (y del webview de Electron).
      'X-Accel-Buffering': 'no',
      ...CORS,
    },
  })
}

// ── Servidor de estáticos (modo empaquetado) ─────────────────────────────────

// Content-types para las extensiones que usa el build de Angular (JS, CSS,
// fuentes, imágenes, sourcemaps). El resto cae a application/octet-stream.
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

/**
 * Sirve un archivo del directorio del frontend. Resuelve la ruta pedida contra
 * `dist` (sin escapar del dir → normalize + verificación de prefijo), y si no
 * existe cae a index.html (SPA routing del Angular router).
 *
 * El index.html se post-procesa para inyectar `window.__API_BASE_URL = ''`:
 * así el ApiService del frontend usa rutas relativas (mismo origen) en vez del
 * default 'http://localhost:3000' (que solo aplica en dev con ng serve aparte).
 */
async function serveStatic(dist: string, reqPath: string): Promise<Response> {
  // Limpiar la ruta: quitar leading slash y query (ya hecho por URL parsing).
  const rel = normalize(reqPath.replace(/^\/+/, ''))
  const abs = normalize(join(dist, rel))

  // Anti path-traversal: el resuelto debe seguir dentro de dist.
  if (!abs.startsWith(normalize(dist))) {
    return new Response('Forbidden', { status: 403 })
  }

  // Si existe y es archivo → servirlo. Si es directorio o no existe → SPA.
  if (existsSync(abs) && statSync(abs).isFile()) {
    const ct = MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    // stream para archivos grandes (fuentes, sourcemaps).
    const stream = createReadStream(abs)
    const readable = new ReadableStream({
      start(controller) {
        stream.on('data', (chunk: string | Buffer) => controller.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : new Uint8Array(chunk)))
        stream.on('end', () => controller.close())
        stream.on('error', (e) => controller.error(e))
      },
      cancel() {
        stream.destroy()
      },
    })
    return new Response(readable, { headers: { 'Content-Type': ct } })
  }

  // SPA fallback: index.html con la base URL inyectada.
  const indexFile = join(dist, 'index.html')
  if (existsSync(indexFile)) {
    let html = await readFile(indexFile, 'utf8')
    // Inyectar antes de </head>: same-origin → API base vacía (rutas relativas).
    if (!html.includes('__API_BASE_URL')) {
      html = html.replace('</head>', `<script>window.__API_BASE_URL='';</script></head>`)
    }
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }

  return new Response('Not found', { status: 404 })
}

// existsSync re-export: el entry lo usa en el bootstrap para history.json.
export { existsSync }
