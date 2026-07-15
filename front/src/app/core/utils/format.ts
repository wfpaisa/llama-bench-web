// Funciones puras de formato y parseo, portadas desde el frontend vanilla
// (src/front/app.ts). Sin estado ni dependencias, fáciles de testear y reutilizar
// desde pipes y plantillas.

import type {
  BenchmarkResult,
  DeviceVram,
  GpuBackend,
  GpuInfo,
  LlamaDevice,
} from '../models/types';

/** Vista por device del backend para render multi-fila en el historial. */
export interface DeviceVramRow {
  /** Marca en mayúsculas (AMD/NVIDIA/INTEL/—). */
  vendor: string;
  /** Índice del device sin el prefijo del backend (p.ej. "0" de "Vulkan0"). */
  index: string;
  /** GB usados por el modelo (1 decimal); '?' si no se pudo medir. */
  gb: string;
  /** Texto completo para el tooltip (id + nombre + total/free). */
  detail: string;
}

// ── Formateo numérico con locale es-CO (separador de miles "." y decimal ",") ──
// Cache de Intl.NumberFormat por nº de decimales: crear formatters es caro y se
// reutilizan muchísimas veces (una por celda de la tabla de historial).
// useGrouping:true fuerza el agrupamiento de miles SIEMPRE (con el valor por
// defecto 'auto' algunos runtimes no agrupan, p.ej. es-ES, por eso se veía
// "1234" sin separador en Generated tokens).
const numFmtCache = new Map<number, Intl.NumberFormat>();
function numFmt(decimals: number): Intl.NumberFormat {
  let f = numFmtCache.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat('es-CO', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      useGrouping: true,
    });
    numFmtCache.set(decimals, f);
  }
  return f;
}

/**
 * Formatea un número con N decimales y separador de miles es-CO (1.000,00);
 * `—` si es null/undefined.
 */
export function fmt(n: number | null | undefined, d = 2): string {
  return n == null ? '—' : numFmt(d).format(Number(n));
}

/**
 * Convierte MiB → GB (decimal, ÷1000) con N decimales y separador de miles;
 * `—` si null. Pensada para VRAM/RAM que vienen en MiB desde el backend.
 *
 * Usa la convención decimal (1 GB = 1000 MB) —no la binaria (1 GiB = 1024 MiB)—
 * para coincidir con lo que muestran el monitor del SO y nvidia-smi/`watch -n 1
 * nvidia-smi` en su columna de memoria. La etiqueta "GB" es por tanto honesta:
 * la app muestra 15,9 GB para una GPU de 15872 MiB, igual que el sistema.
 */
export function fmtGB(mib: number | null | undefined, d = 2): string {
  return mib == null ? '—' : numFmt(d).format(mib / 1000);
}

/**
 * Convierte milisegundos a "MM:SS" (redondeado); `—` si es null/undefined.
 */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  const totalSec = Math.round(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Convierte milisegundos a segundos (2 decimales); `—` si es null/undefined.
 * Pensada para tiempos como prompt eval time o generation time, mostrándolos
 * siempre en segundos. El sufijo "s" se añade en el template.
 */
export function fmtSec(ms: number | null | undefined): string {
  if (ms == null) return '—';
  return numFmt(2).format(ms / 1000);
}

/**
 * Formatea un elapsed en ms a "M:SS" (sin padding de minutos).
 */
export function formatElapsed(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Nombre corto de modelo: quita el `:quant`, se queda con el último segmento
 * tras `/` y recorta a 22 caracteres.
 */
export function shortModel(m: string | null | undefined): string {
  if (!m) return '—';
  const base = m.split(':')[0];
  return base.split('/').pop()?.slice(0, 22) || base;
}

/**
 * Normaliza un modelo a su base comparable (sin org/ ni sufijo `:quant`)
 * para agrupar/filtrar. p.ej. "unsloth/Qwen3.6-35B-A3B-UD-Q4_K_S" → "Qwen3.6-35B-A3B-UD-Q4_K_S".
 */
export function modelBase(m: string | null | undefined): string | null {
  if (!m) return null;
  const noOrg = m.split(':')[0].split('/').pop() || m;
  return noOrg;
}

/**
 * Nombre del modelo para DISPLAY en la tabla de historial: el `base` que
 * calcula `parseModel` (sin tamaño, MoE, quant, MTP ni GGUF), p.ej.
 * "Qwen3.6-35B-A3B-MTP-GGUF" → "Qwen3.6". Esos detalles van como badges.
 * No afecta a `modelBase` (usado para agrupar/filtrar), solo al texto visible.
 */
export function modelDisplayName(m: string | null | undefined): string | null {
  const parsed = parseModel(m);
  if (!parsed) return modelBase(m);
  return parsed.base;
}

/** Clase de alerta por porcentaje de uso (>90 red, >70 yellow, else green). */
export function alertCls(p: number): 'red' | 'yellow' | 'green' {
  return p > 90 ? 'red' : p > 70 ? 'yellow' : 'green';
}

/** Escapa entidades HTML para inyección segura. */
export function escapeHtml(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) => {
    const map: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[c];
  });
}

