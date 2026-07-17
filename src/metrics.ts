// Parsing de métricas desde los logs de llama-server + health-check del server.
//
// El parsing es regex-based y FRÁGIL: depende del formato exacto de salida del
// binario. Si una regex no matchea, la métrica queda null.

import type { LogEntry } from './types.ts'
import { systemLog } from './logs.ts'

/** Métricas extraídas de los logs de un run. */
export interface ParsedMetrics {
  promptTokensPerSecond: number | null
  /** Cantidad de tokens del prompt (nº tras "/" en "prompt eval time"). */
  promptTokenCount: number | null
  /** Tiempo de procesado del prompt en ms ("prompt eval time = X ms"). */
  promptEvalTimeMs: number | null
  generationTokensPerSecond: number | null
  /** Cantidad de tokens generados (nº tras "/" en "eval time"). */
  generationTokenCount: number | null
  draftAcceptance: number | null
  genDrafts: number | null
  accDrafts: number | null
  loadTimeSeconds: number | null
  /** Tiempo de generación (eval time) en ms, sin incluir prompt ni startup. */
  generationTimeMs: number | null
}

/** Prompt por defecto del benchmark — exige razonamiento real del modelo. */
export const DEFAULT_PROMPT = `Un agricultor tiene 17 ovejas. Todas menos 9 se escapan. ¿Cuántas ovejas le quedan? Explica tu razonamiento paso a paso.

Luego resuelve esto sin calculadora: ¿cuántos números primos hay entre 20 y 40? Lista cada uno y verifica brevemente por qué es primo.`

/** Sleep tipado. */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// ── Health-check del servidor ──────────────────────────────────────────────────
const HEALTH_POLL_MS = 500
const HEALTH_TIMEOUT_MS = 120_000 // 2 min para modelos muy grandes.

/**
 * Hace polling a `GET /health` (o `GET /`) hasta que responda 200.
 * Los últimos llama.cpp exponen /health; si no existe, cae a "/".
 */
export async function waitForServer(base: string, signal?: AbortSignal): Promise<void> {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS
  for (;;) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    try {
      const resp = await fetch(`${base}/health`, {
        signal: AbortSignal.timeout(3000),
      })
      if (resp.ok) return
      // 404: endpoint no existe, probamos con "/".
      if (resp.status === 404) {
        const resp2 = await fetch(base, { signal: AbortSignal.timeout(3000) })
        if (resp2.ok) return
      }
      systemLog(`benchmark: health-check respondió ${resp.status}, reintentando…`)
    } catch {
      // Connection refused / timeout — esperado mientras arranca.
    }
    if (Date.now() >= deadline) {
      throw new Error(`Servidor no respondió tras ${(HEALTH_TIMEOUT_MS / 1000).toFixed(0)}s`)
    }
    await sleep(HEALTH_POLL_MS)
  }
}

