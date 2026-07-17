// Utilidades para reescribir flags específicas de un script de llama-server
// preservando el resto (binario, modelo, flags no afinadas). Usado por el
// optimizador para aplicar los parámetros afinados al script del editor.
//
// Reutiliza la lógica de tokenizado de formatScript (colapsa `\`, separa por
// espacios) pero en vez de reconstruir todo, permite setear/quitar flags
// puntuales y reconstruye con una flag por línea.
//
// Flags gestionados por applyTunedParams / parseParamsFromScript:
//   --ctx-size, --n-gpu-layers, --cache-type-k, --cache-type-v,
//   --batch-size, --ubatch-size, --flash-attn on/off,
//   --device (coma-separado), --tensor-split (coma-separado),
//   --n-cpu-moe, --cache-reuse, --no-mmproj (switch),
//   --spec-draft-n-max, --cache-ram.

import type { TunedParams } from '../models/types';

/**
 * Colapsa un script (quita `\` de continuación) y lo tokeniza por espacios.
 * Devuelve los tokens limpios (sin vacíos). Respeta comillas simples/dobles.
 */
export function tokenizeScriptTokens(script: string): string[] {
  let clean = '';
  let skipNewline = false;
  for (let i = 0; i < script.length; i++) {
    const ch = script[i];
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
  return clean.split(/\s+/).filter(Boolean);
}

/**
 * Reconstruye un script desde tokens con una flag por línea y `\` de continuación.
 * El primer token es el binario; los demás se agrupan flag+valor cuando aplica.
 */
export function rebuildScript(tokens: string[]): string {
  if (tokens.length === 0) return '';
  const cmd = tokens[0];
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
    } else {
      // Token suelto sin flag previo (raro): lo metemos como está.
      flags.push(tok);
    }
  }
  return [cmd, ...flags].join(' \\\n');
}

/**
 * Setea el valor de un flag en los tokens. Si el flag existe, reemplaza su
 * valor (o lo agrega si era switch). Si no existe, lo añade al final.
 */
export function setFlagValue(tokens: string[], flag: string, value: string): string[] {
  const out = [...tokens];
  for (let i = 0; i < out.length; i++) {
    if (out[i] === flag) {
      const next = out[i + 1];
      if (next && !next.startsWith('-')) {
        out[i + 1] = value;
      } else {
        out.splice(i + 1, 0, value);
      }
      return out;
    }
  }
  out.push(flag, value);
  return out;
}

/**
 * Setea un flag switch (booleano). Si value es true, asegura que el flag esté.
 * Si es false, lo elimina (junto con su valor si tiene uno).
 */
export function setFlagSwitch(tokens: string[], flag: string, value: boolean): string[] {
  const out = [...tokens];
  const idx = out.indexOf(flag);
  if (value) {
    if (idx === -1) out.push(flag);
    return out;
  }
  if (idx !== -1) {
    // Eliminar también el valor siguiente si no es otra flag.
    const next = out[idx + 1];
    if (next && !next.startsWith('-')) out.splice(idx, 2);
    else out.splice(idx, 1);
  }
  return out;
}

/** Elimina un flag y (si lo tiene) su valor siguiente. */
export function removeFlag(tokens: string[], flag: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === flag) {
      const next = tokens[i + 1];
      if (next && !next.startsWith('-')) i++; // saltar también el valor
      continue;
    }
    out.push(tokens[i]);
  }
  return out;
}

// ── Lectura: extrae TunedParams desde un script crudo ─────────────────────────

/** Devuelve el valor de un flag (string) o null si no aparece. */
function flagValue(tokens: string[], flag: string, aliases: string[] = []): string | null {
  const forms = new Set([flag, ...aliases]);
  for (let i = 0; i < tokens.length; i++) {
    if (forms.has(tokens[i]) && i + 1 < tokens.length) return tokens[i + 1];
  }
  return null;
}

