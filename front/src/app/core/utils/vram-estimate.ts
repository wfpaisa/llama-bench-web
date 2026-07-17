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
