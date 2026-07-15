// Heurística de estimación de VRAM (client-side, instantánea).
//
// Espejo del mismo cálculo que hace src/optimizer.ts en el backend, pero aquí
// en el frontend para que los sliders del optimizador actualicen las barras en
// vivo SIN llamadas HTTP (que provocaban el parpadeo por requests desordenados
// y un loop del effect que leía params()).
//
//   VRAM ≈ pesos + KV cache + overhead
//
//   pesos     = tamaño real del .gguf × (ngl / capas)   [MiB]
//               (si ngl < capas, solo esa fracción va a VRAM; el resto a RAM)
//               Si no hay archivo, cae a paramsB × bytesPerParam.
//   KV cache  = 2 × capas × kvHeads × headDim × ctxEfectivo × bytesKv
//               ctxEfectivo = max(0, ctxSize - cacheReuse)
//               (capas, kvHeads, headDim llegan del header GGUF vía la API)
//   overhead  = 128 + ubatch × 0.5   [MiB]
//               + mmproj si --no-mmproj está off y hay mmproj detectado
//               + spec-draft si --spec-draft-n-max > 0 (ver buildBreakdown)
//
// Los metadatos del modelo (capas, kvHeads, headDim, weightsFileMiB,
// mmprojSizeMiB) llegan del backend vía POST /estimate, que los resuelve leyendo
// el header GGUF del archivo. Aquí no se parsea el GGUF: se usan los valores
// que trae el ModelMeta.

import type { LlamaDevice, ModelMeta, TunedParams, VramBreakdown } from '../models/types';

const MIB = 1024 * 1024;

// ── Tabla de bytes por parámetro según cuantización ───────────────────────────
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
  UD_Q6_K_XL: 0.7,
  UD_Q4_K_XL: 0.57,
};

const ARCH_BY_SIZE: { upToB: number; layers: number; kvHeads: number }[] = [
  { upToB: 1, layers: 16, kvHeads: 4 },
  { upToB: 4, layers: 32, kvHeads: 4 },
  { upToB: 8, layers: 32, kvHeads: 8 },
  { upToB: 14, layers: 40, kvHeads: 8 },
  { upToB: 32, layers: 64, kvHeads: 8 },
  { upToB: 70, layers: 80, kvHeads: 8 },
  { upToB: 110, layers: 90, kvHeads: 8 },
  { upToB: 400, layers: 94, kvHeads: 4 },
];

/** Bytes por parámetro de un quant dado, normalizando el nombre. */
export function bytesPerParamFor(quant: string): number | null {
  const q = quant.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (BYTES_PER_PARAM[q] != null) return BYTES_PER_PARAM[q];
  const base = q.replace(/^(UD_|DYN_|DYNAMIC_)/, '');
  if (BYTES_PER_PARAM[base] != null) return BYTES_PER_PARAM[base];
  const m = q.match(/Q(\d)/);
  if (m) {
    const n = Number(m[1]);
    if (n === 2) return 0.35;
    if (n === 3) return 0.45;
    if (n === 4) return 0.56;
    if (n === 5) return 0.57;
    if (n === 6) return 0.69;
    if (n === 8) return 0.85;
  }
  return null;
}

/** Bytes por elemento del tipo de KV cache. */
function bytesPerKvElement(cacheType: string | null): number {
  if (!cacheType) return 2;
  const t = cacheType.toLowerCase();
  if (t === 'f32') return 4;
  if (t === 'f16' || t === 'bf16') return 2;
  if (t === 'q8_0') return 1;
  if (t === 'q4_0' || t === 'q4_1') return 0.5;
  if (t === 'q5_0' || t === 'q5_1') return 0.625;
  if (t === 'iq4_nl' || t === 'iq4_xs') return 0.5;
  return 2;
}

/** Extrae los miles de millones de parámetros del nombre (p.ej. "27B", "1.5B"). */
function paramsBFromName(base: string): number | null {
  const m = base.match(/(\d+(?:\.\d+)?)\s*B\b/i);
  if (!m) return null;
  return Number(m[1]);
}

function interpArchBySize(sizeB: number): { layers: number; kvHeads: number } {
  for (const row of ARCH_BY_SIZE) {
    if (sizeB <= row.upToB) return { layers: row.layers, kvHeads: row.kvHeads };
  }
  const last = ARCH_BY_SIZE[ARCH_BY_SIZE.length - 1];
  return { layers: last.layers, kvHeads: last.kvHeads };
}

