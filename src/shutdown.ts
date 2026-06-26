// Cierre ordenado del backend ante signals (SIGINT/SIGTERM/SIGHUP) o exit.
//
// llama-server se arranca en su propio grupo de proceso (detached + setsid en
// server-manager.ts), así que NO es hijo del backend: si el backend muere sin
// más, el hijo queda huérfano (reclutado por init) y sigue corriendo, con la
// GPU ocupada. Este módulo se asegura de matar cualquier llama-server gestio-
// nado y de cancelar el benchmark en curso ANTES de que el backend termine.
//
// Diseño:
//   - shutdownCleanup() es idempotente (reentrante): si dos signals llegan
//     casi a la vez, la segunda llamada no vuelve a disparar el cleanup.
//   - Se ejecuta dentro de process.exit(): el server Bun.serve se cierra solo.
//   - En el cierre por signal forzamos un timeout corto (3s) para no colgar
//     la terminal: el usuario ya pidió parar, no queremos esperar los 8s
//     completos del stopServer normal.

import { managed, benchAbortController, setManaged, setStatus } from './state.ts'
import { stopServer } from './server-manager.ts'
import { systemLog } from './logs.ts'

const FORCED_KILL_TIMEOUT_MS = 3000

let cleaning = false
let cleaned = false

/**
 * Cierre ordenado: detiene el llama-server gestionado y aborta el benchmark.
 * Idempotente: seguro llamarlo varias veces (signals dobles, exit + signal…).
 */
export async function shutdownCleanup(reason: string): Promise<void> {
  if (cleaned || cleaning) return
  cleaning = true

  const tag = `cierre del backend (${reason})`
  systemLog(`${tag}; limpiando procesos hijos…`)
  console.log(`\n— ${tag}; limpiando procesos hijos…`)

  // 1) Cancelar el benchmark en curso si lo hay (desbloquea el fetch/health).
  if (benchAbortController) {
    benchAbortController.abort()
    systemLog('benchmark en curso cancelado.')
    console.log('— benchmark en curso cancelado.')
  }

  // 2) Detener el llama-server gestionado. stopServer() ya es seguro si no hay
  //    nada (no-op). Forzamos un timeout corto para no colgar la terminal.
  try {
    await stopServer(FORCED_KILL_TIMEOUT_MS)
  } catch (e) {
    systemLog(`error durante el cierre: ${(e as Error).message}`)
    console.error(`— error durante el cierre: ${(e as Error).message}`)
  }

  // 3) Belt-and-suspenders: si por algún race el managed sigue seteado, lo
  //    limpiamos para que el exit no deje referencias colgando.
  if (managed) {
    setManaged(null)
    setStatus('stopped')
  }

  cleaned = true
  console.log('— cierre limpio completado.')
}

/**
 * Registra los handlers de signals y exit.
 * Llamar una sola vez al arranque del backend (server.ts).
 */
export function registerShutdownHandlers(): void {
  const handler = (sig: string): void => {
    // Sin async en el handler: disparamos el cleanup y salimos.
    void shutdownCleanup(sig).finally(() => {
      // Salimos con el código convencional: 128 + signal number.
      process.exit(128 + (trySignalNumber(sig) ?? 0))
    })
  }

  // Ctrl+C en la terminal (SIGINT) y señales de terminación habituales.
  process.on('SIGINT', () => handler('SIGINT'))
  process.on('SIGTERM', () => handler('SIGTERM'))
  process.on('SIGHUP', () => handler('SIGHUP'))

  // Cobertura adicional: cierre explícito del event loop.
  process.on('beforeExit', () => {
    void shutdownCleanup('beforeExit')
  })
}

/** Mapa signal name → number (los que nos interesan). */
function trySignalNumber(sig: string): number | undefined {
  switch (sig) {
    case 'SIGINT':
      return 2
    case 'SIGTERM':
      return 15
    case 'SIGHUP':
      return 1
    default:
      return undefined
  }
}
