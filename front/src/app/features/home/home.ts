import { ChangeDetectionStrategy, Component, DestroyRef, OnDestroy, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval, Subscription } from 'rxjs';
import { switchMap } from 'rxjs/operators';

import { BenchStore, DEFAULT_PROMPT_UI } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { StorageService } from '../../core/services/storage.service';

import { StatusBar } from '../status-bar/status-bar';
import { ScriptEditor } from '../script-editor/script-editor';
import { BenchmarkPanel } from '../benchmark-panel/benchmark-panel';
import { ResponseCard } from '../response-card/response-card';
import { GpuGrid } from '../gpu-grid/gpu-grid';
import { LastResult } from '../last-result/last-result';
import { HistoryTable } from '../history-table/history-table';
import { CompareModal } from '../compare-modal/compare-modal';
import { LogsViewer } from '../logs-viewer/logs-viewer';

/**
 * Home: orquestador de la página principal.
 * - Siembra el store desde localStorage al iniciar.
 * - Carga inicial: script, prompt, status, history, gpus.
 * - Arranca el polling (status 1.5s, logs 1s, gpu 4s) y lo libera al destruir.
 * - Compone todos los feature components en secciones.
 */
@Component({
  selector: 'app-home',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    StatusBar,
    ScriptEditor,
    BenchmarkPanel,
    ResponseCard,
    GpuGrid,
    LastResult,
    HistoryTable,
    CompareModal,
    LogsViewer,
  ],
  template: `
    <main class="home">
      <app-status-bar />

      <app-script-editor />
      <app-benchmark-panel />
      <app-response-card />
      <app-gpu-grid />
      <app-last-result />
      <app-history-table />
      <app-logs-viewer />
      <app-compare-modal />
    </main>
  `,
  styles: [
    `
      .home {
        max-width: 1400px;
        margin: 0 auto;
        padding: 1rem 1.5rem 3rem;
        display: flex;
        flex-direction: column;
        gap: 1rem;
      }
    `,
  ],
})
export class Home implements OnDestroy {
  private readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly storage = inject(StorageService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly subs: Subscription[] = [];

  constructor() {
    // 1) Sembrar estado persistido (sort, filter) antes de cualquier render de datos.
    this.store.init();

    // 2) Carga inicial de script/prompt (3-tier: localStorage > backend default > fallback).
    this.loadInitialScript();
    this.loadInitialPrompt();

    // 3) Cargas iniciales puntuales.
    this.pollStatus();
    this.loadHistory();
    this.loadGpus();

    // 4) Polling periódico.
    this.startPolling();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  // ── Carga inicial de script ──
  private loadInitialScript(): void {
    const stored = this.storage.loadScript();
    if (stored !== null) {
      this.store.setScript(stored);
      return;
    }
    this.api.getScriptDefault().subscribe({
      next: (text) => {
        if (text && text.length) this.store.setScript(text);
      },
      error: () => {
        /* 404 o sin backend → editor vacío */
      },
    });
  }

  // ── Carga inicial de prompt ──
  private loadInitialPrompt(): void {
    const stored = this.storage.loadPrompt();
    if (stored !== null) {
      this.store.setPrompt(stored);
      return;
    }
    this.api.getPromptDefault().subscribe({
      next: (text) => {
        if (text && text.length) this.store.setPrompt(text);
        else this.store.setPrompt(DEFAULT_PROMPT_UI);
      },
      error: () => this.store.setPrompt(DEFAULT_PROMPT_UI),
    });
  }

  // ── Cargas puntuales ──
  private pollStatus(): void {
    this.api.getStatus().subscribe({
      next: (s) => this.store.setStatus(s),
      error: () => {
        /* backend reiniciándose */
      },
    });
  }

  private loadHistory(): void {
    this.api.getHistory().subscribe({
      next: (h) => this.store.setHistory(h.results || []),
      error: () => {
        /* ignore */
      },
    });
  }

  private loadGpus(): void {
    this.api.getGpus().subscribe({
      next: (data) => {
        this.store.setGpus(data.gpus);
        this.store.setRam(data.ram ?? null);
      },
      error: () => {
        this.store.setGpus([]);
        this.store.setRam(null);
      },
    });
  }

  // ── Polling ──
  private startPolling(): void {
    // Status cada 1.5s.
    const status$ = interval(1500)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.api.getStatus()),
      )
      .subscribe({
        next: (s) => this.store.setStatus(s),
        error: () => {
          /* ignore */
        },
      });

    // Logs cada 1s (incremental vía cursor).
    const logs$ = interval(1000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.api.getLogs(this.store.logCursor())),
      )
      .subscribe({
        next: (data) => this.store.appendLogs(data.entries, data.cursor),
        error: () => {
          /* backend reiniciándose */
        },
      });

    // GPU cada 4s.
    const gpu$ = interval(4000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.api.getGpus()),
      )
      .subscribe({
        next: (data) => {
          this.store.setGpus(data.gpus);
          this.store.setRam(data.ram ?? null);
        },
        error: () => {
          this.store.setGpus([]);
          this.store.setRam(null);
        },
      });

    this.subs.push(status$, logs$, gpu$);
  }
}
