// BenchStore: estado global de la app con signals.
// Centraliza todo el estado mutable (status, logs, gpus, historial, script,
// prompt, selección, orden, benchmark) y las actions que lo mutan, más los
// effects que persisten script/prompt/sort/filter en localStorage.
// Los componentes solo leen signals y llaman actions: nada de manejo de estado
// en plantillas.

import { computed, effect, inject, Injectable, signal } from '@angular/core';
import {
  BenchmarkResult,
  GpuInfo,
  LogEntry,
  RamInfo,
  ServerStatus,
  StatusResponse,
} from '../models/types';
import { computeBests } from '../utils/format';
import { StorageService } from '../services/storage.service';

/** "Mejores" valores para resaltar celdas del historial. */
export interface Bests {
  p: number;
  g: number;
  d: number;
  l: number;
  gt: number;
}

/** Tope de líneas de log retenidas en memoria (drop oldest). */
const LOG_CAP = 4000;

/** Prompt por defecto hardcodeado (último recurso si no hay storage ni backend). */
export const DEFAULT_PROMPT_UI = `Un agricultor tiene 17 ovejas. Todas menos 9 se escapan. ¿Cuántas ovejas le quedan? Explica tu razonamiento paso a paso.

Luego resuelve esto sin calculadora: ¿cuántos números primos hay entre 20 y 40? Lista cada uno y verifica brevemente por qué es primo.`;

const EMPTY_STATUS: StatusResponse = {
  status: 'stopped',
  pid: null,
  startedAt: null,
  url: null,
  error: null,
};

@Injectable({ providedIn: 'root' })
export class BenchStore {
  private readonly storage = inject(StorageService);

  // ── Estado crudo del backend ──
  readonly status = signal<StatusResponse>(EMPTY_STATUS);
  readonly logs = signal<LogEntry[]>([]);
  readonly logCursor = signal(0);
  readonly gpus = signal<GpuInfo[]>([]);
  readonly ram = signal<RamInfo | null>(null);
  readonly history = signal<BenchmarkResult[]>([]);

  // ── Script + prompt (fuente de verdad editable) ──
  // Ambos se siembran desde localStorage al construir el store, de modo que al
  // recargar el valor persistido queda disponible de inmediato (antes de que el
  // effect de persistencia pueda ejecutarse). Sin esto, el effect escribía el
  // valor inicial '' y pisoteaba localStorage, por lo que loadInitialScript/Prompt
  // caían siempre al default del archivo. El fallback final del prompt
  // (DEFAULT_PROMPT_UI) lo resuelve loadInitialPrompt en Home cuando ni
  // localStorage ni el backend tienen nada.
  readonly script = signal(this.storage.loadScript() ?? '');
  readonly prompt = signal(this.storage.loadPrompt() ?? '');
  readonly maxTokens = signal(2048);
  /** Si false, el benchmark se ejecuta sin límite de tokens (omisión de max_tokens). */
  readonly maxTokensEnabled = signal(true);

  // ── Estado del benchmark ──
  readonly benchRunning = signal(false);
  readonly benchState = signal('');
  readonly benchTimer = signal('');
  readonly benchStartTime = signal(0);
  readonly lastResult = signal<BenchmarkResult | null>(null);
  readonly showResponse = signal(false);

  // ── Historial: selección, orden ──
  readonly selected = signal<Set<string>>(new Set());
  readonly sortCol = signal('date');
  readonly sortDir = signal<'asc' | 'desc'>('desc');
  readonly showCompare = signal(false);
  readonly showChart = signal(false);

  // ── Logs UI ──
  readonly autoscroll = signal(true);

  // ════════════ Estado derivado (computed) ════════════

  /** ¿El servidor está corriendo o iniciando? */
  readonly running = computed<boolean>(() => {
    const s = this.status().status;
    return s === 'running' || s === 'starting';
  });

  /** Label en español del estado actual. */
  readonly statusLabel = computed<string>(() => {
    const labels: Record<ServerStatus, string> = {
      stopped: 'detenido',
      starting: 'iniciando…',
      running: 'corriendo',
      error: 'error',
    };
    return labels[this.status().status] ?? this.status().status;
  });

  /** Texto de meta: "pid X · url · error". */
  readonly statusMeta = computed<string>(() => {
    const s = this.status();
    let meta = '';
    if (s.pid) meta += `pid ${s.pid} · `;
    if (s.url) meta += `${s.url} · `;
    if (s.error) meta += s.error;
    return meta;
  });