/** Extrae métricas de las líneas de log relevantes (recorre desde el final). */
export function parseMetricsFromLogs(lines: LogEntry[]): ParsedMetrics {
  const m: ParsedMetrics = {
    promptTokensPerSecond: null,
    promptTokenCount: null,
    promptEvalTimeMs: null,
    generationTokensPerSecond: null,
    generationTokenCount: null,
    draftAcceptance: null,
    genDrafts: null,
    accDrafts: null,
    loadTimeSeconds: null,
    generationTimeMs: null,
  }
  // Tomamos desde el final para quedarnos con la última medición.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i].msg
    if (m.promptTokensPerSecond === null) {
      const mm = l.match(/prompt eval time.*?(\d+(?:\.\d+)?)\s*tokens per second/i)
      if (mm) m.promptTokensPerSecond = Number(mm[1])
    }
    if (m.promptEvalTimeMs === null) {
      const mm = l.match(/prompt eval time\s*=\s*(\d+(?:\.\d+)?)\s*ms/i)
      if (mm) m.promptEvalTimeMs = Number(mm[1])
    }
    if (m.promptTokenCount === null) {
      const mm = l.match(/prompt eval time.*?\/\s*(\d+)\s*tokens/i)
      if (mm) m.promptTokenCount = Number(mm[1])
    }
    if (m.generationTokensPerSecond === null) {
      const mm = l.match(/eval time.*?(\d+(?:\.\d+)?)\s*tokens per second/i)
      if (mm) m.generationTokensPerSecond = Number(mm[1])
    }
    if (m.generationTokenCount === null) {
      const mm = l.match(/(?<!prompt )eval time.*?\/\s*(\d+)\s*tokens/i)
      if (mm) m.generationTokenCount = Number(mm[1])
    }
    if (m.generationTimeMs === null) {
      const mm = l.match(/(?<!prompt )eval time\s*=\s*(\d+(?:\.\d+)?)\s*ms/i)
      if (mm) m.generationTimeMs = Number(mm[1])
    }
    if (m.draftAcceptance === null) {
      const mm = l.match(/draft acceptance\s*=?\s*([0-9.]+)/i)
      if (mm) m.draftAcceptance = Number(mm[1])
    }
    // draft-mtp: drafts generados (#gen drafts) y aceptados (#acc drafts).
    // Dos formatos según la versión de llama-server:
    //   - Formato nuevo (post-merge draft-mtp): los contadores van embebidos en
    //     la línea de draft acceptance:
    //       draft acceptance = 0.82667 ( 1240 accepted /  1500 generated), mean len =  2.65
    //     Aquí "generated"/"accepted" son drafts (pasos de decodificación
    //     especulativa), no tokens individuales.
    //   - Formato antiguo (pre-merge): una línea dedicada con #gen drafts / #acc drafts.
    if (m.genDrafts === null) {
      const mm = l.match(/draft acceptance\s*=\s*[0-9.]+\s*\(\s*(\d+)\s*accepted\s*\/\s*(\d+)\s*generated/i)
      if (mm) {
        m.accDrafts = Number(mm[1])
        m.genDrafts = Number(mm[2])
      } else {
        const mm2 = l.match(/draft-mtp:.*?#gen drafts\s*=\s*(\d+).*?#acc drafts\s*=\s*(\d+)/i)
        if (mm2) {
          m.genDrafts = Number(mm2[1])
          m.accDrafts = Number(mm2[2])
        }
      }
    }
    if (m.loadTimeSeconds === null) {
      const mm = l.match(/model loaded.*?([0-9.]+)\s*ms/i)
      if (mm) m.loadTimeSeconds = Number(mm[1]) / 1000
    }
    if (
      m.promptTokensPerSecond !== null &&
      m.promptTokenCount !== null &&
      m.promptEvalTimeMs !== null &&
      m.generationTokensPerSecond !== null &&
      m.generationTokenCount !== null &&
      m.draftAcceptance !== null &&
      m.genDrafts !== null &&
      m.loadTimeSeconds !== null &&
      m.generationTimeMs !== null
    ) {
      break
    }
  }
  // Fallback de load time: medir entre "loading model" y "model loaded".
  // En builds recientes de llama-server "model loaded" viene SIN los ms (la
  // regex principal de arriba no matchea), así que este delta de timestamps es
  // la fuente principal de load time.
  if (m.loadTimeSeconds === null) {
    let loadingIdx = -1
    let loadedIdx = -1
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i].msg.toLowerCase()
      if (loadingIdx === -1 && l.includes('loading model')) loadingIdx = i
      if (l.includes('model loaded')) loadedIdx = i
    }
    if (loadingIdx >= 0 && loadedIdx > loadingIdx) {
      m.loadTimeSeconds = (lines[loadedIdx].t - lines[loadingIdx].t) / 1000
    }
  }
  return m
}

/**
 * Hace polling del buffer de logs hasta que aparezcan las métricas de timing de
 * generación, o hasta agotar el timeout.
 *
 * Las líneas `print_timing` (prompt/eval time) se emiten al stdout de
 * llama-server DESPUÉS de que la respuesta HTTP ya fue enviada, en la fase de
 * "release" del slot. Un `sleep` fijo es frágil: a veces las líneas llegan
 * >400 ms tarde y el parseo pilla el buffer antes de tiempo → todas las
 * métricas quedan null (race condition intermitente). Este polling espera
 * activamente hasta ver la señal fiable de fin (tokens/s de generación, que es
 * la última línea en emitirse) o un timeout de seguridad.
 *
 * @param readLines  Getter fresco del slice de logs a parsear (se relee en cada
 *                   iteración porque el buffer sigue creciendo).
 * @param signal     AbortSignal para cancelar el wait (p.ej. benchmark cancelado).
 * @param timeoutMs  Máximo a esperar antes de rendirse (default 5s).
 * @param pollMs     Intervalo entre reintentos (default 150ms).
 */
export async function pollMetricsUntilReady(readLines: () => LogEntry[], signal?: AbortSignal, timeoutMs: number = 5000, pollMs: number = 150): Promise<ParsedMetrics> {
  const deadline = Date.now() + timeoutMs
  let parsed = parseMetricsFromLogs(readLines())
  // generationTokensPerSecond es la señal más fiable de fin: "eval time … X
  // tokens per second" se imprime al final del todo. Si el modelo no generó,
  // se agota el timeout y se devuelven las métricas (parciales o null).
  while (parsed.generationTokensPerSecond === null && Date.now() < deadline && !signal?.aborted) {
    await sleep(pollMs)
    parsed = parseMetricsFromLogs(readLines())
  }
  return parsed
}
