// Métricas de RAM del sistema (Linux-only, vía /proc/meminfo).
//
// Lee MemTotal y MemAvailable; deriva `used = total - available`.
// Si no es Linux o no se puede leer /proc/meminfo, devuelve todo null
// (mismo patrón defensivo que src/gpu.ts).

import { readFile } from 'node:fs/promises'
import type { RamInfo } from './types.ts'

const MEMINFO = '/proc/meminfo'

/** Lee y parsea /proc/meminfo; devuelve null si no está disponible. */
async function parseMeminfo(): Promise<Map<string, number> | null> {
  let raw: string
  try {
    raw = await readFile(MEMINFO, 'utf8')
  } catch {
    return null
  }
  const map = new Map<string, number>()
  for (const line of raw.split('\n')) {
    // Formato: "Clave:   12345 kB"
    const m = line.match(/^(\w+):\s+(\d+)\s*kB?/i)
    if (m) map.set(m[1], Number(m[2]))
  }
  return map
}

/** kB → MiB. */
function kbToMiB(kb: number | undefined | null): number | null {
  if (kb == null || !Number.isFinite(kb)) return null
  return kb / 1024
}

/** Lee la RAM total/disponible/usada del sistema. Linux-only. */
export async function readRamStats(): Promise<RamInfo> {
  const info = await parseMeminfo()
  if (!info) return { memTotalMiB: null, memUsedMiB: null, memAvailableMiB: null }

  const totalMiB = kbToMiB(info.get('MemTotal'))
  const availableMiB = kbToMiB(info.get('MemAvailable'))
  // used = total - available. Si falta alguno, no podemos derivarlo.
  let usedMiB: number | null = null
  if (totalMiB != null && availableMiB != null) {
    usedMiB = Math.max(0, totalMiB - availableMiB)
  }
  return { memTotalMiB: totalMiB, memUsedMiB: usedMiB, memAvailableMiB: availableMiB }
}