/**
 * Etiqueta legible del backend de cómputo del binario (cuda→"CUDA", …).
 * '' si es null/unknown.
 */
export function backendLabel(b: GpuBackend | null | undefined): string {
  if (!b || b === 'unknown') return '';
  return b.charAt(0).toUpperCase() + b.slice(1);
}

/**
 * Etiqueta compuesta del backend de cómputo para el tag del historial.
 *
 * Combina el backend principal con el uso de CPU cuando aplica:
 *  - Backend GPU (cuda/vulkan/…) sin MoE en CPU  → "CUDA", "Vulkan", …
 *  - Backend CPU puro                              → "CPU"
 *  - Backend GPU con expertos MoE en CPU (nCpuMoe>0) → "CUDA + CPU"
 *    (el cómputo principal va en GPU pero parte de los expertos corren en CPU).
 *
 * Devuelve '' si no hay backend detectado ni uso de CPU (no se renderiza el tag).
 */
export function computeBackendLabel(
  b: GpuBackend | null | undefined,
  nCpuMoe: number | null | undefined,
): string {
  const main = backendLabel(b);
  const usesCpu = (nCpuMoe ?? 0) > 0;
  if (!main) return usesCpu ? 'CPU' : '';
  return usesCpu ? `${main} + CPU` : main;
}

/**
 * Severidad (color) del p-tag del backend para pintarlo dentro de la celda
 * del modelo. Convención cromática:
 *   cuda   → success (verde)   — backend nativo/recomendado en NVIDIA
 *   vulkan → danger  (rojo)    — vulkan suele ser más lento/inestable
 *   sycl   → info    (azul)
 *   metal  → warn    (ámbar)
 *   opencl → secondary (gris)
 *   cann   → secondary (gris)
 *   cpu    → secondary (gris)
 * '' si el backend no se detectó (no se renderiza el tag).
 */
export type TagSeverity = 'success' | 'info' | 'warn' | 'danger' | 'secondary' | 'contrast';
export function backendSeverity(b: GpuBackend | null | undefined): TagSeverity {
  switch (b) {
    case 'cuda':
      return 'success';
    case 'vulkan':
      return 'danger';
    case 'sycl':
      return 'info';
    case 'metal':
      return 'warn';
    case 'opencl':
    case 'cann':
    case 'cpu':
      return 'secondary';
    default:
      return 'secondary';
  }
}

/**
 * Línea de VRAM por device del backend para un resultado, usando los ids del
 * binario (CUDA0/Vulkan0, los mismos que --device). Cae a gpuVramLine() (legacy
 * nvidia-smi/sysfs) si el resultado no trae deviceVram (entradas viejas).
 *
 *   deviceVramLine(r)        → "Vulkan0: 2,1 GB · Vulkan1: 9,8 GB"
 *   deviceVramLine(r, true)  → "Vulkan0:2,1, Vulkan1:9,8"  (compacto, sin unidad)
 */
