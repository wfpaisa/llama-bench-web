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
  genTokens: number | null
  accTokens: number | null
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
    genTokens: null,
    accTokens: null,
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
    // draft-mtp: una sola línea con #gen drafts, #acc drafts, #gen tokens, #acc tokens.
    //   statistics        draft-mtp: #calls(b,g,a) = ..., #gen drafts =  418,
    //   #acc drafts = 403, #gen tokens = 836, #acc tokens = 783, ...
    if (m.genDrafts === null) {
      const mm = l.match(/draft-mtp:.*?#gen drafts\s*=\s*(\d+).*?#acc drafts\s*=\s*(\d+).*?#gen tokens\s*=\s*(\d+).*?#acc tokens\s*=\s*(\d+)/i)
      if (mm) {
        m.genDrafts = Number(mm[1])
        m.accDrafts = Number(mm[2])
        m.genTokens = Number(mm[3])
        m.accTokens = Number(mm[4])
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
