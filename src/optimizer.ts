// Optimizador de parámetros de llama-server: estimación heurística de VRAM.
//
// Expuesto vía POST /estimate (router.ts). NO arranca el binario: solo ejecuta
// --list-devices (para enumerar devices) y resuelve el archivo del modelo.
//
// La heurística modela el consumo como:
//   VRAM ≈ pesos + KV cache + overhead
//
//   pesos     = tamaño real del .gguf en disco × (ngl / capas)   [MiB]
//               (si ngl < capas, solo esa fracción va a VRAM; el resto a RAM)
//   KV cache  = 2 × capas × kvHeads × headDim × ctx × bytesKv    [MiB]
//               (capas, kvHeads y headDim se leen del header GGUF del archivo)
//   overhead  = 128 + ubatch × 0.5   [MiB]  (buffers de cómputo del backend)
//               + mmproj si --no-mmproj está off y hay mmproj detectado
//               + spec-draft si --spec-draft-n-max > 0 (ver más abajo)
//
// Resolución del archivo del modelo (resolveModelFile):
//   -hf "org/model:quant" → busca en ~/.cache/huggingface/hub/models--org--model/
//   --model / -m           → usa la ruta explícita
//   Lee el header GGUF (readGgufArch) para extraer la arquitectura real.
//
// El espejo client-side (para feedback instantáneo en los sliders) vive en
// front/.../core/utils/vram-estimate.ts.

