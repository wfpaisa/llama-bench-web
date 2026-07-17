// StorageService: envuelve las claves de localStorage usadas por la app
// (script, prompt, orden del historial, calibración del optimizador…) con
// try/catch para tolerar cuotas/cookies bloqueadas. Devuelve valores ya parseados.
// El filtrado por modelo lo maneja PrimeNG (p-columnFilter) y no se persiste.

import { Injectable } from '@angular/core';
import type { DryfitResponse, VramBreakdown } from '../models/types';

/** Calibración persistida: medición real + heurística del momento de calibrar
 * (esta última sirve de referencia para que los sliders muevan las barras por
 * delta respecto a la medición real, en vez de mostrar un valor estático). */
export interface StoredCalibration {
  measured: DryfitResponse;
  /** Heurística (VramBreakdown) con los params del momento de calibrar. */
  heuristic: VramBreakdown;
}

export interface SortState {
  col: string;
  dir: 'asc' | 'desc';
}

const KEYS = {
  script: 'plane-llama-bench-script',
  prompt: 'plane-llama-bench-prompt',
  sort: 'plane-llama-bench-sort',
  maxTokens: 'plane-llama-bench-max-tokens',
  maxTokensEnabled: 'plane-llama-bench-max-tokens-enabled',
  historyColumns: 'plane-llama-bench-history-columns',
  calibration: 'plane-llama-bench-calibration',
} as const;

@Injectable({ providedIn: 'root' })
export class StorageService {
  // ── Script ──
  loadScript(): string | null {
    return this.getNonEmpty(KEYS.script);
  }
  saveScript(value: string): void {
    this.set(KEYS.script, value);
  }

  // ── Prompt ──
  loadPrompt(): string | null {
    return this.getNonEmpty(KEYS.prompt);
  }
  savePrompt(value: string): void {
    this.set(KEYS.prompt, value);
  }

  // ── Orden de historial ──
  loadSort(): SortState | null {
    try {
      const raw = localStorage.getItem(KEYS.sort);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<SortState>;
      if (
        parsed &&
        typeof parsed.col === 'string' &&
        (parsed.dir === 'asc' || parsed.dir === 'desc')
      ) {
        return { col: parsed.col, dir: parsed.dir };
      }
      return null;
    } catch {
      return null;
    }
  }
  saveSort(value: SortState): void {
    this.set(KEYS.sort, JSON.stringify(value));
  }
  /** Borra el sort persistido (estado "sin orden" de la tabla de historial). */
  clearSort(): void {
    try {
      localStorage.removeItem(KEYS.sort);
    } catch {
      /* ignore */
    }
  }

  // ── Max Tokens (valor + habilitado) ──
  loadMaxTokens(): number | null {
    try {
      const raw = localStorage.getItem(KEYS.maxTokens);
      if (raw == null) return null;
      const n = Number(raw);
      return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
      return null;
    }
  }
  saveMaxTokens(value: number): void {
    this.set(KEYS.maxTokens, String(value));
  }

  loadMaxTokensEnabled(): boolean | null {
    try {
      const raw = localStorage.getItem(KEYS.maxTokensEnabled);
      if (raw == null) return null;
      return raw === 'true';
    } catch {
      return null;
    }
  }
  saveMaxTokensEnabled(value: boolean): void {
    this.set(KEYS.maxTokensEnabled, String(value));
  }

  // ── Columnas visibles del historial ──
  loadHistoryColumns(): string[] | null {
    try {
      const raw = localStorage.getItem(KEYS.historyColumns);
      if (!raw) return null;
      const arr = JSON.parse(raw);
      return Array.isArray(arr) && arr.every((x) => typeof x === 'string') ? arr : null;
    } catch {
      return null;
    }
  }
  saveHistoryColumns(cols: string[]): void {
    this.set(KEYS.historyColumns, JSON.stringify(cols));
  }

  // ── Calibración del optimizador (medición real por modelo) ──
  // Se guarda keyed por el identificador del modelo (meta.raw, p.ej. el -hf)
  // para que persista entre sesiones y se descarte al cambiar de modelo.
  // Estructura: { [modelKey]: StoredCalibration }.
  loadCalibration(modelKey: string): StoredCalibration | null {
    try {
      const raw = localStorage.getItem(KEYS.calibration);
      if (!raw) return null;
      const all = JSON.parse(raw) as Record<string, StoredCalibration>;
      const entry = all[modelKey];
      return entry && entry.measured?.totalMiB != null ? entry : null;
    } catch {
      return null;
    }
  }

  saveCalibration(modelKey: string, calibration: StoredCalibration): void {
    try {
      const raw = localStorage.getItem(KEYS.calibration);
      const all: Record<string, StoredCalibration> = raw ? JSON.parse(raw) : {};
      all[modelKey] = calibration;
      this.set(KEYS.calibration, JSON.stringify(all));
    } catch {
      /* ignore quota */
    }
  }

  // ── Helpers internos ──
  private getNonEmpty(key: string): string | null {
    try {
      const s = localStorage.getItem(key);
      return s && s.length > 0 ? s : null;
    } catch {
      return null;
    }
  }

  private set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* ignore quota / private mode */
    }
  }
}
