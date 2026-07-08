// Benchmark real contra la API de llama-server.
//
// Orquesta el ciclo completo: parse → spawn → health-check → request →
// parseo de métricas → GPU stats → persist → kill.

import type { BenchmarkResult, ParsedScript } from './types.ts'
import { parseScript } from './script-parser.ts'
import { readGpuStats, subtractGpuBaseline } from './gpu.ts'
import { readRamStats, subtractRamBaseline } from './mem.ts'
import { listDevices, detectBackend, computeDeviceVram } from './devices.ts'
import { DEFAULT_PROMPT, pollMetricsUntilReady, waitForServer } from './metrics.ts'
import { startServer, stopServer, urlFor, assertBinaryExists } from './server-manager.ts'
import { saveResult } from './history.ts'
import { systemLog } from './logs.ts'
import { getLogBuffer } from './logs.ts'
import { emptyParsedScript, setBenchAbortController } from './state.ts'
import { dumpDebugLog } from './debug-log.ts'

/**
 * Ejecuta un benchmark completo contra llama-server.
 * Garantiza que el servidor se detenga al final (finally).
 */
export async function runBenchmark(script: string, prompt: string, maxTokens: number | null = 2048): Promise<BenchmarkResult> {
  const errors: string[] = []

  // 0) Parsear el script. Si falla, no hay nada que ejecutar.
  let parsed: ParsedScript
  try {
    parsed = parseScript(script)
  } catch (e) {
    return finalize(null, prompt, [`Script inválido: ${(e as Error).message}`])
  }

  // 0a) Validar que el binario exista antes de hacer nada: evita un ENOENT
  //     críptico de posix_spawn en startServer y da un mensaje accionable.
  try {
    assertBinaryExists(parsed.binary)
  } catch (e) {
    return finalize(parsed, prompt, [(e as Error).message])
  }

  // Marcador: índice del log desde el cual parsear al final.
  const logStartIndex = getLogBuffer().length

  // 0b) Capturar baseline de GPU y RAM antes de iniciar (para restar lo ya en uso).
  //     También enumeramos los devices del backend (--list-devices) para medir el
  //     delta de VRAM libre consumido por el modelo al final.
  const [gpuBaseline, ramBaseline, baselineDevices] = await Promise.all([readGpuStats(), readRamStats(), listDevices(parsed.binary)])

  // Inicializar AbortController para permitir cancelación desde la UI.
  const controller = new AbortController()
  setBenchAbortController(controller)

  const checkAbort = (): void => {
    if (controller.signal.aborted) {
      systemLog('benchmark: cancelado por el usuario.')
      throw new Error('Benchmark cancelado por el usuario.')
    }
  }

  // 1) Arrancar servidor.
  systemLog('benchmark: iniciando llama-server…')
  let m
  try {
    m = await startServer(parsed)
  } catch (e) {
    errors.push(`No se pudo iniciar el servidor: ${(e as Error).message}`)
    return finalize(parsed, prompt, errors)
  }

  try {
    checkAbort()

    // 1b) Esperar que el proceso quede "ready". Si muere durante el arranque
    //     (modelo inválido, OOM, crash…), `ready` se rechaza al instante con el
    //     exit code, evitando los 120s de health-check inútil. Al estar dentro
    //     del try/finally, el rechazo propaga al router (→ toast de error) y el
    //     finally detiene el servidor.
    //
    //     Además, await m.ready NO observa el AbortController, así que hacemos
    //     un race contra la señal: si el usuario cancela (o el formato del log
    //     de ready cambia y nunca se detecta), el await se rompe igual y el
    //     finally puede detener el servidor. Sin esto, "Detener" no tendría
    //     efecto durante la fase de arranque.
    try {
      await Promise.race([
        m.ready,
        new Promise<never>((_, rej) => {
          if (controller.signal.aborted) rej(new Error('Benchmark cancelado por el usuario.'))
          controller.signal.addEventListener('abort', () => rej(new Error('Benchmark cancelado por el usuario.')), { once: true })
        }),
      ])
    } catch (e) {
      checkAbort() // Si fue abort del usuario → lanza el error canónico de cancelación.
      throw new Error(`El servidor no arrancó: ${(e as Error).message}. ` + 'Revisá el script, su formato y los flags (binario, modelo, rutas, comillas, continuaciones \\).')
    }
    checkAbort()

    // 2) Esperar que el servidor acepte conexiones HTTP.
    //    "server is listening" puede aparecer antes de que el socket esté
    //    realmente listo, especialmente con modelos grandes.
    const base = urlFor(parsed)
    await waitForServer(base, controller.signal)
    checkAbort()
    systemLog('benchmark: servidor responde, ejecutando request…')

    // 3) Request de benchmark. Se omite cualquier parámetro de sampling que
    //    no estuviera en el script (temp/topP/topK = null).
    //    max_tokens: null (checkbox "Limitar" desactivado en la UI) se traduce
    //    a -1, que en llama-server significa "generar hasta EOS" (sin límite);
    //    un number > 0 se envía tal cual. Omitir el campo NO sirve: llama-server
    //    aplicaría su default interno (n_predict) y cortaría la respuesta.
    const body: Record<string, unknown> = {
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens === null ? -1 : maxTokens,
      stream: false,

      // Parametros adicionales
      // return_progress: true,
      // reasoning_format: 'auto',
      // chat_template_kwargs: { enable_thinking: true }, // deshabilitar thinking en false
      // thinking_budget_tokens: 512, // en max quitar este parametro
      // reasoning_control: true,
      //  backend_sampling: false,
      // timings_per_token: true,
    }
    if (parsed.model) {
      body.model = parsed.model.split(':')[0] ?? parsed.model
    }
    if (parsed.temp !== null) body.temperature = parsed.temp
    if (parsed.topP !== null) body.top_p = parsed.topP
    if (parsed.topK !== null) body.top_k = parsed.topK

    const t0 = performance.now()
    let responseText = ''
    try {
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      if (!resp.ok) {
        errors.push(`HTTP ${resp.status} en /v1/chat/completions`)
      } else {
        const data = await resp.json()
        const msg = data?.choices?.[0]?.message
        const content = msg?.content ?? ''
        const reasoning = msg?.reasoning_content ?? ''
        responseText = content || reasoning || ''
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e
      errors.push(`Fallo en request: ${(e as Error).message}`)
    }
    const requestLatencyMs = performance.now() - t0

    checkAbort()

    // 4) Parsear métricas de logs.
    //    Las líneas `print_timing` (prompt/eval time) se emiten al stdout de
    //    llama-server DESPUÉS de enviar la respuesta HTTP, en la fase de
    //    "release" del slot. Un `sleep` fijo es frágil: a veces las líneas
    //    llegan tarde y el parseo pilla el buffer antes de tiempo → todas las
    //    métricas quedan null. Hacemos polling hasta ver la señal fiable de fin
    //    (tokens/s de generación) o un timeout de seguridad.
    const relevantLines = getLogBuffer().slice(logStartIndex)
    const parsedMetrics = await pollMetricsUntilReady(() => getLogBuffer().slice(logStartIndex), controller.signal)

    // 5) GPU y RAM stats finales y restar baseline.
    const [gpusFinal, ramFinal] = await Promise.all([readGpuStats(), readRamStats()])
    const gpus = subtractGpuBaseline(gpusFinal, gpuBaseline)
    const ramUsedMiB = subtractRamBaseline(ramFinal, ramBaseline)

    // 5b) Devices del backend con el modelo aún cargado: delta de VRAM libre
    //     consumido por el modelo, filtrado por --device. El backend (cuda/
    //     vulkan/…) se deduce del id del device.
    const finalDevices = await listDevices(parsed.binary)
    const deviceVram = computeDeviceVram(baselineDevices, finalDevices, parsed.device)
    const backend = detectBackend(baselineDevices)

    const result: BenchmarkResult = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      config: parsed,
      promptTokensPerSecond: parsedMetrics.promptTokensPerSecond,
      promptTokenCount: parsedMetrics.promptTokenCount,
      promptEvalTimeMs: parsedMetrics.promptEvalTimeMs,
      generationTokensPerSecond: parsedMetrics.generationTokensPerSecond,
      generationTokenCount: parsedMetrics.generationTokenCount,
      draftAcceptance: parsedMetrics.draftAcceptance,
      genDrafts: parsedMetrics.genDrafts,
      accDrafts: parsedMetrics.accDrafts,
      genTokens: parsedMetrics.genTokens,
      accTokens: parsedMetrics.accTokens,
      loadTimeSeconds: parsedMetrics.loadTimeSeconds,
      generationTimeMs: parsedMetrics.generationTimeMs,
      requestLatencyMs,
      prompt,
      response: responseText,
      gpus,
      backend: backend === 'unknown' ? null : backend,
      deviceVram,
      ramUsedMiB,
      errors,
    }

    // 5c) Dump de diagnóstico: vuelca las últimas líneas del slice + métricas a
    //     data/log_debug.txt (sobrescribe en cada run). Best-effort: si falla,
    //     no rompe el flujo.
    const nullMetrics = Object.entries(parsedMetrics)
      .filter(([, v]) => v === null)
      .map(([k]) => k)
    const debugExtra = [
      `## Contexto del run`,
      `- requestLatencyMs: ${requestLatencyMs.toFixed(0)}`,
      `- maxTokens: ${maxTokens === null ? 'null (EOS)' : maxTokens}`,
      `- líneas en el slice: ${relevantLines.length}`,
      `- métricas en null: ${nullMetrics.length ? nullMetrics.join(', ') : 'ninguna'}`,
    ]
    await dumpDebugLog(relevantLines, parsedMetrics, debugExtra)

    await saveResult(result)
    systemLog('benchmark: finalizado y guardado.')
    return result
  } finally {
    // 6) Detener el servidor automáticamente.
    await stopServer()
    setBenchAbortController(null)
  }
}

/** Construye un resultado "fallido" (sin métricas) para errores tempranos. */
function finalize(parsed: ParsedScript | null, prompt: string, errors: string[]): BenchmarkResult {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    config: parsed ?? emptyParsedScript(),
    promptTokensPerSecond: null,
    promptTokenCount: null,
    promptEvalTimeMs: null,
    generationTokensPerSecond: null,
    generationTokenCount: null,
    draftAcceptance: null,
    genDrafts: null,
    accDrafts: null,
    genTokens: null,
    accTokens: null,
    loadTimeSeconds: null,
    generationTimeMs: null,
    requestLatencyMs: null,
    prompt,
    response: '',
    gpus: [],
    backend: null,
    deviceVram: [],
    ramUsedMiB: null,
    errors,
  }
}

export { DEFAULT_PROMPT }
