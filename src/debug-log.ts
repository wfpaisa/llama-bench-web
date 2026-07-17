// Dump de diagnóstico del benchmark: vuelca las últimas líneas del slice de
// logs a data/log_debug.txt tras cada run.
//
// Motivo: las métricas de timing (prompt/eval time) llegan null de forma
// intermitente. Sin ver qué hay realmente en el buffer en el momento del
// parseo, no podemos saber si las líneas `print_timing` llegaron tarde, se
// truncaron, cambiaron de formato o nunca existieron. Este archivo captura ese
// contexto para diagnóstico, sobrescribiéndose en cada benchmark.

import { writeFile } from 'node:fs/promises'
import type { LogEntry } from './types.ts'
import type { ParsedMetrics } from './metrics.ts'
import { ensureDataDir } from './history.ts'
import { DEBUG_LOG_FILE, DEBUG_LOG_TAIL_LINES } from './config.ts'

/**
 * Vuelca a data/log_debug.txt el tail del slice de logs del benchmark junto con
 * un resumen de las métricas parseadas. Sobrescribe el archivo en cada llamada.
 *
 * @param lines    Slice de logs relevante del benchmark (desde logStartIndex).
 * @param metrics  Métricas parseadas al final del run (para ver qué quedó null).
 * @param extra    Líneas extra a anteponer (p.ej. errores, contexto del run).
 */
export async function dumpDebugLog(lines: LogEntry[], metrics: ParsedMetrics, extra: string[] = []): Promise<void> {
  await ensureDataDir()
  const header = [
    `# log_debug.txt — volcado del último benchmark`,
    `# Generado: ${new Date().toISOString()}`,
    `# Líneas en el slice: ${lines.length}`,
    `# Mostrando las últimas ${DEBUG_LOG_TAIL_LINES} líneas.`,
    ``,
    `## Métricas parseadas (null = no encontrada en el slice)`,
    JSON.stringify(metrics, null, 2),
    ``,
    ...(extra.length ? [...extra, ``] : []),
    `## Slice de logs (cola)`,
    ``,
  ]
  const tail = lines.slice(-DEBUG_LOG_TAIL_LINES)
  const body = tail
    .map((l) => {
      const tag = l.stream === 'system' ? '[system] ' : ''
      return `${tag}${l.msg}`
    })
    .join('\n')
  const content = [...header, body, ''].join('\n')
  try {
    await writeFile(DEBUG_LOG_FILE, content, 'utf8')
  } catch {
    // El dump es best-effort: nunca debe romper el flujo del benchmark.
  }
}
