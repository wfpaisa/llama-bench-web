// Buffer de logs: append, helpers, suscripción en vivo y mensajes del backend.
// El buffer vive en state.ts (compartido); aquí solo están las operaciones.
//
// Cada entrada lleva un `seq` global monotónico que sobrevive a los recortes del
// buffer. Los consumidores (SSE y el fallback por polling) piden "lo posterior a
// seq N" en vez de "lo posterior al índice N", que es lo que antes se rompía en
// cuanto el buffer llegaba al cap.

import type { LogEntry } from './types.ts'
import { bootTime, firstSeq, logBuffer, nextLogSeq, trimLogBuffer } from './state.ts'

/** Callback que recibe cada línea nueva en cuanto se encola. */
export type LogListener = (entry: LogEntry) => void

const listeners = new Set<LogListener>()

/**
 * Suscribe un listener a las líneas nuevas. Devuelve la función para darse de
 * baja. Sin suscriptores el coste del fan-out es un `Set` vacío por línea.
 */
export function onLog(listener: LogListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Agrega una línea al buffer circular (descarta saltos de línea finales). */
export function pushLog(stream: LogEntry['stream'], msg: string): void {
  // Sin retener saltos de línea redundantes.
  const line = msg.replace(/\r?\n$/, '')
  if (!line) return
  const entry: LogEntry = { seq: nextLogSeq(), t: Date.now() - bootTime, stream, msg: line }
  logBuffer.push(entry)
  trimLogBuffer()
  for (const listener of listeners) {
    try {
      listener(entry)
    } catch {
      // Un consumidor roto (stream cerrado a media escritura) no puede tumbar
      // el logging del resto.
    }
  }
}

/**
 * Vuelca un bloque multilínea como entradas `command`: es el comando que se va a
 * ejecutar, tal como se vería en la terminal antes de la salida del proceso.
 */
export function pushCommand(text: string): void {
  for (const line of text.split('\n')) pushLog('command', line || ' ')
}

/** Mensaje del propio backend (stream "system", prefijado con [backend]). */
export function systemLog(msg: string): void {
  pushLog('system', `[backend] ${msg}`)
}

/** Snapshot actual del buffer (referencia; usar slice para iterar). */
export function getLogBuffer(): LogEntry[] {
  return logBuffer
}

/**
 * Entradas con `seq` estrictamente mayor que `since`. `since = 0` devuelve todo
 * lo que quede en el buffer. Si el cliente venía de muy atrás y esas líneas ya
 * se recortaron, recibe lo más viejo disponible (hueco explícito, nunca
 * duplicados).
 */
export function entriesSince(since: number): LogEntry[] {
  if (!Number.isFinite(since) || since < 0) return logBuffer.slice()
  const offset = since - firstSeq + 1
  if (offset <= 0) return logBuffer.slice()
  if (offset >= logBuffer.length) return []
  return logBuffer.slice(offset)
}

/**
 * `seq` de la última línea encolada. Con el buffer vacío devuelve el último
 * `seq` emitido (`firstSeq - 1`), no 0: tras un "limpiar" el cliente no debe
 * rebobinar y volver a pedir lo ya descartado.
 */
export function currentCursor(): number {
  return logBuffer.length ? logBuffer[logBuffer.length - 1]!.seq : firstSeq - 1
}