  /** Lista de modelos base únicos para el filtro, ordenada alfabéticamente. */
  readonly modelOptions = computed<string[]>(() => {
    const bases = new Set<string>();
    for (const r of this.history()) {
      const m = r.config?.model;
      if (!m) continue;
      const noOrg = m.split(':')[0].split('/').pop();
      if (noOrg) bases.add(noOrg);
    }
    return [...bases].sort((a, b) => a.localeCompare(b));
  });

  /**
   * Historial ordenado para renderizar en la tabla.
   * El filtrado por modelo lo hace PrimeNG nativamente (p-columnFilter),
   * por eso aquí solo se ordena.
   */
  readonly visibleHistory = computed<BenchmarkResult[]>(() => {
    const list = [...this.history()];
    const col = this.sortCol();
    const dir = this.sortDir();
    const fn = SORT_FNS[col];
    if (!fn) return list;
    list.sort((a, b) => {
      const x = fn(a);
      const y = fn(b);
      return dir === 'asc' ? (x > y ? 1 : x < y ? -1 : 0) : y > x ? 1 : y < x ? -1 : 0;
    });
    return list;
  });

  /** Resultados seleccionados (para comparar). */
  readonly selectedResults = computed<BenchmarkResult[]>(() => {
    const sel = this.selected();
    return this.history().filter((h) => sel.has(h.id));
  });

  /** "Mejores" valores sobre TODA la history (no la filtrada). */
  readonly bests = computed<Bests>(() => computeBests(this.history()));

  /** Cantidad seleccionada. */
  readonly selectedCount = computed(() => this.selected().size);

  // ════════════ Inyección + init ════════════

  constructor() {
    // Persistir script/prompt/sort cuando cambien (effects en injection context).
    // El filtrado por modelo lo maneja PrimeNG (p-columnFilter), no se persiste.
    effect(() => this.storage.saveScript(this.script()));
    effect(() => this.storage.savePrompt(this.prompt()));
    effect(() => this.storage.saveSort({ col: this.sortCol(), dir: this.sortDir() }));
    effect(() => this.storage.saveMaxTokens(this.maxTokens()));
    effect(() => this.storage.saveMaxTokensEnabled(this.maxTokensEnabled()));
  }

  /**
   * Siembra el estado inicial desde localStorage. Llamar una vez al arrancar la app
   * (antes de cualquier carga de datos del backend) para que el sort y los
   * valores persistidos de Max Tokens (valor + habilitado) apliquen desde el
   * primer render.
   */
  init(): void {
    const sort = this.storage.loadSort();
    if (sort) {
      this.sortCol.set(sort.col);
      this.sortDir.set(sort.dir);
    }
    const maxTokens = this.storage.loadMaxTokens();
    if (maxTokens !== null) this.maxTokens.set(maxTokens);
    const enabled = this.storage.loadMaxTokensEnabled();
    if (enabled !== null) this.maxTokensEnabled.set(enabled);
  }

  // ════════════ Actions: status / logs / gpu ════════════

  setStatus(s: StatusResponse): void {
    this.status.set(s);
  }

  /** Añade entradas de log nuevas y avanza el cursor. Respeta el cap (drop oldest). */
  appendLogs(entries: LogEntry[], cursor: number): void {
    if (!entries.length) {
      // Aun sin entradas, mantener el cursor sincronizado.
      if (cursor !== this.logCursor()) this.logCursor.set(cursor);
      return;
    }
    const next = [...this.logs(), ...entries];
    // Drop oldest si excede el cap.
    const overflow = next.length - LOG_CAP;
    const trimmed = overflow > 0 ? next.slice(overflow) : next;
    this.logs.set(trimmed);
    this.logCursor.set(cursor);
  }

  clearLogs(): void {
    this.logs.set([]);
    this.logCursor.set(0);
  }

  setGpus(gpus: GpuInfo[]): void {
    this.gpus.set(gpus);
  }

  setRam(ram: RamInfo | null): void {
    this.ram.set(ram);
  }

  // ════════════ Actions: script / prompt ════════════

  setScript(text: string): void {
    this.script.set(text);
  }

  /** Aplica el formateo sobre el script actual. */
  formatCurrentScript(formatted: string): void {
    this.script.set(formatted);
  }

  setPrompt(text: string): void {
    this.prompt.set(text);
  }

  setMaxTokens(n: number): void {
    this.maxTokens.set(n);
  }

