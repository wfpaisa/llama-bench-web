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

/** Lee VRAM/util de GPUs AMD vía sysfs (sin depender de radeontop). */
async function readAmdGpus(): Promise<GpuInfo[]> {
  const gpus: GpuInfo[] = []
  const base = '/sys/class/drm'
  let cards: string[]
  try {
    cards = await readdir(base)
  } catch {
    return []
  }
  for (const c of cards) {
    if (!c.startsWith('card') || c.includes('-')) continue // card0, no card0-DP-1
    const idx = Number(c.replace('card', ''))
    if (Number.isNaN(idx)) continue
    const dev = join(base, c, 'device')
    const memUsedPath = join(dev, 'mem_info_vram_used')
    const memTotalPath = join(dev, 'mem_info_vram_total')
    const utilPath = join(dev, 'gpu_busy_percent')
    const vendorPath = join(dev, 'vendor')
    // Solo AMD.
    let vendor = ''
    try {
      vendor = (await readFile(vendorPath, 'utf8')).trim()
    } catch {
      continue
    }
    if (!vendor.includes('0x1002') && !/amd|advanced micro/i.test(vendor)) continue
    const gi: GpuInfo = {
      index: `amdgpu-${c}`,
      vendor: 'amd',
      memUsedMiB: null,
      memTotalMiB: null,
      gpuUtilPct: null,
    }
    const used = await readNumFile(memUsedPath)
    const total = await readNumFile(memTotalPath)
    const util = await readNumFile(utilPath)
    if (used !== null) gi.memUsedMiB = used / (1024 * 1024)
    if (total !== null) gi.memTotalMiB = total / (1024 * 1024)
    if (util !== null) gi.gpuUtilPct = util
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
