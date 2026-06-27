// Enumeración de devices del backend de llama-server vía `--list-devices`.
//
// A diferencia de gpu.ts (que usa nvidia-smi/sysfs, id del SO), este módulo
// pregunta directamente al binario: devuelve los ids del BACKEND (CUDA0,
// Vulkan0, …) que son los que aparecen en el flag `--device`. Así devices y
// VRAM del historial quedan alineados, y se cubren vendors que sysfs/nvidia-smi
// no miden (p.ej. Intel vía Vulkan).
//
// El VRAM *usado por el modelo* se deriva del delta de VRAM libre reportada por
// el propio binario (baseline.free − final.free), medido antes/después de
// cargar el modelo durante el benchmark.

import { spawn } from 'bun'
import type { GpuBackend, LlamaDevice, DeviceVram } from './types.ts'
import { binaryRuntimeEnv } from './server-manager.ts'

/** Timeout para --list-devices: el binario debe responder casi al instante. */
const LIST_DEVICES_TIMEOUT_MS = 15_000

/**
 * Ejecuta `binary --list-devices` y parsea la lista de devices del backend.
 * Devuelve [] si el binario no existe, falla, o su salida no matchea el formato.
 *
 * Formato esperado (líneas bajo "Available devices:"):
 *   Vulkan0: AMD Radeon RX 6600 (RADV NAVI23) (8176 MiB, 5359 MiB free)
 *   CUDA0: NVIDIA GeForce RTX 5070 Ti (15880 MiB, 15621 MiB free)
 * El nombre puede contener paréntesis internos (RADV NAVI23, Intel(R)); por eso
 * el grupo del nombre es non-greedy y el resto ancla al final de la línea.
 */
export async function listDevices(binary: string): Promise<LlamaDevice[]> {
  const { cwd, env } = binaryRuntimeEnv(binary)

  let stdout = ''
  try {
    const p = spawn({
      cmd: [binary, '--list-devices'],
      stdout: 'pipe',
      stderr: 'pipe',
      cwd,
      env,
    })
    const timer = setTimeout(() => {
      try {
        p.kill('SIGKILL')
      } catch {
        /* ya terminó */
      }
    }, LIST_DEVICES_TIMEOUT_MS)
    try {
      stdout = await new Response(p.stdout).text()
    } finally {
      clearTimeout(timer)
      try {
        await p.exited
      } catch {
        /* matado por timeout */
      }
    }
  } catch {
    return []
  }
  return parseListDevices(stdout)
}

// Anclada al final: id del backend, nombre (con paréntesis internos), total y free.
const DEVICE_RE = /^\s*(\w+\d+)\s*:\s*(.+?)\s*\((\d+)\s*MiB\s*,\s*(\d+)\s*MiB\s*free\)\s*$/

/** Parsea la salida cruda de --list-devices a LlamaDevice[]. */
export function parseListDevices(stdout: string): LlamaDevice[] {
  const devices: LlamaDevice[] = []
  for (const raw of stdout.split('\n')) {
    const m = raw.match(DEVICE_RE)
    if (!m) continue
    const name = m[2].trim()
    devices.push({
      id: m[1],
      name,
      vendor: vendorFromName(name),
      totalMiB: Number(m[3]),
      freeMiB: Number(m[4]),
    })
  }
  return devices
}

/**
 * Deduce el backend de cómputo a partir del prefijo (sin dígitos) del primer id.
 *   "CUDA0" → cuda, "Vulkan0" → vulkan, "SYCL0" → sycl, …
 * Devuelve 'unknown' si no reconoce el prefijo o no hay devices.
 */
export function detectBackend(devices: LlamaDevice[]): GpuBackend {
  if (devices.length === 0) return 'unknown'
  const prefix = devices[0].id.replace(/\d+$/, '')
  switch (prefix.toLowerCase()) {
    case 'cuda':
      return 'cuda'
    case 'vulkan':
      return 'vulkan'
    case 'sycl':
      return 'sycl'
    case 'metal':
      return 'metal'
    case 'opencl':
      return 'opencl'
    case 'cann':
      return 'cann'
    case 'cpu':
      return 'cpu'
    default:
      return 'unknown'
  }
}

/** Deduce el vendor del nombre legible del device. */
export function vendorFromName(name: string): 'nvidia' | 'amd' | 'intel' | 'unknown' {
  if (/nvidia|geforce|\b(?:rtx|gtx)\b|quadro|tesla/i.test(name)) return 'nvidia'
  if (/\bamd\b|radeon|radv|instinct|rx\s?\d/i.test(name)) return 'amd'
  if (/intel|\barc\b|iris|\buhd\b/i.test(name)) return 'intel'
  return 'unknown'
}

/**
 * Calcula el VRAM consumido por el modelo en cada device: delta de VRAM libre
 * (baseline.free − final.free), clampeado a ≥0. Empareja por id de device.
 *
 * @param filterIds  Valor de `--device` (p.ej. "Vulkan0,Vulkan1"). Si es null,
 *                   devuelve todos los devices; si está, solo esos (en el orden
 *                   en que aparecen en `final`).
 */
export function computeDeviceVram(
  baseline: LlamaDevice[],
  final: LlamaDevice[],
  filterIds: string | null,
): DeviceVram[] {
  const baselineMap = new Map(baseline.map((d) => [d.id, d]))
  const allow = filterIds ? new Set(filterIds.split(',').map((s) => s.trim()).filter(Boolean)) : null
  return final
    .filter((d) => allow === null || allow.has(d.id))
    .map((d) => {
      const base = baselineMap.get(d.id)
      const usedMiB =
        base && Number.isFinite(base.freeMiB) && Number.isFinite(d.freeMiB)
          ? Math.max(0, base.freeMiB - d.freeMiB)
          : null
      return { device: d, usedMiB }
    })
}