/** Devuelve el valor numérico de un flag, o null si no aparece o no es finito. */
function flagNum(tokens: string[], flag: string, aliases: string[] = []): number | null {
  const v = flagValue(tokens, flag, aliases);
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** True si un flag switch (sin valor) está presente, o si tiene valor "on". */
function flagSwitch(tokens: string[], flag: string, aliases: string[] = []): boolean {
  const forms = new Set([flag, ...aliases]);
  for (let i = 0; i < tokens.length; i++) {
    if (forms.has(tokens[i])) {
      const next = tokens[i + 1];
      // Si tiene valor "off", no cuenta como activado.
      if (next === 'off') return false;
      return true;
    }
  }
  return false;
}

/**
 * Extrae los TunedParams desde un script crudo de llama-server. Lo que no esté
 * presente cae a los defaults de `defaultParams()`. Usado al abrir el optimizador
 * para sembrar los sliders desde lo que ya está en el editor.
 */
export function parseParamsFromScript(script: string): TunedParams {
  const tokens = tokenizeScriptTokens(script);
  const deviceRaw = flagValue(tokens, '--device') ?? '';
  const tsRaw = flagValue(tokens, '--tensor-split') ?? '';
  const tensorSplit = tsRaw
    ? tsRaw
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : null;
  return {
    ctxSize: flagNum(tokens, '--ctx-size') ?? 8192,
    ngl: flagNum(tokens, '--n-gpu-layers', ['-ngl']) ?? 999,
    cacheTypeK: (flagValue(tokens, '--cache-type-k') ?? 'q8_0').toLowerCase(),
    cacheTypeV: (flagValue(tokens, '--cache-type-v') ?? 'q8_0').toLowerCase(),
    batchSize: flagNum(tokens, '--batch-size') ?? 512,
    ubatchSize: flagNum(tokens, '--ubatch-size') ?? 128,
    flashAttn: flagSwitch(tokens, '--flash-attn', ['-fa']),
    device: deviceRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    tensorSplit: tensorSplit && tensorSplit.length ? tensorSplit : null,
    nCpuMoe: flagNum(tokens, '--n-cpu-moe', ['--cpu-moe']) ?? 0,
    cacheReuse: flagNum(tokens, '--cache-reuse') ?? 0,
    noMmproj: flagSwitch(tokens, '--no-mmproj'),
    specDraftMax:
      flagNum(tokens, '--spec-draft-n-max', ['--draft-max', '--draft', '--draft-n']) ?? 0,
    cacheRam: flagNum(tokens, '--cache-ram', ['-cram']) ?? 8192,
  };
}

/**
 * Aplica los parámetros afinados del optimizador a un script, preservando todo
 * lo demás (binario, modelo, sampling, etc.). Reconstruye con una flag por línea.
 *
 * - ctxSize → --ctx-size
 * - ngl → --n-gpu-layers
 * - cacheTypeK/V → --cache-type-k/--cache-type-v
 * - batchSize/ubatchSize → --batch-size/--ubatch-size
 * - flashAttn → --flash-attn on (value flag); false → elimina
 * - device[] → --device (join por coma); [] = elimina el flag
 * - tensorSplit[] → --tensor-split (join por coma); null = elimina el flag
 */
export function applyTunedParams(script: string, params: TunedParams): string {
  let tokens = tokenizeScriptTokens(script);
  tokens = setFlagValue(tokens, '--ctx-size', String(params.ctxSize));
  tokens = setFlagValue(tokens, '--n-gpu-layers', String(params.ngl));
  tokens = setFlagValue(tokens, '--cache-type-k', params.cacheTypeK);
  tokens = setFlagValue(tokens, '--cache-type-v', params.cacheTypeV);
  tokens = setFlagValue(tokens, '--batch-size', String(params.batchSize));
  tokens = setFlagValue(tokens, '--ubatch-size', String(params.ubatchSize));
  // --flash-attn on/off: se escribe como flag con valor.
  tokens = removeFlag(tokens, '--flash-attn');
  if (params.flashAttn) {
    tokens = setFlagValue(tokens, '--flash-attn', 'on');
  }
  if (params.device.length > 0) {
    tokens = setFlagValue(tokens, '--device', params.device.join(','));
  } else {
    tokens = removeFlag(tokens, '--device');
  }
  if (params.tensorSplit && params.tensorSplit.length > 0) {
    tokens = setFlagValue(tokens, '--tensor-split', params.tensorSplit.join(','));
  } else {
    tokens = removeFlag(tokens, '--tensor-split');
  }
  // --n-cpu-moe: si 0, quitar el flag; si >0, setearlo. Se limpia también el
  // --cpu-moe viejo por si quedó de una versión anterior (no son el mismo flag).
  tokens = removeFlag(tokens, '--cpu-moe');
  if (params.nCpuMoe > 0) {
    tokens = setFlagValue(tokens, '--n-cpu-moe', String(params.nCpuMoe));
  } else {
    tokens = removeFlag(tokens, '--n-cpu-moe');
  }
  // --cache-reuse: si 0, quitar; si >0, setearlo.
  if (params.cacheReuse > 0) {
    tokens = setFlagValue(tokens, '--cache-reuse', String(params.cacheReuse));
  } else {
    tokens = removeFlag(tokens, '--cache-reuse');
  }
  // --no-mmproj: switch.
  tokens = setFlagSwitch(tokens, '--no-mmproj', params.noMmproj);
  // --spec-draft-n-max: si 0, quitar; si >0, setearlo (limpia aliases viejos).
  for (const alias of ['--draft-max', '--draft', '--draft-n']) {
    tokens = removeFlag(tokens, alias);
  }
  if (params.specDraftMax > 0) {
    tokens = setFlagValue(tokens, '--spec-draft-n-max', String(params.specDraftMax));
  } else {
    tokens = removeFlag(tokens, '--spec-draft-n-max');
  }
  // --cache-ram: se escribe siempre con el valor del slider (default 8192).
  tokens = setFlagValue(tokens, '--cache-ram', String(params.cacheRam));
  return rebuildScript(tokens);
}