export function deviceVramLine(r: BenchmarkResult, compact = false): string {
  const dv = r.deviceVram;
  if (!dv || dv.length === 0) return gpuVramLine(r, compact);
  return (
    dv
      .map((d) => {
        const gb = d.usedMiB != null ? fmtGB(d.usedMiB, 1) : '?';
        return compact ? `${d.device.id}:${gb}` : `${d.device.id}: ${gb} GB`;
      })
      .join(compact ? ', ' : ' · ') || '—'
  );
}

/**
 * Tooltip con nombre legible de cada device del backend (para hover en el
 * historial). '' si no hay deviceVram.
 */
export function deviceNamesLine(r: BenchmarkResult): string {
  const dv = r.deviceVram;
  if (!dv || dv.length === 0) return '';
  return dv
    .map((d) => `${d.device.id}: ${d.device.name} (${fmtGB(d.device.totalMiB, 1)} GB)`)
    .join(' · ');
}

/** Marca en mayúsculas y legible (AMD/NVIDIA/INTEL), o '—' si es desconocida. */
function vendorUpper(v: LlamaDevice['vendor']): string {
  return v && v !== 'unknown' ? v.toUpperCase() : '—';
}

/**
 * Una fila por device del backend para render multi-fila en la celda VRAM:
 *   { vendor:"AMD", index:"0", gb:"1,5", detail:"Vulkan0: AMD … (8,2 GB, 5,4 GB libres)" }
 * `index` es el número tras el prefijo del backend ("Vulkan0" → "0"). Devuelve []
 * si no hay deviceVram (el template cae al fallback legacy).
 */
export function deviceVramRows(r: BenchmarkResult): DeviceVramRow[] {
  const dv = r.deviceVram;
  if (!dv || dv.length === 0) return [];
  return dv.map((d: DeviceVram) => {
    const dev = d.device;
    // El id del backend termina en dígitos: "Vulkan0" → "0", "CUDA0" → "0".
    const num = dev.id.match(/(\d+)$/)?.[1] ?? dev.id;
    return {
      vendor: vendorUpper(dev.vendor),
      index: num,
      gb: d.usedMiB != null ? fmtGB(d.usedMiB, 1) : '?',
      detail: `${dev.id}: ${dev.name} (${fmtGB(dev.totalMiB, 1)} GB, ${fmtGB(dev.freeMiB, 1)} GB libres)`,
    };
  });
}

/**
 * VRAM total usada (suma de devices del backend) en GB; '—' si no hay.
 * Cae a totalVramTxt() (legacy suma de gpus) si no hay deviceVram.
 * Devuelve SOLO el valor (sin "GB"); la unidad va como <small> en el template.
 */
export function totalDeviceVramTxt(r: BenchmarkResult): string {
  const dv = r.deviceVram;
  if (!dv || dv.length === 0) return totalVramTxt(r);
  const totalMiB = dv.reduce((sum, d) => sum + (d.usedMiB ?? 0), 0);
  return totalMiB > 0 ? fmtGB(totalMiB, 1) : '—';
}

/**
 * Reformatea un script de llama-server: elimina `\` de continuación, tokeniza,
 * agrupa cada flag con su valor y reconstruye con una flag por línea.
 */
export function formatScript(text: string): string {
  // Quitar `\` de continuación y su newline, dejando un string plano.
  let clean = '';
  let skipNewline = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\') {
      skipNewline = true;
      continue;
    }
    if (skipNewline && ch === '\n') {
      skipNewline = false;
      continue;
    }
    clean += ch;
  }

  // Tokenizar por espacios.
  const tokens = clean.split(/\s+/).filter(Boolean);
  const cmd = tokens[0] || '';
  const flags: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('-')) {
      const next = tokens[i + 1];
      if (next && !next.startsWith('-')) {
        flags.push(`${tok} ${next}`);
        i++;
      } else {
        flags.push(tok);
      }
    }
  }

  const parts: string[] = [cmd];
  for (const f of flags) parts.push(f);
  return parts.join(' \\\n');
}