  setMaxTokensEnabled(v: boolean): void {
    this.maxTokensEnabled.set(v);
  }

  setAutoscroll(v: boolean): void {
    this.autoscroll.set(v);
  }

  // ════════════ Actions: benchmark ════════════

  startBenchmark(): void {
    this.benchRunning.set(true);
    this.benchState.set('iniciando servidor y midiendo… (puede tardar)');
    this.benchStartTime.set(Date.now());
    this.benchTimer.set('0:00');
    this.showResponse.set(false);
  }

  /** Refresca el texto del timer transcurrido. */
  tickBenchTimer(): void {
    if (!this.benchRunning()) return;
    const elapsed = Date.now() - this.benchStartTime();
    const totalSec = Math.floor(elapsed / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    this.benchTimer.set(`${min}:${sec.toString().padStart(2, '0')}`);
  }

  /** Marca el benchmark como deteniéndose (clic en Detener). */
  markBenchStopping(): void {
    this.benchState.set('deteniendo…');
  }

  finishBenchmark(result: BenchmarkResult | null): void {
    if (result) {
      this.lastResult.set(result);
      this.showResponse.set(true);
    }
    this.benchRunning.set(false);
    this.benchState.set('');
    this.benchTimer.set('');
  }

  failBenchmark(): void {
    this.benchRunning.set(false);
    this.benchState.set('');
    this.benchTimer.set('');
  }

  // ════════════ Actions: historial ════════════

  setHistory(results: BenchmarkResult[]): void {
    this.history.set(results);
    // Limpiar selección de ids que ya no existen.
    const ids = new Set(results.map((r) => r.id));
    const sel = new Set<string>();
    for (const id of this.selected()) {
      if (ids.has(id)) sel.add(id);
    }
    this.selected.set(sel);
  }

  /** Alterna la selección de un id. */
  toggleSelected(id: string, checked: boolean): void {
    const next = new Set(this.selected());
    if (checked) next.add(id);
    else next.delete(id);
    this.selected.set(next);
  }

  /**
   * Marca/desmarca varios ids a la vez (acción "seleccionar todos").
   * Solo afecta a los ids pasados (las filas visibles tras filtro/paginación);
   * el resto de la selección se conserva.
   */
  selectMany(ids: string[], checked: boolean): void {
    if (!ids.length) return;
    const next = new Set(this.selected());
    if (checked) for (const id of ids) next.add(id);
    else for (const id of ids) next.delete(id);
    this.selected.set(next);
  }

  isSelected(id: string): boolean {
    return this.selected().has(id);
  }

  /** Reordena por columna: alterna dirección si es la misma, si no, desc. */
  sortBy(col: string): void {
    if (this.sortCol() === col) {
      this.sortDir.set(this.sortDir() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortCol.set(col);
      this.sortDir.set('desc');
    }
  }

  // ── Comparación ──
  openCompare(): boolean {
    if (this.selectedResults().length < 2) return false;
    this.showCompare.set(true);
    return true;
  }
  closeCompare(): void {
    this.showCompare.set(false);
  }

  // ── Gráfico ──
  openChart(): boolean {
    if (this.selectedResults().length < 1) return false;
    this.showChart.set(true);
    return true;
  }
  closeChart(): void {
    this.showChart.set(false);
  }
}

// Comparadores por columna para el orden del historial. Mismos del vanilla.
const SORT_FNS: Record<string, (r: BenchmarkResult) => number> = {
  date: (r) => new Date(r.timestamp).getTime(),
  ctx: (r) => r.config.ctxSize ?? -Infinity,
  promptTps: (r) => r.promptTokensPerSecond ?? -Infinity,
  genTps: (r) => r.generationTokensPerSecond ?? -Infinity,
  draftAcc: (r) => r.draftAcceptance ?? -Infinity,
  loadTime: (r) => r.loadTimeSeconds ?? Infinity,
  generationTime: (r) => r.generationTimeMs ?? Infinity,
  totalVram: (r) => {
    // Preferir deviceVram (delta de devices del backend); fallback a gpus legacy.
    if (r.deviceVram && r.deviceVram.length > 0) {
      return r.deviceVram.reduce((s, d) => s + (d.usedMiB ?? 0), 0);
    }
    return r.gpus.reduce((s, g) => s + (g.memUsedMiB ?? 0), 0);
  },
  ramUsed: (r) => r.ramUsedMiB ?? -Infinity,
};
