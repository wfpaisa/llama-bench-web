import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { EMPTY, interval } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { BenchStore, DEFAULT_PROMPT_UI } from '../../core/state/bench.store';
import { PlaneLlamaBenchService } from '../../core/services/plane-llama-bench.service';
import { LogStreamService } from '../../core/services/log-stream.service';
import { StorageService } from '../../core/services/storage.service';

import { TabsModule } from 'primeng/tabs';

import { ScriptEditor } from '../script-editor/script-editor';
import { BenchmarkPanel } from '../benchmark-panel/benchmark-panel';
import { ResponseCard } from '../response-card/response-card';
import { LastResult } from '../last-result/last-result';
import { HistoryTable } from '../history-table/history-table';
import { CompareModal } from '../compare-modal/compare-modal';
import { ChartModal } from '../chart-modal/chart-modal';
import { OptimizerModal } from '../optimizer-modal/optimizer-modal';
import { LogsViewer } from '../logs-viewer/logs-viewer';

/**
 * Home: orquestador de la página principal.
 * - Siembra el store desde localStorage al iniciar.
 * - Carga inicial: script, prompt, status, history, gpus.
 * - Abre el stream SSE (logs + status en vivo) y deja solo el polling de GPU
 *   (4s), que es un muestreo con cadencia propia.
 * - Compone todos los feature components en secciones.
 */
@Component({
  selector: 'app-home',
  imports: [
    TabsModule,
    ScriptEditor,
    BenchmarkPanel,
    ResponseCard,
    LastResult,
    HistoryTable,
    CompareModal,
    ChartModal,
    OptimizerModal,
    LogsViewer,
  ],
  templateUrl: './home.html',
  styleUrls: ['./home.css'],
})
export class Home {
  /** Protegido: la plantilla lee los flags de apertura para los @defer. */
  protected readonly store = inject(BenchStore);
  private readonly api = inject(PlaneLlamaBenchService);
  private readonly logStream = inject(LogStreamService);
  private readonly storage = inject(StorageService);
  private readonly destroyRef = inject(DestroyRef);

  /** Pestaña activa: 0 = Script server, 1 = Benchmark. */
  protected readonly tab = signal(0);

  constructor() {
    // 1) Sembrar estado persistido (sort, filter) antes de cualquier render de datos.
    this.store.init();

    // 2) Carga inicial de script/prompt (3-tier: localStorage > backend default > fallback).
    this.loadInitialScript();
    this.loadInitialPrompt();

    // 3) Cargas iniciales puntuales.
    this.loadHistory();
    this.loadGpus();

    // 4) Logs + status en vivo por SSE (el servicio se cierra solo al destruir).
    this.logStream.start();

    // 5) Polling de GPU (lo único que sigue siendo muestreo periódico).
    this.startGpuPolling();
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
        /* backend reiniciándose o sin red: conservamos el estado anterior en
           vez de vaciar el store, para no colapsar el monitor a "—". El polling
           recuperará la lectura en cuanto el backend responda. */
      },
    });
  }

  // ── Polling de GPU ──
  // Nota de resiliencia: el catchError va DENTRO del switchMap (sobre el
  // observable del request, no del interval). Así, ante un error transitorio
  // (p.ej. ERR_NETWORK_IO_SUSPENDED al suspender el equipo, backend reiniciándo-
  // se, o pérdida de red), el error se traga con EMPTY y el interval externo
  // SIGUE VIVO: el siguiente tick reintentará el request. Si el catchError
  // estuviera fuera del switchMap, el error mataría el interval y el polling
  // quedaría muerto hasta recargar la página. Ante error conservamos el último
  // estado conocido del store (no lo vaciamos): el monitor de GPU sigue
  // mostrando la última lectura en vez de colapsar a "—".
  private startGpuPolling(): void {
    interval(4000)
      .pipe(
        takeUntilDestroyed(this.destroyRef),
        switchMap(() => this.api.getGpus().pipe(catchError(() => EMPTY))),
      )
      .subscribe((data) => {
        this.store.setGpus(data.gpus);
        this.store.setRam(data.ram ?? null);
      });
  }
}