/**
 * Parsea el nombre de un modelo HF y deduce sus metadatos (familia, params,
 * quant, capas, kvHeads). Espejo de parseModelMeta del backend.
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
    };
  }
  const [repoPart, quantPart] = raw.split(':');
  const quant = quantPart ?? null;
  const base = repoPart.split('/').pop() ?? repoPart;
  const bytesPerParam = quant ? bytesPerParamFor(quant) : null;
  const paramsB = paramsBFromName(base);
  const arch = paramsB != null ? interpArchBySize(paramsB) : { layers: 32, kvHeads: 8 };
  return {
    raw,
    base,
    quant,
    bytesPerParam,
    paramsB,
    layers: arch.layers,
    attentionLayers: null,
    kvHeads: arch.kvHeads,
    headDim: 128,
    weightsFileMiB: null,
    weightsFile: null,
    mmprojSizeMiB: null,
  };
}

/**
 * Estima el consumo de VRAM (pesos + KV + overhead) en MiB.
 * Devuelve null si faltan metadatos críticos (paramsB o bytesPerParam).
 *
 * @param ngl Capas offload a GPU (--n-gpu-layers). Si es < layers, solo esa
 *            fracción de los pesos va a VRAM; el resto a RAM del sistema.
 */
export function estimateVramMiB(
  meta: ModelMeta,
  ctxSize: number,
  cacheTypeK: string,
  cacheTypeV: string,
  ubatchSize: number,
  ngl: number = 999,
): { weights: number; kv: number; overhead: number; total: number } | null {
  // Si tenemos el tamaño real del archivo, los pesos son exactos; si no,
  // los estimamos con params × bytes/param.
  const weightsTotal =
    meta.weightsFileMiB != null
      ? meta.weightsFileMiB
      : meta.paramsB == null || meta.bytesPerParam == null
        ? null
        : (meta.paramsB * 1e9 * meta.bytesPerParam) / MIB;
  if (weightsTotal == null) return null;

  // ngl: si es menor que el total de capas, solo esa fracción de pesos va a GPU.
  // El KV cache y el overhead siempre van a GPU (no se pueden offload a CPU).
  const layers = meta.layers ?? 32;
  const offloadFraction = ngl >= layers ? 1 : Math.max(0, ngl / layers);
  const weights = weightsTotal * offloadFraction;

  // Capas de atención: solo estas generan KV cache. En modelos híbridos
  // (Qwen3.5/3.6, Jamba, Zamba…) el resto son SSM/Mamba con estado fijo que
  // no escala con el contexto. Si no se detectó (modelo denso), todas.
  const attnLayers = meta.attentionLayers ?? layers;
  const kvHeads = meta.kvHeads ?? 8;
  const headDim = meta.headDim ?? 128;
  const bytesEl = (bytesPerKvElement(cacheTypeK) + bytesPerKvElement(cacheTypeV)) / 2;
  const kv = (2 * attnLayers * kvHeads * headDim * ctxSize * bytesEl) / MIB;
  // Overhead: buffers de cómputo. Parte fija del runtime + parte que escala
  // con ubatch (tamaño del batch físico que el backend procesa en paralelo).
  const overhead = 128 + ubatchSize * 0.5;
  return { weights, kv, overhead, total: weights + kv + overhead };
}

/**
 * Recomienda parámetros que caben en la VRAM libre (búsqueda binaria de ctx).
 * Respeta el cache-type K/V que ya tenga `current` (no lo fuerza). Espejo del
 * recommendParams del backend.
 *
 * El budget es la VRAM libre con un margen de seguridad del 8% para no llenar
 * la GPU al tope (los buffers del backend tienen cierta variabilidad).
 */