import type { EstimateResponse, LlamaDevice, ModelMeta, TunedParams, VramBreakdown } from './types.ts'
import { detectBackend } from './devices.ts'
import { existsSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// ── Tabla de bytes por parámetro según cuantización ───────────────────────────
// Valores aproximados (incluyen overhead de tablas/escalares). El peso real
// varía por familia, pero esto basta para una estimación con ±20% de error.
const BYTES_PER_PARAM: Record<string, number> = {
  F32: 4.0,
  F16: 2.0,
  BF16: 2.0,
  Q8_0: 0.85,
  Q6_K: 0.69,
  Q5_K_M: 0.59,
  Q5_K_S: 0.56,
  Q5_1: 0.59,
  Q5_0: 0.56,
  Q4_K_M: 0.69,
  Q4_K_S: 0.56,
  Q4_1: 0.56,
  Q4_0: 0.56,
  IQ4_NL: 0.51,
  IQ4_XS: 0.45,
  Q3_K_M: 0.45,
  Q3_K_S: 0.41,
  IQ3_M: 0.38,
  IQ3_S: 0.36,
  IQ3_XXS: 0.33,
  Q2_K: 0.35,
  IQ2_M: 0.3,
  // Variantes dinámicas (Unsloth Dynamic): aprox. al quant base del nombre.
  UD_Q6_K_XL: 0.7,
  UD_Q4_K_XL: 0.57,
}

// ── Catálogo de familias de modelos → (params, layers, kvHeads, headDim) ─────
// Estructura aproximada de familias comunes para el cálculo del KV cache. Lo
// que no esté aquí cae a defaults razonables (params del nombre, layers/heads
// interpolados). Mantener agregado conforme se usan nuevos modelos.
interface FamilyArch {
  paramsB: number
  layers: number
  kvHeads: number
  headDim: number
}

const FAMILY_ARCH: { match: RegExp; arch: FamilyArch }[] = [
  // Qwen3 / Qwen3.5 / Qwen3.6 — cubre 0.6B hasta 235B por interpolación lineal.
  { match: /qwen[-_ ]?3(?:\.[0-9]+)?[-_ ]?(\d+(?:\.\d+)?)b/i, arch: { paramsB: 0, layers: 0, kvHeads: 0, headDim: 128 } },
  // Llama 3.x
  { match: /llama[-_ ]?3(?:\.[0-9]+)?[-_ ]?(\d+(?:\.\d+)?)b/i, arch: { paramsB: 0, layers: 0, kvHeads: 8, headDim: 128 } },
  // Mistral / Mixtral
  { match: /mixtral[-_ ]?(\d+)x(\d+)b/i, arch: { paramsB: 0, layers: 32, kvHeads: 8, headDim: 128 } },
  { match: /mistral[-_ ]?(\d+(?:\.\d+)?)b/i, arch: { paramsB: 0, layers: 0, kvHeads: 8, headDim: 128 } },
  // Gemma 2/3
  { match: /gemma[-_ ]?(?:2|3)[-_ ]?(\d+(?:\.\d+)?)b/i, arch: { paramsB: 0, layers: 0, kvHeads: 16, headDim: 256 } },
  // DeepSeek
  { match: /deepseek[-_ ]?(\d+(?:\.\d+)?)b/i, arch: { paramsB: 0, layers: 0, kvHeads: 0, headDim: 128 } },
  // Phi-3/4
  { match: /phi[-_ ]?(?:3|4)[-_ ]?(\d+(?:\.\d+)?)b/i, arch: { paramsB: 0, layers: 0, kvHeads: 0, headDim: 128 } },
]

// Tabla de capas/kvHeads por tamaño de paramsB (interpolación para los no listados).
// Valores típicos de modelos densos modernos (~GQA). Los MoE tienen más capas.
const ARCH_BY_SIZE: { upToB: number; layers: number; kvHeads: number }[] = [
  { upToB: 1, layers: 16, kvHeads: 4 },
  { upToB: 4, layers: 32, kvHeads: 4 },
  { upToB: 8, layers: 32, kvHeads: 8 },
  { upToB: 14, layers: 40, kvHeads: 8 },
  { upToB: 32, layers: 64, kvHeads: 8 },
  { upToB: 70, layers: 80, kvHeads: 8 },
  { upToB: 110, layers: 90, kvHeads: 8 },
  { upToB: 400, layers: 94, kvHeads: 4 },
]

const MIB = 1024 * 1024

/**
 * Parsea el nombre de un modelo HF (-hf/--hf-repo) y deduce sus metadatos.
 * Ejemplos:
 *   "unsloth/Qwen3.5-9B-GGUF:UD-Q6_K_XL" → base "Qwen3.5-9B", quant "UD-Q6_K_XL"
 *   "unsloth/Qwen3.6-27B-MTP-GGUF:Q4_K_S" → base "Qwen3.6-27B", quant "Q4_K_S"
 */
export function parseModelMeta(raw: string | null): ModelMeta {
  if (!raw) {
    return {
      raw: '',
      base: '',
      quant: null,
      bytesPerParam: null,
      paramsB: null,
      layers: null,
      attentionLayers: null,
      kvHeads: null,
      headDim: null,
      weightsFileMiB: null,
      weightsFile: null,
      mmprojSizeMiB: null,
    }
  }
  const [repoPart, quantPart] = raw.split(':')
  const quant = quantPart ?? null
  const base = repoPart.split('/').pop() ?? repoPart

  // Bytes por parámetro desde el quant (normaliza a upper, sin prefijos UD/IQ).
  const bytesPerParam = quant ? bytesPerParamFor(quant) : null

  // Params en B desde el nombre (p.ej. "Qwen3.6-27B" → 27, "Llama-3.1-8B" → 8).
  const paramsB = paramsBFromName(base)

  // Arquitectura (layers/kvHeads/headDim) desde el catálogo de familias o por tamaño.
  const arch = archForName(base, paramsB)

  return {
    raw,
    base,
    quant,
    bytesPerParam,
    paramsB,
    layers: arch.layers,
    attentionLayers: null,
    kvHeads: arch.kvHeads,
    headDim: arch.headDim,
    weightsFileMiB: null,
    weightsFile: null,
    mmprojSizeMiB: null,
  }
}

/** Bytes por parámetro de un quant dado, normalizando el nombre. */
function bytesPerParamFor(quant: string): number | null {
  const q = quant.toUpperCase().replace(/[^A-Z0-9_]/g, '_')
  if (BYTES_PER_PARAM[q] != null) return BYTES_PER_PARAM[q]
  // Normalizar prefijos dinámicos (UD_, IQ_) buscando el quant base.
  const base = q.replace(/^(UD_|DYN_|DYNAMIC_)/, '')
  if (BYTES_PER_PARAM[base] != null) return BYTES_PER_PARAM[base]
  // Heurística por dígito inicial: Q4* ≈ 0.56, Q5* ≈ 0.57, Q6* ≈ 0.69, Q8* ≈ 0.85.
  const m = q.match(/Q(\d)/)
  if (m) {
    const n = Number(m[1])
    if (n === 2) return 0.35
    if (n === 3) return 0.45
    if (n === 4) return 0.56
    if (n === 5) return 0.57
    if (n === 6) return 0.69
    if (n === 8) return 0.85
  }
  return null
}

/** Extrae los miles de millones de parámetros del nombre (p.ej. "27B", "1.5B"). */
function paramsBFromName(base: string): number | null {
  const m = base.match(/(\d+(?:\.\d+)?)\s*B\b/i)
  if (!m) return null
  return Number(m[1])
}

/** Deduce (layers, kvHeads, headDim) desde la familia o, si no, por tamaño. */
function archForName(base: string, paramsB: number | null): { layers: number | null; kvHeads: number | null; headDim: number | null } {
  // 1) Catálogo de familias explícito.
  for (const { match, arch } of FAMILY_ARCH) {
    if (match.test(base)) {
      const sizeMatch = base.match(/(\d+(?:\.\d+)?)\s*B\b/i)
      const size = sizeMatch ? Number(sizeMatch[1]) : paramsB
      if (size == null) return { layers: arch.layers || null, kvHeads: arch.kvHeads || null, headDim: arch.headDim }
      return { ...interpArchBySize(size), headDim: arch.headDim }
    }
  }
  // 2) Por tamaño de params (interpolación en ARCH_BY_SIZE).
  if (paramsB != null) return interpArchBySize(paramsB)
  return { layers: null, kvHeads: null, headDim: 128 }
}

function interpArchBySize(sizeB: number): { layers: number; kvHeads: number; headDim: number | null } {
  for (const row of ARCH_BY_SIZE) {
    if (sizeB <= row.upToB) return { layers: row.layers, kvHeads: row.kvHeads, headDim: 128 }
  }
  const last = ARCH_BY_SIZE[ARCH_BY_SIZE.length - 1]
  return { layers: last.layers, kvHeads: last.kvHeads, headDim: 128 }
}

// ── Estimación de VRAM ────────────────────────────────────────────────────────

/** Bytes por elemento del tipo de KV cache (q8_0 ≈ 1, q4_0 ≈ 0.5, f16 = 2). */
function bytesPerKvElement(cacheType: string | null): number {
  if (!cacheType) return 2 // default f16
  const t = cacheType.toLowerCase()
  if (t === 'f32') return 4
  if (t === 'f16' || t === 'bf16') return 2
  if (t === 'q8_0') return 1
  if (t === 'q4_0' || t === 'q4_1') return 0.5
  if (t === 'q5_0' || t === 'q5_1') return 0.625
  if (t === 'iq4_nl' || t === 'iq4_xs') return 0.5
  return 2
}

interface EstimateInput {
  meta: ModelMeta
  ctxSize: number
  cacheTypeK: string | null
  cacheTypeV: string | null
  ubatchSize: number | null
  ngl: number | null
}

/**
 * Estima el consumo total de VRAM (pesos + KV + overhead) en MiB.
 * Devuelve null si faltan metadatos críticos (paramsB o bytesPerParam).
 */
function estimateVramMiB(input: EstimateInput): { weights: number; kv: number; overhead: number; total: number } | null {
  const { meta, ctxSize, cacheTypeK, ubatchSize } = input
  if (meta.paramsB == null || meta.bytesPerParam == null) return null

  // Pesos: todos los parámetros cuantizados. (Asumimos offload completo; ngl
  // solo afecta la distribución GPU/CPU, no el total.)
  const weights = (meta.paramsB * 1e9 * meta.bytesPerParam) / MIB

  // KV cache: 2 (K+V) × layers × kvHeads × headDim × ctx × bytesPorElemento.
  // Si cache-type-k/v difieren, se promedian los bytes por elemento.
  const layers = meta.layers ?? 32
  // Capas de atención: solo estas generan KV cache. En modelos híbridos
  // (Qwen3.5/3.6, Jamba, Zamba, …) el resto son SSM/Mamba con estado fijo que
  // no escala con el contexto. Si no se detectó (modelo denso normal), todas.
  const attnLayers = meta.attentionLayers ?? layers
  const kvHeads = meta.kvHeads ?? 8
  const headDim = meta.headDim ?? 128
  const bytesK = bytesPerKvElement(cacheTypeK)
  const bytesV = bytesPerKvElement(input.cacheTypeV ?? cacheTypeK)
  const bytesEl = (bytesK + bytesV) / 2
  const kv = (2 * attnLayers * kvHeads * headDim * ctxSize * bytesEl) / MIB

  // Overhead: compute buffer proporcional a ubatch + buffer fijo.
  const ub = ubatchSize ?? 128
  const overhead = 256 + ub * 0.5

  return { weights, kv, overhead, total: weights + kv + overhead }
}

// ── Recomendación automática ─────────────────────────────────────────────────

interface RecommendInput {
  meta: ModelMeta
  devices: LlamaDevice[]
  /** VRAM libre total disponible (suma de freeMiB de los devices seleccionados). */
  freeMiB: number
  /** Preferencia del usuario: maximizar ctx o maximizar precisión del KV. */
  priority: 'ctx' | 'quality'
  /** Parámetros actuales como punto de partida (ctx, cacheType, etc.). */
  current: Partial<TunedParams>
}

/**
 * Recomienda parámetros que caben en la VRAM libre. Estrategia:
 *  1. Asumir ngl=max (offload completo) — la recomendación es para GPU.
 *  2. Elegir cache-type según prioridad (quality→f16/q8_0, ctx→q4_0).
 *  3. Buscar el mayor ctx que quepa (búsqueda binaria).
 *  4. batch/ubatch conservadores (512/128).
 */
function recommendParams(input: RecommendInput): TunedParams {
  const { meta, freeMiB, priority, current } = input

  // Defaults conservadores si faltan datos.
  const cacheType = current.cacheTypeK ?? (priority === 'quality' ? 'q8_0' : 'q4_0')
  const cacheTypeK = cacheType
  const cacheTypeV = priority === 'quality' ? 'q8_0' : cacheType
  const batchSize = current.batchSize ?? 512
  const ubatchSize = current.ubatchSize ?? 128
  const flashAttn = current.flashAttn ?? true
  const device = current.device ?? []
  const tensorSplit = current.tensorSplit ?? null
  const nCpuMoe = current.nCpuMoe ?? 0
  const cacheReuse = current.cacheReuse ?? 0
  const noMmproj = current.noMmproj ?? false
  const specDraftMax = current.specDraftMax ?? 0
  const cacheRam = current.cacheRam ?? 8192

  // Si no podemos estimar (faltan metadatos), devolver defaults sin optimizar.
  if (meta.paramsB == null || meta.bytesPerParam == null) {
    return {
      ctxSize: current.ctxSize ?? 8192,
      ngl: 999,
      cacheTypeK,
      cacheTypeV,
      batchSize,
      ubatchSize,
      flashAttn,
      device,
      tensorSplit,
      nCpuMoe,
      cacheReuse,
      noMmproj,
      specDraftMax,
      cacheRam,
    }
  }

  // Reservar un margen de seguridad del 8% para no llenar la VRAM al tope.
  const budget = freeMiB * 0.92

  // Búsqueda binaria del mayor ctx que quepa.
  let lo = 512
  let hi = 1_000_000
  let bestCtx = 8192
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2)
    const est = estimateVramMiB({ meta, ctxSize: mid, cacheTypeK, cacheTypeV, ubatchSize, ngl: 999 })
    if (est && est.total <= budget) {
      bestCtx = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }

  // Redondear ctx a un múltiplo razonable (256) para no dar números raros.
  bestCtx = Math.max(512, Math.floor(bestCtx / 256) * 256)

  return {
    ctxSize: bestCtx,
    ngl: 999,
    cacheTypeK,
    cacheTypeV,
    batchSize,
    ubatchSize,
    flashAttn,
    device,
    tensorSplit,
    nCpuMoe,
    cacheReuse,
    noMmproj,
    specDraftMax,
    cacheRam,
  }
}

