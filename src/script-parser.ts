// Parso de scripts de shell simples → tokens ejecutables + escalares.
//
// ESTE MÓDULO CONVIERTE EL SCRIPT CRUDO (editado en la UI) EN:
//   1. Tokens ejecutables (`binary` + `argv`) para Bun.spawn.
//   2. Escalares para display de historial y para armar el request del benchmark.
//
// El script es "binario + flags" estilo:
//   /path/llama-server \
//     -hf modelo \
//     --ctx-size 12000 \
//     --device Vulkan0,Vulkan1
//
// NO soporta pipes/redirecciones/variables de entorno de shell: son pasadas
// literalmente como argumentos. Es intencional (seguridad + fiabilidad del
// kill de grupo de proceso). Si el flag no está -> el escalar es null.

import type { ParsedScript } from './types.ts'

/**
 * Tokeniza un script de shell simple en argumentos.
 * - Colapsa continuaciones de línea (`\` al final de línea).
 * - Respeta comillas simples y dobles (sin expansión de variables).
 * - Ignora comentarios `#` que empiecen una línea (no tras argumentos).
 * Lanza Error si hay comillas sin cerrar.
 */
function tokenizeScript(script: string): string[] {
  // 1) Quitar comentarios de línea completa (línea cuyo primer no-espacio es #).
  const lines = script.split(/\r?\n/).filter((l) => {
    const t = l.trimStart()
    return !t.startsWith('#')
  })
  // 2) Unir continuaciones: una línea que termina en '\' se concatena con la
  //    siguiente reemplazando `\` + newline por un espacio.
  const joined = lines.join('\n').replace(/\\\n/g, ' ')
  // 3) Tokenizar respetando comillas.
  const tokens: string[] = []
  let i = 0
  const n = joined.length
  while (i < n) {
    // Saltar espacios.
    while (i < n && /\s/.test(joined[i])) i++
    if (i >= n) break
    let tok = ''
    while (i < n && !/\s/.test(joined[i])) {
      const ch = joined[i]
      if (ch === '"' || ch === "'") {
        // Leer hasta la comilla de cierre.
        const quote = ch
        i++
        const start = i
        while (i < n && joined[i] !== quote) i++
        if (i >= n) throw new Error(`Comilla ${quote} sin cerrar en el script.`)
        tok += joined.slice(start, i)
        i++ // consumir comilla de cierre
      } else {
        tok += ch
        i++
      }
    }
    if (tok !== '') tokens.push(tok)
  }
  return tokens
}

/** Busca el valor de un flag de la forma `--flag valor` o `-x valor`. */
function flagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === flag && i + 1 < argv.length) return argv[i + 1]
  }
  return null
}

/** Convierte a número o null si no es válido. */
function toNumOrNull(s: string | null): number | null {
  if (s === null) return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

/**
 * Convierte el script crudo en ParsedScript.
 * Lanza Error si el binario está vacío (no hay nada que ejecutar).
 */
export function parseScript(script: string): ParsedScript {
  const tokens = tokenizeScript(script)
  if (tokens.length === 0 || !tokens[0]) {
    throw new Error('El script está vacío: falta el binario de llama-server.')
  }
  const binary = tokens[0]
  const argv = tokens.slice(1)

  return {
    script,
    binary,
    argv,
    model: flagValue(argv, '-hf'),
    host: flagValue(argv, '--host') ?? '127.0.0.1',
    port: toNumOrNull(flagValue(argv, '--port')) ?? 8080,
    ctxSize: toNumOrNull(flagValue(argv, '--ctx-size')),
    batchSize: toNumOrNull(flagValue(argv, '--batch-size')),
    ubatchSize: toNumOrNull(flagValue(argv, '--ubatch-size')),
    cacheTypeK: flagValue(argv, '--cache-type-k'),
    cacheTypeV: flagValue(argv, '--cache-type-v'),
    device: flagValue(argv, '--device'),
    tensorSplit: flagValue(argv, '--tensor-split'),
    temp: toNumOrNull(flagValue(argv, '--temp')),
    topP: toNumOrNull(flagValue(argv, '--top-p')),
    topK: toNumOrNull(flagValue(argv, '--top-k')),
    ngl: toNumOrNull(flagValue(argv, '--n-gpu-layers')) ?? toNumOrNull(flagValue(argv, '-ngl')),
    flashAttn: hasFlag(argv, '--flash-attn', ['-fa']),
    threads: toNumOrNull(flagValue(argv, '--threads')) ?? toNumOrNull(flagValue(argv, '-t')),
    minP: toNumOrNull(flagValue(argv, '--min-p')),
    repeatPenalty: toNumOrNull(flagValue(argv, '--repeat-penalty')),
    modelFile: flagValue(argv, '--model') ?? flagValue(argv, '-m'),
    nCpuMoe: toNumOrNull(flagValue(argv, '--n-cpu-moe')) ?? toNumOrNull(flagValue(argv, '--cpu-moe')) ?? 0,
    cacheReuse: toNumOrNull(flagValue(argv, '--cache-reuse')) ?? 0,
    noMmproj: hasFlag(argv, '--no-mmproj'),
    specDraftNMax: toNumOrNull(flagValue(argv, '--spec-draft-n-max')),
    cacheRam: toNumOrNull(flagValue(argv, '--cache-ram')) ?? toNumOrNull(flagValue(argv, '-cram')),
  }
}

/**
 * True si el flag (o alguno de sus aliases) aparece en argv como switch
 * (sin valor) o como `--flag valor`. Usado para --flash-attn on|off / -fa.
 */
function hasFlag(argv: string[], flag: string, aliases: string[] = []): boolean {
  const forms = new Set([flag, ...aliases])
  for (const a of argv) {
    if (forms.has(a)) return true
  }
  return false
}
