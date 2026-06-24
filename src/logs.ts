// Buffer de logs: append, helpers y mensajes del propio backend.
// El buffer vive en state.ts (compartido); aquí solo están las operaciones.

import type { LogEntry } from './types.ts'
import { bootTime, logBuffer, trimLogBuffer } from './state.ts'

/** Agrega una línea al buffer circular (descarta saltos de línea finales). */
export function pushLog(stream: LogEntry['stream'], msg: string): void {
  // Sin retener saltos de línea redundantes.
  const line = msg.replace(/\r?\n$/, '')
  if (!line) return
  logBuffer.push({ t: Date.now() - bootTime, stream, msg: line })
  trimLogBuffer()
}

/** Mensaje del propio backend (stream "system", prefijado con [backend]). */
export function systemLog(msg: string): void {
  pushLog('system', `[backend] ${msg}`)
}

/** Snapshot actual del buffer (referencia; usar slice para iterar). */
export function getLogBuffer(): LogEntry[] {
  return logBuffer
}
