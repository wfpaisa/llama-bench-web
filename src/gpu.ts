// Métricas de GPU (NVIDIA + AMD), ambas Linux-only.
//
// 1. NVIDIA: nvidia-smi con query CSV.
// 2. AMD: lectura de sysfs (/sys/class/drm/card*/device/mem_info_*).

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'bun'
import type { GpuInfo } from './types.ts'

/** Lee GPUs NVIDIA vía nvidia-smi. Devuelve [] si nvidia-smi no está disponible. */
async function readNvidiaGpus(): Promise<GpuInfo[]> {
  let out = ''
  try {
    const p = spawn({
      cmd: ['nvidia-smi', '--query-gpu=index,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout] = await Promise.all([new Response(p.stdout).text()])
    out = stdout
    await p.exited
  } catch {
    return []
  }
  const gpus: GpuInfo[] = []
  for (const raw of out.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const parts = line.split(',').map((s) => s.trim())
    if (parts.length < 4) continue
    gpus.push({
      index: `nvidia${parts[0]}`,
      vendor: 'nvidia',
      gpuUtilPct: numOrNull(parts[1]),
      memUsedMiB: numOrNull(parts[2]),
      memTotalMiB: numOrNull(parts[3]),
    })
  }
  return gpus
}

/**
 * Tarjetas AMD detectadas, cacheadas tras el primer sondeo. La enumeración
 * (readdir de /sys/class/drm + lectura del vendor de cada card) no cambia
 * mientras el proceso vive, así que repetirla en cada poll de 4s es trabajo
 * inútil: solo se conservan las rutas ya validadas.
 */
let amdCards: { card: string; dev: string }[] | null = null

/** Enumera las tarjetas AMD de sysfs (una sola vez). */
async function discoverAmdCards(): Promise<{ card: string; dev: string }[]> {
  if (amdCards) return amdCards
  const base = '/sys/class/drm'
  const found: { card: string; dev: string }[] = []
  let cards: string[]
  try {
    cards = await readdir(base)
  } catch {
    amdCards = found
    return found
  }
  for (const c of cards) {
    if (!c.startsWith('card') || c.includes('-')) continue // card0, no card0-DP-1
    if (Number.isNaN(Number(c.replace('card', '')))) continue
    const dev = join(base, c, 'device')
    // Solo AMD.
    let vendor = ''
    try {
      vendor = (await readFile(join(dev, 'vendor'), 'utf8')).trim()
    } catch {
      continue
    }
    if (!vendor.includes('0x1002') && !/amd|advanced micro/i.test(vendor)) continue
    found.push({ card: c, dev })
  }
  amdCards = found
  return found
}

/** Lee VRAM/util de GPUs AMD vía sysfs (sin depender de radeontop). */
async function readAmdGpus(): Promise<GpuInfo[]> {
  const gpus: GpuInfo[] = []
  for (const { card, dev } of await discoverAmdCards()) {
    const gi: GpuInfo = {
      index: `amdgpu-${card}`,
      vendor: 'amd',
      memUsedMiB: null,
      memTotalMiB: null,
      gpuUtilPct: null,
    }
    const [used, total, util] = await Promise.all([
      readNumFile(join(dev, 'mem_info_vram_used')),
      readNumFile(join(dev, 'mem_info_vram_total')),
      readNumFile(join(dev, 'gpu_busy_percent')),
    ])
    if (used !== null) gi.memUsedMiB = used / (1024 * 1024)
    if (total !== null) gi.memTotalMiB = total / (1024 * 1024)
    if (util !== null) gi.gpuUtilPct = util
    // La tarjeta desapareció (hot-unplug / driver recargado): reenumerar luego.
    if (used === null && total === null) amdCards = null
    gpus.push(gi)
  }
  return gpus
}

async function readNumFile(p: string): Promise<number | null> {
  try {
    const s = (await readFile(p, 'utf8')).trim()
    const n = Number(s)
    return Number.isFinite(n) ? n : null
  } catch {
    return null
  }
}
function numOrNull(s: string): number | null {
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** Combina GPUs NVIDIA + AMD detectadas. */
export async function readGpuStats(): Promise<GpuInfo[]> {
  const [nv, amd] = await Promise.all([readNvidiaGpus(), readAmdGpus()])
  return [...nv, ...amd]
}

/**
 * Resta la baseline de GPU stats para obtener solo el delta consumido por el
 * benchmark (VRAM ya en uso antes de arrancar el modelo).
 */
export function subtractGpuBaseline(final: GpuInfo[], baseline: GpuInfo[]): GpuInfo[] {
  const baselineMap = new Map(baseline.map((g) => [g.index, g]))
  return final.map((g) => {
    const base = baselineMap.get(g.index)
    if (!base) return { ...g }
    const usedDelta = g.memUsedMiB !== null && base.memUsedMiB !== null ? Math.max(0, g.memUsedMiB - base.memUsedMiB) : g.memUsedMiB
    return {
      ...g,
      memUsedMiB: usedDelta,
    }
  })
}