/** Modelo partido en { base, size, quant, mtp, tags, org } para los badges. */
export interface ParsedModel {
  base: string;
  size: string | null;
  quant: string | null;
  mtp: boolean;
  tags: string[];
  org: string | null;
}

// Patrones para partir el nombre del modelo en piezas (badges).
const SIZE_RE = /^(\d+B(?:-A\d+B)?|MoE|A\d+B)$/i;
const QUANT_RE = /^(UD-)?(I?Q\d[_A-Z0-9]*|IQ\d[_A-Z0-9]*|F16|F32|BF16|FP16|FP8|TQ\d[_A-Z0-9]*)$/i;

/**
 * Parte un nombre de modelo en { base, size, quant, mtp, tags }.
 *   "Qwen3.6-35B-A3B-UD-Q4_K_S"       → { base:"Qwen3.6", size:"35B-A3B", quant:"UD-Q4_K_S", mtp:false, tags:[] }
 *   "gemma-4-26B-A4B-it-qat-GGUF"     → { base:"gemma-4", size:"26B-A4B", quant:null, mtp:false, tags:["IT","QAT"] }
 *   "Modelo-7B-MTP"                   → { base:"Modelo", size:"7B", quant:null, mtp:true, tags:[] }
 */
// Sufijos que se reconocen como tags del modelo (no son quant ni ruido).
const KNOWN_TAGS = new Set([
  'it',
  'sft',
  'dpo',
  'orpo',
  'kto',
  'qat',
  'awq',
  'gguf',
  'lora',
  'rlhf',
  'rm',
  'chat',
  'instruct',
  'pretrain',
  'finetune',
  'ft',
  'flash',
]);

export function parseModel(m: string | null | undefined): ParsedModel | null {
  if (!m) return null;
  const full = modelBase(m) ?? m;
  const hasMtp = /MTP/i.test(full);
  // Org: primer segmento antes de '/' (p.ej. "unsloth").
  const org = m.includes('/') ? m.split('/')[0] : null;
  // Sufijo de quant tras ':' (p.ej. "Qwen...:UD-Q4_K_S").
  let quant: string | null = null;
  let body = full;
  if (m.includes(':')) {
    quant = m.split(':').slice(1).join(':');
    body = m.split(':')[0].split('/').pop() || full;
  }
  const parts = body.split(/-/).filter(Boolean);
  let size: string | null = null;
  let sizeStart = -1;
  let sizeEnd = -1;
  // Localizar el token de tamaño (p.ej. "35B", agrupado con un posible "A3B" MoE).
  for (let i = 0; i < parts.length; i++) {
    if (SIZE_RE.test(parts[i])) {
      sizeStart = i;
      if (i + 1 < parts.length && /^A\d+B$/i.test(parts[i + 1])) {
        size = `${parts[i]}-${parts[i + 1]}`;
        sizeEnd = i + 1;
      } else {
        size = parts[i];
        sizeEnd = i;
      }
      break;
    }
  }
  // Determinar donde termina el base name.
  let baseEnd: number;
  if (sizeStart >= 0) {
    baseEnd = sizeStart;
  } else {
    // Sin size: el base abarca hasta el primer tag/quant reconocido.
    let firstNonBase = parts.length;
    for (let i = 1; i < parts.length; i++) {
      if (KNOWN_TAGS.has(parts[i].toLowerCase()) || QUANT_RE.test(parts[i])) {
        firstNonBase = i;
        break;
      }
    }
    baseEnd = firstNonBase;
  }
  const base = parts.slice(0, baseEnd).join('-') || body;
  // Quant por sufijo si no vino en ':'.
  if (!quant) {
    for (let i = sizeEnd + 1; i < parts.length; i++) {
      if (QUANT_RE.test(parts[i])) {
        quant = parts.slice(i).join('-');
        break;
      }
    }
  }
  // Extraer tags reconocidos entre size y quant.
  const tags: string[] = [];
  const tagStart = sizeEnd >= 0 ? sizeEnd + 1 : baseEnd;
  for (let i = tagStart; i < parts.length; i++) {
    if (KNOWN_TAGS.has(parts[i].toLowerCase())) {
      tags.push(parts[i].toUpperCase());
    }
  }
  return { base, size, quant, mtp: hasMtp, tags, org };
}

