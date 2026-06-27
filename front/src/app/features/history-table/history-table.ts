import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { TableModule } from 'primeng/table';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { BenchmarkResult, ParsedScript } from '../../core/models/types';
import { fmt, gpuVramLine, modelBase, parseModel, shortModel, totalVramTxt } from '../../core/utils/format';
import { FmtGbPipe, FmtNumPipe, FmtSecPipe } from '../../core/utils/pipes';

/**
 * Fila de historial para la tabla: el resultado original + `modelBase`
 * aplanado para que el p-columnFilter de PrimeNG (matchMode "in") pueda
 * comparar contra las opciones del multiselect.
 */
export interface HistoryRow extends BenchmarkResult {
  /** Modelo base (sin org/ ni :quant), campo por el que filtra el multiselect. */
  modelBase: string;
}

/**
 * HistoryTable: tabla de resultados históricos de benchmarks.
 * - p-table con sort por columna (sortCol/sortDir persistidos en localStorage).
 * - Filtro por modelo base vía p-columnFilter + p-multiselect (filtrado nativo
 *   de PrimeNG, matchMode "in" sobre el campo `modelBase`).
 * - Checkbox por fila para selección multi (Set en el store).
 * - Highlights "best" (mejor prompt/gen T/s, draft acc, load/gen time) sobre
 *   TODA la history, calculados en store.bests.
 * - Botón ↗ aplicar: carga el script del resultado en el editor.
 * - Botón ✕ eliminar: DELETE /history/:id + refresco (con confirmación).
 * - Botón Comparar/Limpiar todo.
 */
@Component({
  selector: 'app-history-table',
  imports: [FormsModule, ButtonModule, MultiSelectModule, TableModule, TooltipModule, FmtNumPipe, FmtSecPipe, FmtGbPipe],
  templateUrl: './history-table.html',
  styleUrl: './history-table.css',
})
export class HistoryTable {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  protected readonly fmt = fmt;
  protected readonly modelOptions = this.store.modelOptions;

  // ── Modos de visualización de la card (estado efímero, no persistido) ──

  /** Full width: la card sale del contenedor de 1400px y ocupa 100vw (en flujo). */
  protected readonly fullWidth = signal(false);
  /** Maximizada: la card se vuelve overlay full-screen con scroll interno. */
  protected readonly maximized = signal(false);

  protected readonly fullWidthLabel = computed(() =>
    this.fullWidth() ? 'Ancho normal' : 'Full width',
  );
  protected readonly maximizeLabel = computed(() =>
    this.maximized() ? 'Reducir' : 'Maximizar',
  );
  protected readonly maximizeIcon = computed(() =>
    this.maximized() ? 'pi pi-window-minimize' : 'pi pi-window-maximize',
  );

  protected toggleFullWidth(): void {
    this.fullWidth.update((v) => !v);
  }
  protected toggleMaximize(): void {
    this.maximized.update((v) => !v);
  }

  /**
   * Datos para la tabla: historial visible con un campo `modelBase` aplanado
   * por el que filtra el p-columnFilter (matchMode "in").
   */
  protected readonly tableData = computed<HistoryRow[]>(() =>
    this.store.visibleHistory().map((r) => ({
      ...r,
      modelBase: modelBase(r.config?.model) ?? '',
    })),
  );

  // ── Helpers de celda ──

  protected dateStr(iso: string): string {
    return new Date(iso).toLocaleString();
  }
  protected modelBaseName(m: string | null | undefined): string {
    return modelBase(m) ?? '—';
  }
  protected parsed(m: string | null | undefined) {
    return parseModel(m);
  }
  protected hasScript(c: ParsedScript | undefined): boolean {
    return !!c && typeof c.script === 'string' && c.script.length > 0;
  }
  /** VRAM por GPU: índice del SO legible (mismo helper que Último resultado). */
  protected gpuTxt(r: BenchmarkResult): string {
    return gpuVramLine(r, true);
  }
  /** VRAM total usada (suma de GPUs). */
  protected totalVramTxt(r: BenchmarkResult): string {
    return totalVramTxt(r);
  }

  // ── Highlights "best" (sobre TODA la history) ──
  protected isBestPrompt(r: BenchmarkResult): boolean {
    const b = this.store.bests();
    return r.promptTokensPerSecond != null && r.promptTokensPerSecond === b.p && b.p > -Infinity;
  }
  protected isBestGen(r: BenchmarkResult): boolean {
    const b = this.store.bests();
    return (
      r.generationTokensPerSecond != null && r.generationTokensPerSecond === b.g && b.g > -Infinity
    );
  }
  protected isBestDraft(r: BenchmarkResult): boolean {
    const b = this.store.bests();
    return r.draftAcceptance != null && r.draftAcceptance === b.d && b.d > -Infinity;
  }
  protected isBestLoad(r: BenchmarkResult): boolean {
    const b = this.store.bests();
    return r.loadTimeSeconds != null && r.loadTimeSeconds === b.l && b.l < Infinity;
  }
  protected isBestGenTime(r: BenchmarkResult): boolean {
    const b = this.store.bests();
    return r.generationTimeMs != null && r.generationTimeMs === b.gt && b.gt < Infinity;
  }

  // ── Selección ──
  protected isSelected(id: string): boolean {
    return this.store.isSelected(id);
  }
  protected onToggle(ev: Event, id: string): void {
    const checked = (ev.target as HTMLInputElement).checked;
    this.store.toggleSelected(id, checked);
  }

  // ── Acciones de fila ──
  protected apply(r: BenchmarkResult): void {
    const script = r.config?.script;
    if (script) {
      this.store.setScript(script);
      this.messages.add({
        severity: 'info',
        summary: `Script de ${shortModel(r.config?.model)} cargado.`,
        life: 2600,
      });
    }
  }

  protected remove(event: Event, r: BenchmarkResult): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Eliminar este resultado del historial?',
      icon: 'pi pi-info-circle',
      acceptButtonProps: { label: 'Eliminar', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', outlined: true },
      accept: () => {
        this.api.deleteResult(r.id).subscribe({
          next: () => {
            this.store.toggleSelected(r.id, false);
            this.api.getHistory().subscribe({
              next: (h) => this.store.setHistory(h.results || []),
            });
            this.messages.add({ severity: 'success', summary: 'Resultado eliminado.', life: 2600 });
          },
          error: (e: Error) =>
            this.messages.add({
              severity: 'error',
              summary: 'Error',
              detail: e.message,
              life: 4000,
            }),
        });
      },
    });
  }

  // ── Acciones de cabecera ──
  protected compare(): void {
    if (this.store.selectedCount() < 2) {
      this.messages.add({
        severity: 'warn',
        summary: 'Selecciona 2 o más resultados.',
        life: 3000,
      });
      return;
    }
    this.store.openCompare();
  }

  protected clearAll(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Borrar todo el historial de benchmarks?',
      header: 'Zona de peligro',
      icon: 'pi pi-exclamation-triangle',
      acceptButtonProps: { label: 'Borrar todo', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', outlined: true },
      accept: () => {
        this.api.clearHistory().subscribe({
          next: () => {
            this.store.setHistory([]);
            this.messages.add({ severity: 'success', summary: 'Historial limpiado.', life: 2600 });
          },
          error: (e: Error) =>
            this.messages.add({
              severity: 'error',
              summary: 'Error',
              detail: e.message,
              life: 4000,
            }),
        });
      },
    });
  }
}