// ── Orquestador del endpoint POST /estimate ───────────────────────────────────

interface EstimateRequestInput {
  meta: ModelMeta
  devices: LlamaDevice[]
  params: TunedParams
  priority: 'ctx' | 'quality'
}

/**
 * Construye la respuesta completa de /estimate: devices, heurística con los
 * params actuales, y recomendación automática. No arranca el binario.
 */
export function buildEstimateResponse(input: EstimateRequestInput): EstimateResponse {
  const { meta, devices, params, priority } = input

  // Devices seleccionados (o todos si no hay selección).
  const selected = selectDevices(devices, params.device)
  const totalFreeMiB = selected.reduce((s, d) => s + d.freeMiB, 0)

  // Heurística con los params actuales.
  const est = estimateVramMiB({
    meta,
    ctxSize: params.ctxSize,
    cacheTypeK: params.cacheTypeK,
    cacheTypeV: params.cacheTypeV,
    ubatchSize: params.ubatchSize,
    ngl: params.ngl,
  })

  // Si tenemos el tamaño real del archivo .gguf (resuelto desde -hf/--model),
  // usarlo como peso exacto en vez de la estimación params × bytes/param.
  // Además, aplicar el offload fraction de ngl: si ngl < layers, solo esa
  // fracción de los pesos va a VRAM; el resto a RAM del sistema.
  let weightsMiB = est?.weights ?? 0
  let overheadMiB = est?.overhead ?? 0
  if (meta.weightsFileMiB != null) {
    const layers = meta.layers ?? 32
    const offloadFraction = params.ngl >= layers ? 1 : Math.max(0, params.ngl / layers)
    weightsMiB = meta.weightsFileMiB * offloadFraction
  }
  if (!params.noMmproj && meta.mmprojSizeMiB != null) {
    overheadMiB += meta.mmprojSizeMiB
  }

  // --spec-draft-n-max: el batch de verificación pasa de 1 a (n+1) tokens, lo que
  // agranda los buffers de atención (KQ mask) en CADA capa offload. NO hay
  // fórmula oficial de llama.cpp para esto (depende de backend, versión y
  // arquitectura); los coeficientes se calibraron empíricamente como fracción
  // del peso en VRAM, así escalan a otros modelos sin quemar GB absolutos:
  //   - Activar (n=1): ~8% del peso (coste fijo de levantar la verificación).
  //   - Cada token extra (n≥2): +3.5% del peso (buffer KQ por capa).
  // Verificación contra mediciones reales de un 27B Q4 (4 saltos): error <0.6%.
  if (params.specDraftMax > 0) {
    overheadMiB += weightsMiB * (0.08 + 0.035 * (params.specDraftMax - 1))
  }

  // --cache-reuse reduce el KV cache: los últimos N tokens del cache anterior
  // se reutilizan, así que solo se paga el ctx-size - cacheReuse en KV fresco.
  // Modelamos el KV como proporcional al ctx efectivo.
  const effectiveCtx = Math.max(0, params.ctxSize - params.cacheReuse)
  const estEffective = estimateVramMiB({
    meta,
    ctxSize: effectiveCtx,
    cacheTypeK: params.cacheTypeK,
    cacheTypeV: params.cacheTypeV,
    ubatchSize: params.ubatchSize,
    ngl: params.ngl,
  })
  const kvMiB = estEffective?.kv ?? est?.kv ?? 0

  const totalMiB = weightsMiB + kvMiB + overheadMiB

  const heuristic: VramBreakdown = {
    perDeviceMiB: splitPerDevice(totalMiB, selected, params.tensorSplit),
    totalMiB,
    weightsMiB,
    kvMiB,
    overheadMiB,
    fits: totalMiB <= totalFreeMiB,
  }

  // Recomendación automática.
  const recommendation = recommendParams({
    meta,
    devices: selected,
    freeMiB: totalFreeMiB,
    priority,
    current: params,
  })

  return {
    devices,
    totalFreeMiB,
    backend: detectBackend(devices),
    modelMeta: meta,
    heuristic,
    recommendation,
  }
}

