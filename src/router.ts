// Router HTTP: path matching manual + CORS + archivos estáticos.
// Sin frameworks: handleRequest() despacha a cada módulo según el path.

import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { LogsResponse, StatusResponse } from './types.ts'
import { managed, benchmarkRunning, setBenchmarkRunning, status, statusError } from './state.ts'
import { parseScript } from './script-parser.ts'
import { startServer, stopServer, urlFor } from './server-manager.ts'
import { readGpuStats } from './gpu.ts'
import { runBenchmark } from './benchmark.ts'
import { DEFAULT_PROMPT } from './metrics.ts'
import { clearHistory, deleteResult, ensureDataDir, loadHistory } from './history.ts'
import { getLogBuffer, systemLog } from './logs.ts'
import { SCRIPT_FILE, PROMPT_FILE } from './config.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

/** Bundle del frontend (transpilado por el entry con Bun.build); lo inyecta el server. */
let appJsBundle = ''

/** El entry llama esto tras construir el bundle para que el router lo sirva. */
export function setFrontendBundle(js: string): void {
  appJsBundle = js
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
  if (path === '/prompt-default' && req.method === 'GET') {
    try {
      const content = await readFile(PROMPT_FILE, 'utf8')
      return new Response(content, { headers: { 'Content-Type': 'text/plain', ...CORS } })
    } catch {
      return new Response('Not found', { status: 404, headers: CORS })
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

  // ── Iniciar servidor manual ──
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
      const pid = await startServer(parsed)
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

  // ── Métricas de GPU en vivo ──
  if (path === '/gpu' && req.method === 'GET') {
    return json({ gpus: await readGpuStats() })
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
    let maxTokens = 2048
    try {
      const body = await req.json().catch(() => ({}))
      if (typeof body?.script === 'string') script = body.script
      if (typeof body?.prompt === 'string' && body.prompt.trim()) prompt = body.prompt
      if (typeof body?.max_tokens === 'number' && body.max_tokens > 0) maxTokens = body.max_tokens
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

  // ── Exportar/limpiar logs ──
  if (path === '/logs/clear' && req.method === 'POST') {
    getLogBuffer().length = 0
    return json({ ok: true })
  }

  // ── Frontend (bundle en memoria + estáticos) ──
  if (path === '/' || path === '/index.html') {
    return serveStatic('index.html', 'text/html; charset=utf-8')
  }
  if (path === '/app.js') {
    // Bundle transpilado en memoria (src/front/app.ts vía Bun.build).
    return new Response(appJsBundle, {
      headers: { 'Content-Type': 'application/javascript; charset=utf-8', ...CORS },
    })
  }
  if (path === '/style.css') {
    return serveStatic('style.css', 'text/css; charset=utf-8')
  }

  return new Response('Not found', { status: 404, headers: CORS })
}

/** Sirve un archivo estático desde public/. Protege contra path traversal. */
async function serveStatic(name: string, contentType: string): Promise<Response> {
  const staticRoot = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
  const filePath = join(staticRoot, name)
  // Protección path traversal: el path final debe seguir dentro de public/.
  if (!filePath.startsWith(staticRoot)) return new Response('Forbidden', { status: 403 })
  const file = Bun.file(filePath)
  if (!(await file.exists())) return new Response('Not found', { status: 404, headers: CORS })
  return new Response(file, {
    headers: { 'Content-Type': contentType, ...CORS },
  })
}

// existsSync re-export: el entry lo usa en el bootstrap para history.json.
export { existsSync }