export function recommendParams(
  meta: ModelMeta,
  freeMiB: number,
  current: TunedParams,
  _devices: LlamaDevice[] = [],
): TunedParams {
  const cacheTypeK = current.cacheTypeK;
  const cacheTypeV = current.cacheTypeV;

  // Budget efectivo: VRAM libre × 0.92 (margen de seguridad del 8%).
  const budget = freeMiB * 0.92;

  let lo = 512;
  let hi = 1_000_000;
  let bestCtx = 8192;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const est = estimateVramMiB(meta, mid, cacheTypeK, cacheTypeV, current.ubatchSize);
    if (est && est.total <= budget) {
      bestCtx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  bestCtx = Math.max(512, Math.floor(bestCtx / 256) * 256);

  return {
    ...current,
    ctxSize: bestCtx,
    ngl: 999,
    cacheTypeK,
    cacheTypeV,
    specDraftMax: current.specDraftMax,
    cacheRam: current.cacheRam,
  };
}

/** Filtra los devices por ids seleccionados (vacío = todos). */
function selectDevices(devices: LlamaDevice[], selectedIds: string[]): LlamaDevice[] {
  if (!selectedIds.length) return devices;
  const allow = new Set(selectedIds);
  return devices.filter((d) => allow.has(d.id));
}

/**
 * Construye el VramBreakdown para render: reparte el total entre los devices
 * seleccionados según tensor-split (o proporcional a freeMiB si no hay).
 *
 * Consideraciones:
 *  - Si `meta.weightsFileMiB` está disponible (resuelto desde -hf/--model), se
 *    usa como peso EXACTO en vez de params × bytes/param.
 *  - --cache-reuse reduce el KV cache: solo se paga el ctx efectivo (ctx − reuse).
 *  - Si --no-mmproj NO está activo y hay mmproj, se suma su tamaño al overhead.
 *
 * No hay inflado por vendor: los componentes son determinísticos. La fuente de
 * error residual es el overhead (buffers del backend), que se modela como una
 * parte fija + parte proporcional a ubatch.
 */
export function buildBreakdown(
  meta: ModelMeta,
  params: TunedParams,
  devices: LlamaDevice[],
): VramBreakdown {
  const selected = selectDevices(devices, params.device);
  const totalFree = selected.reduce((s, d) => s + d.freeMiB, 0);
  const est = estimateVramMiB(
    meta,
    params.ctxSize,
    params.cacheTypeK,
    params.cacheTypeV,
    params.ubatchSize,
    params.ngl,
  );

  if (!est) {
    return {
      perDeviceMiB: selected.map(() => 0),
      totalMiB: 0,
      weightsMiB: 0,
      kvMiB: 0,
      overheadMiB: 0,
      fits: false,
    };
  }

  // 1) Pesos: estimateVramMiB ya usó weightsFileMiB si estaba disponible.
  const weightsMiB = est.weights;

  // 2) Overhead: base + mmproj si NO está desactivado (--no-mmproj off).
  let overheadMiB = est.overhead;
  if (!params.noMmproj && meta.mmprojSizeMiB != null) {
    overheadMiB += meta.mmprojSizeMiB;
  }
  // spec-draft: el batch de verificación crece (1 → n+1 tokens), agrandando los
  // buffers de atención (KQ mask) en cada capa offload. NO hay fórmula oficial
  // de llama.cpp (depende de backend/versión/arquitectura); coeficientes
  // calibrados empíricamente como fracción del peso en VRAM para escalar a
  // cualquier modelo: activar ~8%, cada token extra +3.5%.
  if (params.specDraftMax > 0) {
    overheadMiB += weightsMiB * (0.08 + 0.035 * (params.specDraftMax - 1));
  }

  // 3) KV cache: --cache-reuse reduce el ctx efectivo que se paga fresco.
  const effectiveCtx = Math.max(0, params.ctxSize - params.cacheReuse);
  const estEffective = estimateVramMiB(
    meta,
    effectiveCtx,
    params.cacheTypeK,
    params.cacheTypeV,
    params.ubatchSize,
    params.ngl,
  );
  const kvMiB = estEffective?.kv ?? est.kv;

  const totalBase = weightsMiB + kvMiB + overheadMiB;

  // Reparto entre devices por pesos (tensor-split o proporcional a freeMiB).
  let weights: number[];
  if (params.tensorSplit && params.tensorSplit.length === selected.length) {
    weights = params.tensorSplit;
  } else {
    weights = selected.map((d) => d.freeMiB || 1);
  }
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const perDevice = selected.map((_, i) => (totalBase * weights[i]) / sumW);

  // Total = suma de porciones (consistente con las barras por device).
  const totalMiB = perDevice.reduce((a, b) => a + b, 0);

  return {
    perDeviceMiB: perDevice,
    totalMiB,
    weightsMiB,
    kvMiB,
    overheadMiB,
    fits: totalMiB <= totalFree,
  };
}

/** VRAM total libre de los devices seleccionados (suma de freeMiB). */
export function totalFreeFor(devices: LlamaDevice[], selectedIds: string[]): number {
  return selectDevices(devices, selectedIds).reduce((s, d) => s + d.freeMiB, 0);
}

/** Catálogo de tipos de KV cache ordenados por calidad. */
export const KV_TYPES = ['f16', 'q8_0', 'q5_1', 'q5_0', 'q4_1', 'q4_0', 'iq4_nl'];