/** Filtra los devices por los ids seleccionados (vacío = todos). */
function selectDevices(devices: LlamaDevice[], selectedIds: string[]): LlamaDevice[] {
  if (!selectedIds.length) return devices
  const allow = new Set(selectedIds)
  return devices.filter((d) => allow.has(d.id))
}

/**
 * Reparte un total de MiB entre los devices seleccionados según tensor-split.
 * Si no hay tensor-split, reparte proporcional a la VRAM libre de cada device.
 */
function splitPerDevice(totalMiB: number, devices: LlamaDevice[], tensorSplit: number[] | null): number[] {
  if (devices.length === 0) return []
  if (devices.length === 1) return [totalMiB]
  // Pesos: tensor-split si está, si no proporcional a freeMiB.
  let weights: number[]
  if (tensorSplit && tensorSplit.length === devices.length) {
    weights = tensorSplit
  } else {
    weights = devices.map((d) => d.freeMiB || 1)
  }
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  return weights.map((w) => (totalMiB * w) / sum)
}

// ── Resolución del archivo real del modelo en disco ───────────────────────────
//
// Cuando se usa -hf, el modelo se cachea en ~/.cache/huggingface/hub con la
// estructura models--org--model-name/snapshots/<hash>/. Resolvemos el archivo
// .gguf real para medir su tamaño EXACTO en bytes (más preciso que params ×
// bytes/param de la heurística). Si el flag es --model con ruta explícita, lo
// usamos directo. También buscamos el mmproj (*.mmproj*.gguf o mmproj-*.gguf).

