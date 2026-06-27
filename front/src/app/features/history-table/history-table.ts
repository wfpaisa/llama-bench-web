import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { StorageService } from '../../core/services/storage.service';
import { BenchmarkResult, ParsedScript } from '../../core/models/types';
import {
  backendLabel,
  deviceVramLine,
  deviceVramRows,
  fmt,
  modelBase,
  modelDisplayName,
  parseModel,
  shortModel,
  totalDeviceVramTxt,
  type DeviceVramRow,
} from '../../core/utils/format';
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
 * Definición de una columna conmutable de la tabla de historial.
 * `key` identifica la columna (se persiste en localStorage).
 */
export interface HistoryColumn {
  key: string;
  header: string;
}

/**
 * Claves de las columnas seleccionadas por defecto al primer uso.
 */
const DEFAULT_VISIBLE = [
  'model',
  'generationTime',
  'genTps',
  'vram',
  'totalVram',
  'ram',
  'actions',
  'promptTps',
];

/**
 * Catálogo completo de columnas conmutables de la tabla (orden de render).
 * Las columnas fijas (checkbox) no aparecen aquí.
 */
const COLUMN_DEFS: HistoryColumn[] = [
  { key: 'date', header: 'Fecha' },
  { key: 'model', header: 'Modelo' },
  { key: 'ctx', header: 'ctx' },
  { key: 'batch', header: 'batch' },
  { key: 'cache', header: 'cache' },
  { key: 'device', header: 'device' },
  { key: 'tsplit', header: 'tsplit' },
  { key: 'genTokens', header: 'Generated tokens' },
  { key: 'generationTime', header: 'Generation time' },
  { key: 'genTps', header: 'Generation speed' },
  { key: 'promptTokens', header: 'Prompt tokens' },
  { key: 'promptTime', header: 'Prompt processing time' },
  { key: 'promptTps', header: 'Prompt processing speed' },
  { key: 'draftAcc', header: 'draft acc' },
  { key: 'genDr', header: 'gen dr' },
  { key: 'accDr', header: 'acc dr' },
  { key: 'genTk', header: 'gen tk' },
  { key: 'accTk', header: 'acc tk' },
  { key: 'loadTime', header: 'load s' },
  { key: 'vram', header: 'VRAM' },
  { key: 'totalVram', header: 'Total VRAM' },
  { key: 'ram', header: 'RAM' },
  { key: 'actions', header: 'Acciones' },
];

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
  imports: [
    FormsModule,
    ButtonModule,
    MultiSelectModule,
    TableModule,
    TagModule,
    TooltipModule,
    FmtNumPipe,
    FmtSecPipe,
    FmtGbPipe,
  ],
  templateUrl: './history-table.html',
  styleUrl: './history-table.css',
})
export class HistoryTable {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);
  private readonly storage = inject(StorageService);

  protected readonly fmt = fmt;
  protected readonly modelOptions = this.store.modelOptions;

  // ── Columnas visibles (selector) ──

  /** Catálogo completo de columnas para el p-multiselect del caption. */
  protected readonly allColumns = COLUMN_DEFS;
  /**
   * Claves de columnas visibles. Se siembra desde localStorage si existe;
   * si no, usa DEFAULT_VISIBLE. El effect persiste cambios.
   */
  protected readonly visibleColumnKeys = signal<string[]>(
    this.storage.loadHistoryColumns() ?? [...DEFAULT_VISIBLE],
  );
  protected readonly columnOptions = this.allColumns;
  /** Opciones seleccionadas en el multiselect (objetos completos). */
  protected readonly selectedColumns = computed<HistoryColumn[]>(() => {
    const set = new Set(this.visibleColumnKeys());
    return this.allColumns.filter((c) => set.has(c.key));
  });

  /** Devuelve true si la columna `key` está visible. */
  protected colVisible(key: string): boolean {
    return this.visibleColumnKeys().includes(key);
  }

  /** Callback del p-multiselect: sincroniza claves + persiste. */
  protected onColumnsChange(cols: HistoryColumn[]): void {
    const keys = cols.map((c) => c.key);
    this.visibleColumnKeys.set(keys);
    this.storage.saveHistoryColumns(keys);
  }

  /** Al limpiar (botón ✕ del multiselect): vuelve a las columnas por defecto. */
  protected onColumnsClear(): void {
    const keys = [...DEFAULT_VISIBLE];
    this.visibleColumnKeys.set(keys);
    this.storage.saveHistoryColumns(keys);
  }

  // ── Modos de visualización de la card (estado efímero, no persistido) ──

  /** Full width: la card sale del contenedor de 1400px y ocupa 100vw (en flujo). */
  protected readonly fullWidth = signal(false);
  /** Maximizada: la card se vuelve overlay full-screen con scroll interno. */
  protected readonly maximized = signal(false);

  protected readonly fullWidthLabel = computed(() =>
    this.fullWidth() ? 'Ancho normal' : 'Full width',
  );
  protected readonly maximizeLabel = computed(() => (this.maximized() ? 'Reducir' : 'Maximizar'));
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
    return modelDisplayName(m) ?? '—';
  }
  protected parsed(m: string | null | undefined) {
    return parseModel(m);
  }
  protected hasScript(c: ParsedScript | undefined): boolean {
    return !!c && typeof c.script === 'string' && c.script.length > 0;
  }
  /**
   * Una fila por device del backend para la celda VRAM (vendor + index + GB,
   * con tooltip individual por device). Vacío si no hay deviceVram: en ese
   * caso el template cae al fallback legacy (gpuTxt, una sola línea).
   */
  protected deviceRows(r: BenchmarkResult): DeviceVramRow[] {
    return deviceVramRows(r);
  }
  /** VRAM legacy (una sola línea) para resultados sin deviceVram. */
  protected gpuTxt(r: BenchmarkResult): string {
    return deviceVramLine(r, true);
  }
  /** VRAM total usada (suma de devices del backend; fallback a GPUs legacy). */
  protected totalVramTxt(r: BenchmarkResult): string {
    return totalDeviceVramTxt(r);
  }
  /** Etiqueta del backend (CUDA/Vulkan/…); '' si no se detectó. */
  protected backend(r: BenchmarkResult): string {
    return backendLabel(r.backend);
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

  /**
   * Estado del checkbox "seleccionar todos" del header.
   * - checked: todas las filas visibles están seleccionadas.
   * - indeterminate: algunas (pero no todas) lo están.
   * Se basa en los datos completos de la tabla (tableData) ya que PrimeNG
   * filtra internamente; el toggle aplica sobre las filas que recibe.
   */
  protected readonly selectAllState = computed<{ checked: boolean; indeterminate: boolean }>(() => {
    const rows = this.tableData();
    const sel = this.store.selected();
    let total = 0;
    let marked = 0;
    for (const r of rows) {
      total++;
      if (sel.has(r.id)) marked++;
    }
    return {
      checked: total > 0 && marked === total,
      indeterminate: marked > 0 && marked < total,
    };
  });

  /**
   * Handler del checkbox del header: marca/desmarca todas las filas visibles.
   * Recibe el array de filas actualmente renderizadas (respetando filtro y
   * paginación si se pasa el valor de la tabla).
   */
  protected onToggleAll(ev: Event, rows: HistoryRow[]): void {
    const checked = (ev.target as HTMLInputElement).checked;
    this.store.selectMany(
      rows.map((r) => r.id),
      checked,
    );
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
