// StorageService: envuelve las 4 claves de localStorage usadas por la app
// (script, prompt, orden del historial, filtro de modelo) con try/catch para
// tolerar cuotas/cookies bloqueadas. Devuelve valores ya parseados.

import { Injectable } from '@angular/core';

export interface SortState {
  col: string;
  dir: 'asc' | 'desc';
}

const KEYS = {
  script: 'llama-bench-script',
  prompt: 'llama-bench-prompt',
  sort: 'llama-bench-sort',
  modelFilter: 'llama-bench-model-filter',
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

  // ── Filtro de modelo ──
  loadModelFilter(): string {
    try {
      return localStorage.getItem(KEYS.modelFilter) || '';
    } catch {
      return '';
    }
  }
  saveModelFilter(value: string): void {
    this.set(KEYS.modelFilter, value);
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
