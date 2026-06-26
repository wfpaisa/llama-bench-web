// Funciones puras de formato y parseo, portadas desde el frontend vanilla
// (src/front/app.ts). Sin estado ni dependencias, fáciles de testear y reutilizar
// desde pipes y plantillas.

import type { BenchmarkResult } from '../models/types';

/**
 * Formatea un número con N decimales; `—` si es null/undefined.
 */
export function fmt(n: number | null | undefined, d = 2): string {
  return n == null ? '—' : Number(n).toFixed(d);
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

/** Modelo partido en { base, size, quant, mtp } para los badges. */
export interface ParsedModel {
  base: string;
  size: string | null;
  quant: string | null;
  mtp: boolean;
}

// Patrones para partir el nombre del modelo en piezas (badges).
const SIZE_RE = /^(\d+B(?:-A\d+B)?|MoE|A\d+B)$/i;
const QUANT_RE = /^(UD-)?(I?Q\d[_A-Z0-9]*|IQ\d[_A-Z0-9]*|F16|F32|BF16|FP16|FP8|TQ\d[_A-Z0-9]*)$/i;

/**
 * Parte un nombre de modelo en { base, size, quant, mtp }.
 *   "Qwen3.6-35B-A3B-UD-Q4_K_S" → { base:"Qwen3.6", size:"35B-A3B", quant:"UD-Q4_K_S", mtp:false }
 *   "Modelo-7B-MTP"             → { base:"Modelo", size:"7B", quant:null, mtp:true }
 */
export function parseModel(m: string | null | undefined): ParsedModel | null {
  if (!m) return null;
  const full = modelBase(m) ?? m;
  const hasMtp = /MTP/i.test(full);
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
  const baseEnd = sizeStart >= 0 ? sizeStart : 1;
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
  return { base, size, quant, mtp: hasMtp };
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