const HF_CACHE_DIR = process.env['HF_HOME'] ? join(process.env['HF_HOME'], 'hub') : join(homedir(), '.cache', 'huggingface', 'hub')

interface ResolvedModel {
  /** Ruta absoluta al archivo .gguf del modelo, o null si no se encontró. */
  file: string | null
  /** Tamaño del .gguf en MiB, o null si no se pudo medir. */
  sizeMiB: number | null
  /** Ruta al archivo mmproj, o null si no hay. */
  mmprojFile: string | null
  /** Tamaño del mmproj en MiB, o null si no hay o no se pudo medir. */
  mmprojSizeMiB: number | null
  /** Arquitectura leída del header GGUF, o null si no se pudo leer. */
  arch: GgufArch | null
}

/**
 * Resuelve el archivo real del modelo desde -hf o --model, y mide su tamaño.
 *
 * - hf: "org/model:quant" o "org/model" → busca en HF cache.
 * - modelFile: ruta explícita al .gguf → la usa directo.
 *
 * Devuelve { file, sizeMiB, mmprojFile, mmprojSizeMiB }. Los campos null si no
 * se pudo resolver (p.ej. el modelo no está cacheado aún).
 */
export function resolveModelFile(hf: string | null, modelFile: string | null): ResolvedModel {
  // 1) --model con ruta explícita.
  if (modelFile) {
    const file = resolveGgufInDir(modelFile)
    if (file) {
      const sizeMiB = sizeMiBOf(file)
      const mmproj = findMmprojInDir(dirname(file))
      const arch = readGgufArch(file)
      return {
        file,
        sizeMiB,
        mmprojFile: mmproj,
        mmprojSizeMiB: mmproj ? sizeMiBOf(mmproj) : null,
        arch,
      }
    }
  }

  // 2) -hf: buscar en el cache de HuggingFace.
  if (hf) {
    const repoDir = hfToCacheDir(hf)
    if (repoDir && existsSync(repoDir)) {
      const resolved = resolveGgufInHfRepo(repoDir, hf)
      if (resolved) {
        const sizeMiB = sizeMiBOf(resolved)
        const mmproj = findMmprojInDir(dirname(resolved))
        const arch = readGgufArch(resolved)
        return {
          file: resolved,
          sizeMiB,
          mmprojFile: mmproj,
          mmprojSizeMiB: mmproj ? sizeMiBOf(mmproj) : null,
          arch,
        }
      }
    }
  }

  return { file: null, sizeMiB: null, mmprojFile: null, mmprojSizeMiB: null, arch: null }
}

