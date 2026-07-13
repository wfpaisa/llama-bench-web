// Router HTTP: path matching manual + CORS. Solo API JSON (el frontend vive en
// front/, servido aparte). Sin frameworks: handleRequest() despacha a cada
// módulo según el path.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import type { LogsResponse, StatusResponse } from './types.ts'
import { managed, benchmarkRunning, setBenchmarkRunning, benchAbortController, status, statusError } from './state.ts'
import { parseScript } from './script-parser.ts'
import { startServer, stopServer, urlFor, assertBinaryExists } from './server-manager.ts'
import { readGpuStats } from './gpu.ts'
import { readRamStats } from './mem.ts'
import { runBenchmark } from './benchmark.ts'
import { DEFAULT_PROMPT } from './metrics.ts'
import { clearHistory, deleteResult, deleteResults, ensureDataDir, loadHistory, setRating } from './history.ts'
import { getLogBuffer, systemLog } from './logs.ts'
import { SCRIPT_FILE, PROMPT_FILE } from './config.ts'
import { listDevices } from './devices.ts'
import { parseModelMeta, buildEstimateResponse, resolveModelFile } from './optimizer.ts'
import { runDryfit } from './dryfit.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Despacha una request HTTP a la respuesta correspondiente. */
export async function handleRequest(req: Request): Promise<Response> {
  const url = new URL(req.url)
  const path = url.pathname

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })

  const json = (data: unknown, status = 200): Response =>
    new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json', ...CORS },
    })

  // ── Estado y control del proceso ──
  if (path === '/status' && req.method === 'GET') {
    const m = managed
    const body: StatusResponse = {
      status,
      pid: m?.pid ?? null,
      startedAt: m?.startedAt ?? null,
      url: m ? urlFor(m.parsed) : null,
      error: statusError,
    }
    return json(body)
  }

  // ── Script por defecto (guardar / leer) ──
  if (path === '/script-default' && req.method === 'GET') {
    try {
      const content = await readFile(SCRIPT_FILE, 'utf8')
      return new Response(content, { headers: { 'Content-Type': 'text/plain', ...CORS } })
    } catch {
      return new Response('Not found', { status: 404, headers: CORS })
    }
  }
  if (path === '/script-default' && req.method === 'POST') {
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
  if (path === '/prompt-default' && req.method === 'GET') {
    try {
      const content = await readFile(PROMPT_FILE, 'utf8')
      return new Response(content, { headers: { 'Content-Type': 'text/plain', ...CORS } })
    } catch {
      return new Response(DEFAULT_PROMPT, { headers: { 'Content-Type': 'text/plain', ...CORS } })
    }
  }
  if (path === '/prompt-default' && req.method === 'POST') {
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

  if (path === '/start' && req.method === 'POST') {
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

  if (path === '/stop' && req.method === 'POST') {
    await stopServer()
    return json({ ok: true })
  }

  if (path === '/logs' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') ?? '0')
    const entries = getLogBuffer().slice(since)
    const cursor = getLogBuffer().length
    const body: LogsResponse = { entries, cursor }
    return json(body)
  }

  // ── Métricas de hardware en vivo (GPU + RAM) ──
  if (path === '/gpu' && req.method === 'GET') {
    const [gpus, ram] = await Promise.all([readGpuStats(), readRamStats()])
    return json({ gpus, ram })
  }

  // ── Benchmark ──
  if (path === '/benchmark' && req.method === 'POST') {
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

  if (path === '/benchmark/stop' && req.method === 'POST') {
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
  if (path === '/dryfit' && req.method === 'POST') {
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

  // ── Optimizador: estimación heurística (sin arrancar el binario) ──
  // Body: { script, params?, priority? }.
  // Devuelve devices disponibles + heurística con los params indicados +
  // recomendación automática que cabe en la VRAM libre.
  if (path === '/estimate' && req.method === 'POST') {
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
      }
      const priority = body.priority === 'quality' ? 'quality' : 'ctx'

      const estimate = buildEstimateResponse({ meta, devices, params, priority })
      return json({ ok: true, estimate })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    }
  }

  // ── Historial ──
  if (path === '/history' && req.method === 'GET') {
    return json({ results: await loadHistory() })
  }
  if (path === '/history' && req.method === 'DELETE') {
    await clearHistory()
    return json({ ok: true })
  }
  if (path.startsWith('/history/') && req.method === 'DELETE') {
    const id = decodeURIComponent(path.slice('/history/'.length))
    await deleteResult(id)
    return json({ ok: true })
  }
  // POST /history/delete  body: { ids: string[] }
  if (path === '/history/delete' && req.method === 'POST') {
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

  // ── Calificación de un resultado (1-10 estrellas) ──
  // PATCH /history/:id  body: { rating: number | null }
  if (path.startsWith('/history/') && req.method === 'PATCH') {
    const id = decodeURIComponent(path.slice('/history/'.length))
    try {
      const body = await req.json()
      const rating = body?.rating
      // null explícito = "sin calificar"; number entre 0 y 10 (0 = sin calificar).
      const normalized = rating == null ? null : typeof rating === 'number' && Number.isFinite(rating) ? rating : Number(rating)
      if (normalized !== null && (typeof normalized !== 'number' || normalized < 0 || normalized > 10)) {
        return json({ ok: false, error: 'rating debe estar entre 0 y 10.' }, 400)
      }
      const ok = await setRating(id, normalized)
      if (!ok) return json({ ok: false, error: 'Resultado no encontrado.' }, 404)
      return json({ ok: true })
    } catch (e) {
      return json({ ok: false, error: (e as Error).message }, 500)
    }
  }

  // ── Exportar/limpiar logs ──
  if (path === '/logs/clear' && req.method === 'POST') {
    getLogBuffer().length = 0
    return json({ ok: true })
  }

  return new Response('Not found', { status: 404, headers: CORS })
}

// existsSync re-export: el entry lo usa en el bootstrap para history.json.
export { existsSync }
