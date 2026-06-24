// Persistencia del historial de benchmarks (data/history.json).
// Cap de HISTORY_CAP entradas; sin paginación.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DATA_DIR, HISTORY_FILE, HISTORY_CAP } from "./config.ts";
import type { BenchmarkResult } from "./types.ts";

async function ensureDataDir(): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
}

/** Inserta un resultado al inicio del historial y trima al cap. */
export async function saveResult(r: BenchmarkResult): Promise<void> {
  await ensureDataDir();
  const all = await loadHistory();
  all.unshift(r);
  const trimmed = all.slice(0, HISTORY_CAP);
  await writeFile(HISTORY_FILE, JSON.stringify(trimmed, null, 2));
}

/** Lee todo el historial (array; [] si no existe o está corrupto). */
export async function loadHistory(): Promise<BenchmarkResult[]> {
  try {
    return JSON.parse(await readFile(HISTORY_FILE, "utf8"));
  } catch {
    return [];
  }
}

/** Borra un resultado por id. */
export async function deleteResult(id: string): Promise<void> {
  const all = await loadHistory();
  const next = all.filter((r) => r.id !== id);
  await writeFile(HISTORY_FILE, JSON.stringify(next, null, 2));
}

/** Vacía todo el historial. */
export async function clearHistory(): Promise<void> {
  await ensureDataDir();
  await writeFile(HISTORY_FILE, "[]");
}

export { ensureDataDir };