/** Convierte "org/model:quant" → path del cache de HF (models--org--model). */
function hfToCacheDir(hf: string): string | null {
  const repo = hf.split(':')[0] // quitar :quant
  if (!repo.includes('/')) return null
  const dirName = 'models--' + repo.replace(/\//g, '--')
  return join(HF_CACHE_DIR, dirName)
}

/**
 * Busca el .gguf del modelo dentro de un repo cacheado de HF. Estructura:
 *   models--org--model/snapshots/<hash>/*.gguf
 *
 * Si el hf trae quant (:Q4_K_S), prioriza el archivo cuyo nombre matchee ese
 * quant. Si no, toma el primer .gguf.
 */
function resolveGgufInHfRepo(repoDir: string, hf: string): string | null {
  const snapshotsDir = join(repoDir, 'snapshots')
  if (!existsSync(snapshotsDir)) return null
  const quant = hf.split(':')[1]?.toUpperCase()
  let snapshots: string[]
  try {
    snapshots = readdirSync(snapshotsDir).filter((s) => {
      const p = join(snapshotsDir, s)
      try {
        return statSync(p).isDirectory()
      } catch {
        return false
      }
    })
  } catch {
    return null
  }
  if (snapshots.length === 0) return null
  // Si hay quant, buscar archivo que lo matchee; si no, cualquier .gguf.
  for (const snap of snapshots) {
    const dir = join(snapshotsDir, snap)
    let files: string[]
    try {
      files = readdirSync(dir)
    } catch {
      continue
    }
    const ggufs = files.filter((f) => /\.gguf$/i.test(f) && !/mmproj/i.test(f))
    if (quant) {
      const match = ggufs.find((f) => f.toUpperCase().includes(quant))
      if (match) return join(dir, match)
    }
    if (ggufs.length > 0) return join(dir, ggufs[0]!)
  }
  return null
}

/** Resuelve un .gguf desde una ruta explícita (puede ser el archivo o un dir). */
function resolveGgufInDir(path: string): string | null {
  try {
    const s = statSync(path)
    if (s.isFile() && /\.gguf$/i.test(path)) return path
    if (s.isDirectory()) {
      const files = readdirSync(path).filter((f) => /\.gguf$/i.test(f) && !/mmproj/i.test(f))
      if (files.length > 0) return join(path, files[0]!)
    }
  } catch {
    /* no existe */
  }
  return null
}

/** Busca el archivo mmproj en un directorio (vision projector). */
function findMmprojInDir(dir: string): string | null {
  try {
    const files = readdirSync(dir)
    return files.map((f) => join(dir, f)).find((f) => /mmproj/i.test(f) && /\.gguf$/i.test(f)) ?? null
  } catch {
    return null
  }
}

/** Tamaño de un archivo en MiB, o null si no se puede leer. */
function sizeMiBOf(file: string): number | null {
  try {
    return statSync(file).size / (1024 * 1024)
  } catch {
    return null
  }
}

// ── Parser del header GGUF ───────────────────────────────────────────────────
//
// El formato GGUF almacena metadatos en su header como pares clave/valor
// tipados. Leemos solo el inicio del archivo (sin cargarlo entero) para
// extraer la arquitectura exacta del modelo:
//   llama.block_count             → nº de capas
//   llama.attention.head_count_kv → nº de KV heads (GQA)
//   llama.attention.key_length    → dimensión de key (head_dim para K)
//   llama.attention.value_length  → dimensión de value (head_dim para V)
//   llama.context_length          → ctx máximo del modelo
//
// Con estos datos el cálculo del KV cache deja de ser una interpolación
// adivinada y pasa a ser EXACTO, alineado con lo que el binario reserva.

// Tipos de valores del metadata GGUF (enum del formato).
const GGUF_TYPE: Record<number, string> = {
  0: 'uint8',
  1: 'int8',
  2: 'uint16',
  3: 'int16',
  4: 'uint32',
  5: 'int32',
  6: 'float32',
  7: 'bool',
  8: 'string',
  9: 'array',
  10: 'uint64',
  11: 'int64',
  12: 'float64',
}

/** Arquitectura extraída del header GGUF. null si el campo no está. */
interface GgufArch {
  layers: number | null
  kvHeads: number | null
  keyLength: number | null
  valueLength: number | null
  contextLength: number | null
  /**
   * Nº de capas que contribuyen al KV cache (de atención). En modelos híbridos
   * SSM/Attention (Qwen3.5/3.6, Jamba, Zamba, MiniMax, Nemotron-H, Falcon-H1…)
   * solo una fracción de las capas son de atención; las demás son recurrentes
   * (Mamba/SSM) y usan un estado fijo que no escala con el contexto. null si
   * no se detectó → todas las capas son de atención (modelo denso normal).
   *
   * Se deduce de la cadena de precedencia de llama.cpp:
   *   1) attention.recurrent_layers (array de bool por capa) → L − count(true)
   *   2) full_attention_interval (u32) → floor(L / interval)
   *   3) ninguna → null (todas son de atención)
   */
  attentionLayers: number | null
}

/**
 * Lee el header de un .gguf y extrae la arquitectura del modelo.
 * Lee como máximo los primeros 2MB (suficiente para el header de cualquier
 * modelo conocido; los tensores van después).
 */
function readGgufArch(file: string): GgufArch {
  let fd: number | null = null
  try {
    fd = openSync(file, 'r')
    // Leer hasta 2MB del header (más que suficiente para los metadatos).
    const BUF_SIZE = 2 * 1024 * 1024
    const buf = Buffer.alloc(BUF_SIZE)
    const bytesRead = readSync(fd, buf, 0, BUF_SIZE, 0)
    return parseGgufHeader(buf.subarray(0, bytesRead))
  } catch {
    return { layers: null, kvHeads: null, keyLength: null, valueLength: null, contextLength: null, attentionLayers: null }
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd)
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Parser del header GGUF sobre un Buffer ya leído. Implementación mínima: un
 * cursor que avanza leyendo los metadatos KV hasta encontrar las claves de
 * arquitectura o agotar el buffer.
 *
 * Estructura: magic(4) + version(u32) + tensor_count(u64) + kv_count(u64) +
 * pares (string_key, type, value)...
 */
function parseGgufHeader(buf: Buffer): GgufArch {
  const result: GgufArch = {
    layers: null,
    kvHeads: null,
    keyLength: null,
    valueLength: null,
    contextLength: null,
    attentionLayers: null,
  }
  // full_attention_interval se guarda aparte y se aplica al final, porque puede
  // aparecer antes que block_count en el header (el orden de las claves GGUF
  // no está garantizado). recurrent_layers tiene prioridad sobre el intervalo.
  let fullAttnInterval: number | null = null
  let off = 0
  try {
    // Magic "GGUF" + version u32 (little endian).
    const magic = buf.toString('ascii', 0, 4)
    if (magic !== 'GGUF') return result
    off = 8 // saltar magic(4) + version(4)
    // tensor_count (u64 LE) — lo saltamos.
    off += 8
    // kv_count (u64 LE).
    const kvCount = Number(buf.readBigUInt64LE(off))
    off += 8

    for (let i = 0; i < kvCount && off < buf.length; i++) {
      // Clave: string GGUF (u64 len + bytes).
      const keyLen = Number(buf.readBigUInt64LE(off))
      off += 8
      if (off + keyLen > buf.length) break
      const key = buf.toString('utf8', off, off + keyLen)
      off += keyLen

      // Tipo del valor (u32 LE).
      const typeId = buf.readUInt32LE(off)
      off += 4
      const typeName = GGUF_TYPE[typeId] ?? 'unknown'

      const [value, nextOff] = readGgufValue(buf, off, typeName)
      off = nextOff

      // Mapear claves conocidas de arquitectura.
      if (typeof value === 'number') {
        if (key.endsWith('.block_count')) result.layers = value
        else if (key.endsWith('.attention.head_count_kv')) result.kvHeads = value
        else if (key.endsWith('.attention.key_length')) result.keyLength = value
        else if (key.endsWith('.attention.value_length')) result.valueLength = value
        else if (key.endsWith('.context_length')) result.contextLength = value
        // full_attention_interval (Qwen3-Next/Qwen3.5/3.6): 1 de cada N capas
        // es de atención. Se aplica al final (puede venir antes que block_count).
        else if (key.endsWith('.full_attention_interval') && value > 0) {
          fullAttnInterval = value
        }
      }

      // attention.recurrent_layers: array de bool por capa (true = recurrente,
      // sin KV cache). PRIORIDAD sobre full_attention_interval. Las capas de
      // atención son las marcadas como false (o ausentes del array).
      if (Array.isArray(value) && key.endsWith('.attention.recurrent_layers')) {
        const recurrent = value.filter((v) => v !== 0).length
        const total = value.length
        result.attentionLayers = Math.max(0, total - recurrent)
      }

      // Si ya tenemos todas las claves, podemos parar antes. attentionLayers
      // NO rompe el early-exit: si no aparece, el modelo es denso y se resuelve
      // fuera del bucle (todas las capas son de atención).
      if (
        result.layers != null &&
        result.kvHeads != null &&
        result.keyLength != null &&
        result.valueLength != null &&
        result.contextLength != null &&
        result.attentionLayers != null &&
        fullAttnInterval != null
      ) {
        break
      }
    }

    // Si no se dedujo via recurrent_layers pero hay full_attention_interval,
    // computar capas de atención = floor(L / interval). Sin intervalo → null
    // (modelo denso: todas las capas son de atención).
    if (result.attentionLayers == null && fullAttnInterval != null && result.layers != null) {
      result.attentionLayers = Math.floor(result.layers / fullAttnInterval)
    }
  } catch {
    /* buffer cortado o tipo inesperado: devolvemos lo que tengamos */
  }
  return result
}

/**
 * Lee un valor GGUF según su tipo desde el offset. Devuelve [valor, nuevoOffset].
 * - Escalares numéricos/bool → number.
 * - Arrays numéricos/bool → number[] (p.ej. recurrent_layers). Necesario para
 *   deducir las capas de atención en modelos híbridos (Jamba, Qwen3.5…).
 * - Strings y arrays de strings → undefined (no los necesitamos para la
 *   arquitectura). Se saltan avanzando el offset.
 */
function readGgufValue(buf: Buffer, off: number, typeName: string): [number | number[] | undefined, number] {
  try {
    switch (typeName) {
      case 'uint8':
        return [buf.readUInt8(off), off + 1]
      case 'int8':
        return [buf.readInt8(off), off + 1]
      case 'uint16':
        return [buf.readUInt16LE(off), off + 2]
      case 'int16':
        return [buf.readInt16LE(off), off + 2]
      case 'uint32':
        return [buf.readUInt32LE(off), off + 4]
      case 'int32':
        return [buf.readInt32LE(off), off + 4]
      case 'float32':
        return [buf.readFloatLE(off), off + 4]
      case 'bool':
        return [buf.readUInt8(off) !== 0 ? 1 : 0, off + 1]
      case 'uint64':
        return [Number(buf.readBigUInt64LE(off)), off + 8]
      case 'int64':
        return [Number(buf.readBigInt64LE(off)), off + 8]
      case 'float64':
        return [buf.readDoubleLE(off), off + 8]
      case 'string': {
        const len = Number(buf.readBigUInt64LE(off))
        return [undefined, off + 8 + len]
      }
      case 'array': {
        // tipo del elemento (u32) + count (u64) + elementos...
        const elemType = buf.readUInt32LE(off)
        const elemTypeName = GGUF_TYPE[elemType] ?? 'unknown'
        let p = off + 4
        const count = Number(buf.readBigUInt64LE(p))
        p += 8
        // Si los elementos son numéricos/bool, los recolectamos (p.ej.
        // attention.recurrent_layers para modelos híbridos). Si son strings u
        // otros arrays, los saltamos.
        const numeric = ['uint8', 'int8', 'uint16', 'int16', 'uint32', 'int32', 'float32', 'bool', 'uint64', 'int64', 'float64']
        if (numeric.includes(elemTypeName)) {
          const vals: number[] = []
          for (let i = 0; i < count; i++) {
            const [v, next] = readGgufValue(buf, p, elemTypeName)
            if (typeof v === 'number') vals.push(v)
            p = next
          }
          return [vals, p]
        }
        // Strings u otros: saltar.
        for (let i = 0; i < count; i++) {
          const [, next] = readGgufValue(buf, p, elemTypeName)
          p = next
        }
        return [undefined, p]
      }
      default:
        // Tipo desconocido: no podemos continuar parseando de forma segura.
        return [undefined, buf.length]
    }
  } catch {
    return [undefined, buf.length]
  }
}
