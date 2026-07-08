// Estado global mutable del backend, centralizado para que todos los módulos
// lo compartan. Es el equivalente a los `let` globales que tenía el server
// monolítico, sin introducir una clase singleton.

import type { Subprocess } from 'bun'
import type { ParsedScript, ServerStatus, LogEntry } from './types.ts'
import { LOG_CAP } from './config.ts'

/** Proceso llama-server gestionado (spawn + promesa de ready). */
export interface ManagedServer {
  proc: Subprocess<'ignore', 'pipe', 'pipe'>
  pid: number
  startedAt: string
  parsed: ParsedScript
  // Resuelve cuando el proceso emite "server is listening" o al morir.
  ready: Promise<void>
  readyResolve?: () => void
  readyReject?: (e: Error) => void
  done: boolean
}

/** Proceso actualmente gestionado (null cuando está detenido). */
export let managed: ManagedServer | null = null

/** Estado reportado por GET /status. */
export let status: ServerStatus = 'stopped'

/** Último mensaje de error (cuando status === "error"). */
export let statusError: string | null = null

/** Flag que evita benchmarks concurrentes (POST /benchmark devuelve 409). */
export let benchmarkRunning = false

/** Instante de arranque del backend (para timestamps relativos de log). */
export const bootTime = Date.now()

/** Buffer circular de logs (los últimos N en memoria). */
export const logBuffer: LogEntry[] = []

// ── Setters ──────────────────────────────────────────────────────────────────
// Necesarios porque los `let` son exportados por valor: desde otro módulo no se
// puede reasignar. Centralizamos las mutaciones aquí.

export function setManaged(m: ManagedServer | null): void {
  managed = m
}
export function setStatus(s: ServerStatus): void {
  status = s
}
export function setStatusError(e: string | null): void {
  statusError = e
}
export function setBenchmarkRunning(v: boolean): void {
  benchmarkRunning = v
}

/** AbortController para cancelar un benchmark en ejecución. */
export let benchAbortController: AbortController | null = null

export function setBenchAbortController(c: AbortController | null): void {
  benchAbortController = c
}

// ── Trims del buffer de logs ─────────────────────────────────────────────────
export function trimLogBuffer(): void {
  if (logBuffer.length > LOG_CAP) logBuffer.splice(0, logBuffer.length - LOG_CAP)
}

/** Crea un ParsedScript "vacío" para casos de error (finalize). */
export function emptyParsedScript(): ParsedScript {
  return {
    script: '',
    binary: '',
    argv: [],
    model: null,
    host: '127.0.0.1',
    port: 8080,
    ctxSize: null,
    batchSize: null,
    ubatchSize: null,
    cacheTypeK: null,
    cacheTypeV: null,
    device: null,
    tensorSplit: null,
    temp: null,
    topP: null,
    topK: null,
    ngl: null,
    flashAttn: false,
    threads: null,
    minP: null,
    repeatPenalty: null,
    modelFile: null,
    nCpuMoe: 0,
    cacheReuse: 0,
    noMmproj: false,
  }
}
