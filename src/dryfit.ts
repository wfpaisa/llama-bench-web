// Calibración real del optimizador (dry-fit).
//
// A diferencia del benchmark completo (runBenchmark), el dry-fit NO envía
// inferencia: arranca llama-server, espera a que el modelo cargue (m.ready),
// mide la VRAM consumida de verdad (delta de --list-devices) y detiene el
// servidor. Sirve para que el optimizador muestre el consumo REAL frente al
// estimado heurístico.
//
// El ciclo es un recorte del de benchmark.ts:
//   parse → baseline devices → startServer → m.ready → sleep → final devices
//   → computeDeviceVram (delta) → stopServer (siempre).
// Sin health-check HTTP, sin request de inferencia, sin parseo de timings de
// generación (sí se captura el load time desde los logs).

import type { DryfitResponse, ParsedScript } from './types.ts'
import { parseScript } from './script-parser.ts'
import { readGpuStats, subtractGpuBaseline } from './gpu.ts'
import { listDevices, computeDeviceVram } from './devices.ts'
import { parseMetricsFromLogs, sleep } from './metrics.ts'
import { startServer, stopServer, assertBinaryExists } from './server-manager.ts'
import { systemLog } from './logs.ts'
import { getLogBuffer } from './logs.ts'
import { setBenchAbortController } from './state.ts'

/** Respuesta vacía de error (sin medición). */
function dryfitError(msg: string): DryfitResponse {
  return { perDevice: [], totalMiB: null, loadTimeSeconds: null, fits: false, error: msg }
}

/**
 * Ejecuta un dry-fit: arranca el modelo del script, mide la VRAM real consumida
 * al cargarlo (sin inferencia) y detiene el servidor.
 *
 * NO lanza en errores esperados (OOM, modelo inválido, script roto): devuelve un
 * DryfitResponse con `error` poblado para que el frontend lo muestre inline.
 * Solo lanza en fallos inesperados (el router los envuelve en 500).
 *
 * Garantiza que el servidor se detenga al final (finally). Reusa el mismo
 * benchAbortController que el benchmark → cancelable vía POST /benchmark/stop.
 */
export async function runDryfit(script: string): Promise<DryfitResponse> {
  // 0) Parsear el script + validar binario (errores tempranos, sin spawn).
  let parsed: ParsedScript
  try {
    parsed = parseScript(script)
  } catch (e) {
    return dryfitError(`Script inválido: ${(e as Error).message}`)
  }
  try {
    assertBinaryExists(parsed.binary)
  } catch (e) {
    return dryfitError((e as Error).message)
  }

  // Marcador de logs: desde aquí parsear el load time al final.
  const logStartIndex = getLogBuffer().length

  // 1) Baseline de VRAM libre por device (--list-devices), antes de arrancar.
  //    El delta contra la lectura final da el consumo real del modelo.
  const baselineDevices = await listDevices(parsed.binary)
  const gpuBaseline = await readGpuStats()

  // AbortController compartido con el benchmark → POST /benchmark/stop cancela.
  const controller = new AbortController()
  setBenchAbortController(controller)
  const checkAbort = (): void => {
    if (controller.signal.aborted) {
      systemLog('dryfit: cancelado por el usuario.')
      throw new Error('Calibración cancelada por el usuario.')
    }
  }

  // 2) Arrancar servidor.
  systemLog('dryfit: iniciando llama-server para medición…')
  let m
  try {
    m = await startServer(parsed)
  } catch (e) {
    setBenchAbortController(null)
    return dryfitError(`No se pudo iniciar el servidor: ${(e as Error).message}`)
  }

  try {
    checkAbort()

    // 3) Esperar a que el proceso quede "ready" (modelo cargado + slots listos).
    //    Si muere durante el arranque (OOM, modelo inválido, crash), ready se
    //    rechaza al instante con el exit code. Race contra el abort del usuario.
    try {
      await Promise.race([
        m.ready,
        new Promise<never>((_, rej) => {
          if (controller.signal.aborted) rej(new Error('Calibración cancelada por el usuario.'))
          controller.signal.addEventListener('abort', () => rej(new Error('Calibración cancelada por el usuario.')), { once: true })
        }),
      ])
    } catch (e) {
      if (controller.signal.aborted) throw new Error('Calibración cancelada por el usuario.')
      return dryfitError(`El servidor no arrancó: ${(e as Error).message}. ` + 'Revisá el script, su formato y los flags (binario, modelo, rutas, comillas, continuaciones \\).')
    }
    checkAbort()

    // 4) Sleep de estabilización: "server is listening" puede aparecer antes
    //    de que los slots terminen de reservar el KV cache, y además el
    //    backend (CUDA/Vulkan) sigue reservando memoria perezosamente (pools,
    //    page-in de pesos mmap) durante unos segundos más. Esperamos 4.5s para
    //    que la lectura final de VRAM capte el consumo asentado real.
    await sleep(4500)
    checkAbort()

    // 5) Lectura final de VRAM con el modelo cargado + delta contra baseline.
    //    computeDeviceVram es la fuente preferida (ids del backend, cubre
    //    vendors que nvidia-smi/sysfs no miden); si está vacío, cae a GPU stats.
    const finalDevices = await listDevices(parsed.binary)
    const deviceVram = computeDeviceVram(baselineDevices, finalDevices, parsed.device)

    let totalMiB: number | null = null
    const measured = deviceVram.filter((d) => d.usedMiB != null)
    if (measured.length > 0) {
      totalMiB = measured.reduce((s, d) => s + (d.usedMiB ?? 0), 0)
    } else {
      // Fallback a nvidia-smi/sysfs si --list-devices no dio delta.
      const gpuFinal = await readGpuStats()
      const gpus = subtractGpuBaseline(gpuFinal, gpuBaseline)
      const gpuUsed = gpus.filter((g) => g.memUsedMiB != null)
      if (gpuUsed.length > 0) {
        totalMiB = gpuUsed.reduce((s, g) => s + (g.memUsedMiB ?? 0), 0)
        totalMiB = totalMiB > 0 ? totalMiB : null
      }
    }

    // 6) Load time desde los logs (líneas "model loaded ... X ms" del slice).
    const slice = getLogBuffer().slice(logStartIndex)
    const metrics = parseMetricsFromLogs(slice)

    // fits: el total medido cabe en la VRAM total de los devices implicados.
    const capTotal = deviceVram.reduce((s, d) => s + d.device.totalMiB, 0)
    const fits = totalMiB != null && capTotal > 0 ? totalMiB <= capTotal : true

    systemLog(`dryfit: medición completada (${totalMiB != null ? totalMiB.toFixed(0) : 'null'} MiB).`)
    return {
      perDevice: deviceVram,
      totalMiB,
      loadTimeSeconds: metrics.loadTimeSeconds,
      fits,
      error: null,
    }
  } finally {
    // 7) Detener el servidor SIEMPRE y limpiar el AbortController.
    await stopServer()
    setBenchAbortController(null)
  }
}
