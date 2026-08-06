// Persistencia del historial de benchmarks (data/history.json).
// Cap de HISTORY_CAP entradas; sin paginación.
//
// El archivo se lee UNA vez y se mantiene en memoria: es la fuente de verdad
// durante la vida del proceso (usuario único, local). Las mutaciones (guardar,
// calificar, favorito, borrar) tocan el array y programan una escritura
// debounced, en vez de releer + reescribir el JSON entero en cada clic.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DATA_DIR, HISTORY_FILE, HISTORY_CAP } from './config.ts'
import { parseScript } from './script-parser.ts'
import type { BenchmarkResult } from './types.ts'

/** Ventana de agrupación de escrituras a disco. */
const FLUSH_DEBOUNCE_MS = 300

/** Historial en memoria. `null` hasta la primera carga. */
let cache: BenchmarkResult[] | null = null
let flushTimer: ReturnType<typeof setTimeout> | null = null
/** Escritura en curso, para poder esperarla en el cierre ordenado. */
let pendingFlush: Promise<void> = Promise.resolve()

export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

/**
 * Backfill (una sola vez, al cargar): las entradas guardadas antes de que el
 * parser cubriera `--hf-repo`/`--model`/`-m` tienen `config.model === null`
 * aunque el script sí traía el modelo. Re-parseamos el `script` guardado y, si
 * ahora resolvemos un modelo, lo inyectamos. Es idempotente.
 */
function backfillModel(results: BenchmarkResult[]): BenchmarkResult[] {
  for (const r of results) {
    const c = r.config
    if (c && c.model == null && typeof c.script === 'string' && c.script.length > 0) {
      try {
        const parsed = parseScript(c.script)
        if (parsed.model) r.config = { ...c, model: parsed.model }
      } catch {
        // Script inválido/irrelevante: se deja tal cual.
      }
    }
  }
  return results
}

/** Carga perezosa del archivo a memoria (una sola vez). */
async function ensureLoaded(): Promise<BenchmarkResult[]> {
  if (cache) return cache
  try {
    const parsed = JSON.parse(await readFile(HISTORY_FILE, 'utf8'))
    cache = backfillModel(Array.isArray(parsed) ? parsed : [])
  } catch {
    cache = []
  }
  return cache
}

/**
 * Programa la escritura del historial a disco. Varias mutaciones seguidas
 * (marcar estrellas, borrar en lote) colapsan en un único write.
 */
function scheduleFlush(): void {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimer = null
    pendingFlush = flushNow()
  }, FLUSH_DEBOUNCE_MS)
}

async function flushNow(): Promise<void> {
  if (!cache) return
  try {
    await ensureDataDir()
    await writeFile(HISTORY_FILE, JSON.stringify(cache, null, 2))
  } catch {
    // Disco lleno o permisos: el historial en memoria sigue siendo válido y el
    // siguiente cambio reintenta.
  }
}

/**
 * Fuerza la escritura pendiente y espera a que termine. La usa el cierre
 * ordenado (shutdown.ts) para no perder los últimos cambios.
 */
export async function flushHistory(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
    pendingFlush = flushNow()
  }
  await pendingFlush
}

/** Inserta un resultado al inicio del historial y trima al cap. */
export async function saveResult(r: BenchmarkResult): Promise<void> {
  const all = await ensureLoaded()
  all.unshift(r)
  if (all.length > HISTORY_CAP) all.length = HISTORY_CAP
  scheduleFlush()
}

/** Lee todo el historial (array; [] si no existe o está corrupto). */
export async function loadHistory(): Promise<BenchmarkResult[]> {
  return ensureLoaded()
}

/** Borra un resultado por id. */
export async function deleteResult(id: string): Promise<void> {
  const all = await ensureLoaded()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) return
  all.splice(idx, 1)
  scheduleFlush()
}

/** Borra múltiples resultados por ids (una sola escritura). */
export async function deleteResults(ids: string[]): Promise<void> {
  const set = new Set(ids)
  const all = await ensureLoaded()
  const next = all.filter((r) => !set.has(r.id))
  if (next.length === all.length) return
  all.length = 0
  all.push(...next)
  scheduleFlush()
}

/**
 * Actualiza la calificación (0-10) de un resultado por id.
 * `rating` null elimina la calificación. Devuelve el resultado actualizado, o
 * null si el id no existe o el valor está fuera de rango.
 */
export async function setRating(id: string, rating: number | null): Promise<BenchmarkResult | null> {
  const valid = rating == null || (Number.isFinite(rating) && rating >= 0 && rating <= 10)
  if (!valid) return null
  return update(id, (r) => ({ ...r, rating: rating ?? null }))
}

/**
 * Alterna la marca de favorito (corazón) de un resultado por id.
 * Devuelve el resultado actualizado, o null si el id no existe.
 */
export async function setFavorite(id: string, favorite: boolean): Promise<BenchmarkResult | null> {
  return update(id, (r) => ({ ...r, favorite }))
}

/** Aplica una transformación a un resultado por id y programa la escritura. */
async function update(id: string, fn: (r: BenchmarkResult) => BenchmarkResult): Promise<BenchmarkResult | null> {
  const all = await ensureLoaded()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) return null
  const next = fn(all[idx]!)
  all[idx] = next
  scheduleFlush()
  return next
}

/** Vacía todo el historial. */
export async function clearHistory(): Promise<void> {
  const all = await ensureLoaded()
  all.length = 0
  scheduleFlush()
}