// Patrones que delatan un modelo MoE (Mixture of Experts):
//   - Token de activos "A3B" (p.ej. "35B-A3B"): total-activos de un MoE.
//   - "MoE" explícito en el nombre.
//   - Familias conocidas: Mixtral (NxNB), DeepSeek-MoE, GR/MoE, Qwen3-MoE…
// Es una heurística de nombre: puede dar falsos negativos en modelos sin el
// sufijo, pero evita mostrar el control --n-cpu-moe en modelos densos.
const MOE_RE = /A\d+B|MoE|Mixtral|\d+x\d+B|GR\d+|OLMoE|SmolLM2?-MoE/i;

/**
 * True si el nombre del modelo es identificable como MoE (Mixture of Experts).
 * Usa el `base` del ModelMeta (familia + tamaño, sin quant). Sirve para mostrar
 * el control --n-cpu-moe solo cuando aplica.
 */
export function isModelMoe(base: string | null | undefined): boolean {
  if (!base) return false;
  return MOE_RE.test(base);
}

/**
 * Etiqueta legible del dispositivo GPU: el índice crudo que reporta el SO
 * (p.ej. "nvidia0", "amdgpu-card0"), normalizado a minúsculas y recortado.
 * Unifica el label entre Último resultado e Historial.
 */
export function gpuLabel(g: GpuInfo): string {
  return (g.index || g.vendor || 'gpu').trim();
}

/**
 * Línea de VRAM por GPU para un resultado, con índice del SO legible.
 *   gpuVramLine(r)              → "nvidia0: 1.234,5 GB · nvidia1: 987,6 GB"
 *   gpuVramLine(r, true)        → "nvidia0:1.234,5, nvidia1:987,6"  (compacto, sin unidad)
 * El modo NO compacto incluye "GB" por GPU (para la card de Último resultado,
 * donde se muestran varias GPUs en una sola línea pequeña). El compacto
 * (Historial) omite la unidad porque va como <small> estilado en la celda.
 * Devuelve '—' si no hay GPUs.
 */
export function gpuVramLine(r: BenchmarkResult, compact = false): string {
  if (!r.gpus || r.gpus.length === 0) return '—';
  return (
    r.gpus
      .map((g) => {
        const gb = g.memUsedMiB != null ? fmtGB(g.memUsedMiB, 1) : '?';
        return compact ? `${gpuLabel(g)}:${gb}` : `${gpuLabel(g)}: ${gb} GB`;
      })
      .join(compact ? ', ' : ' · ') || '—'
  );
}

/**
 * VRAM total usada (suma de GPUs) en GB con separador de miles; '—' si no hay.
 * Devuelve SOLO el valor (sin unidad "GB"); la unidad se añade como `<small>`
 * estilado en la plantilla.
 */
export function totalVramTxt(r: BenchmarkResult): string {
  const totalMiB = (r.gpus || []).reduce((sum, g) => sum + (g.memUsedMiB ?? 0), 0);
  return totalMiB > 0 ? fmtGB(totalMiB, 1) : '—';
}

/**
 * Compute de "mejores" valores sobre toda la history, para resaltar celdas.
 * Devuelve -Infinity/Infinity como centinelas cuando no hay datos.
 */
export function computeBests(history: BenchmarkResult[]): {
  p: number;
  g: number;
  d: number;
  l: number;
  gt: number;
} {
  return {
    p: Math.max(...history.map((h) => h.promptTokensPerSecond ?? -Infinity), -Infinity),
    g: Math.max(...history.map((h) => h.generationTokensPerSecond ?? -Infinity), -Infinity),
    d: Math.max(...history.map((h) => h.draftAcceptance ?? -Infinity), -Infinity),
    l: Math.min(...history.map((h) => h.loadTimeSeconds ?? Infinity), Infinity),
    gt: Math.min(...history.map((h) => h.generationTimeMs ?? Infinity), Infinity),
  };
}
