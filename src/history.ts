// Persistencia del historial de benchmarks (data/history.json).
// Cap de HISTORY_CAP entradas; sin paginación.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DATA_DIR, HISTORY_FILE, HISTORY_CAP } from './config.ts'
import { parseScript } from './script-parser.ts'
import type { BenchmarkResult } from './types.ts'

export async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
}

/** Inserta un resultado al inicio del historial y trima al cap. */
export async function saveResult(r: BenchmarkResult): Promise<void> {
  await ensureDataDir()
  const all = await loadHistory()
  all.unshift(r)
  const trimmed = all.slice(0, HISTORY_CAP)
  await writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2))
}

/**
 * Backfill en memoria (sin tocar el JSON en disco): las entradas guardadas
 * antes de que el parser cubriera `--hf-repo`/`--model`/`-m` tienen
 * `config.model === null` aunque el script sí traía el modelo. Re-parseamos el
 * `script` guardado y, si ahora resolvemos un modelo, lo inyectamos en la copia
 * en memoria. Es idempotente y solo afecta al render.
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

/** Lee todo el historial (array; [] si no existe o está corrupto). */
export async function loadHistory(): Promise<BenchmarkResult[]> {
  try {
    return backfillModel(JSON.parse(await readFile(HISTORY_FILE, 'utf8')))
  } catch {
    return []
  }
}

/** Borra un resultado por id. */
export async function deleteResult(id: string): Promise<void> {
  const all = await loadHistory()
  const next = all.filter((r) => r.id !== id)
  await writeFile(HISTORY_FILE, JSON.stringify(next, null, 2))
}

/** Borra múltiples resultados por ids (un solo rewrite). */
export async function deleteResults(ids: string[]): Promise<void> {
  const set = new Set(ids)
  const all = await loadHistory()
  const next = all.filter((r) => !set.has(r.id))
  await writeFile(HISTORY_FILE, JSON.stringify(next, null, 2))
}

/**
 * Actualiza la calificación (0-10) de un resultado por id.
 * `rating` null elimina la calificación. Devuelve false si el id no existe.
 */
export async function setRating(id: string, rating: number | null): Promise<boolean> {
  const all = await loadHistory()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) return false
  // Validar rango 0-10 (o null para "sin calificar").
  const valid = rating == null || (Number.isFinite(rating) && rating >= 0 && rating <= 10)
  if (!valid) return false
  all[idx] = { ...all[idx], rating: rating ?? null }
  await writeFile(HISTORY_FILE, JSON.stringify(all, null, 2))
  return true
}

/**
 * Alterna la marca de favorito (corazón) de un resultado por id.
 * Devuelve false si el id no existe.
 */
export async function setFavorite(id: string, favorite: boolean): Promise<boolean> {
  const all = await loadHistory()
  const idx = all.findIndex((r) => r.id === id)
  if (idx === -1) return false
  all[idx] = { ...all[idx], favorite }
  await writeFile(HISTORY_FILE, JSON.stringify(all, null, 2))
  return true
}

/** Vacía todo el historial. */
export async function clearHistory(): Promise<void> {
  await ensureDataDir()
  await writeFile(HISTORY_FILE, '[]')
}
