import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { RatingModule } from 'primeng/rating';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService, SelectItemGroup, SortEvent } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { StorageService } from '../../core/services/storage.service';
import { BenchmarkResult, ParsedScript } from '../../core/models/types';
import {
  backendSeverity,
  computeBackendLabel,
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
 * comparar contra las opciones del multiselect, y `totalVramMiB` precalculado
 * para que la columna "Total VRAM" (que no es una prop nativa del resultado)
 * pueda ordenarse con un `field` real que PrimeNG resuelve.
 */
export interface HistoryRow extends BenchmarkResult {
  /** Modelo base (sin org/ ni :quant), campo por el que filtra el multiselect. */
  modelBase: string;
  /** VRAM total usada en MiB (suma de devices del backend o GPUs legacy). */
  totalVramMiB: number;
}

/**
 * Definición de una columna conmutable de la tabla de historial.
 * `key` identifica la columna (se persiste en localStorage).
 * `group` agrupa columnas por familia para tintear fondo y elegir icono:
 *   - 'gen'   → Escritura (generation tokens / time / speed).
 *   - 'read'  → Lectura (prompt tokens / time / speed).
 *   - 'draft' → Especulativo (draft acc / gen dr / acc dr / gen tk / acc tk).
 */
export interface HistoryColumn {
  key: string;
  header: string;
  group?: 'gen' | 'read' | 'draft';
}

/**
 * Metadatos de cada grupo: icono PrimeNG + etiqueta + clase de tinte de fondo.
 * Se usa tanto en el indicador junto al selector como en cada ítem del listado.
 * El grupo 'general' agrupa todas las columnas que no son de generación/lectura/
 * especulación.
 */
export interface ColumnGroupMeta {
  key: 'gen' | 'read' | 'draft' | 'general';
  icon: string;
  label: string;
  /** Clase que aplica el tinte de fondo (definida en el CSS del componente). */
  cellClass: string;
}

/**
 * Claves de las columnas seleccionadas por defecto al primer uso.
 */
const DEFAULT_VISIBLE = [
  'model',
  'backend',
  'ctx',
  'batch',
  'cache',
  'rating',
  'generationTime',
  'genTps',
  'promptTps',
  'promptTime',
  'vram',
  'totalVram',
  'ram',
  'actions',
];

/**
 * Catálogo completo de columnas conmutables de la tabla (orden de render).
 * Las columnas fijas (checkbox) no aparecen aquí.
 */
const COLUMN_DEFS: HistoryColumn[] = [
  { key: 'date', header: 'Fecha' },
  { key: 'rating', header: '★ Calificación' },
  { key: 'model', header: 'Modelo' },
  { key: 'backend', header: 'Backend' },
  { key: 'ctx', header: 'ctx' },
  { key: 'batch', header: 'batch' },
  { key: 'cache', header: 'cache' },
  { key: 'tsplit', header: 'tsplit' },
  { key: 'genTokens', header: 'Generated tokens', group: 'gen' },
  { key: 'generationTime', header: 'Generation time', group: 'gen' },
  { key: 'genTps', header: 'Generation speed', group: 'gen' },
  { key: 'promptTokens', header: 'Prompt tokens', group: 'read' },
  { key: 'promptTime', header: 'Prompt processing time', group: 'read' },
  { key: 'promptTps', header: 'Prompt processing speed', group: 'read' },
  { key: 'draftAcc', header: 'draft acc', group: 'draft' },
  { key: 'genDr', header: 'gen dr', group: 'draft' },
  { key: 'accDr', header: 'acc dr', group: 'draft' },
  { key: 'genTk', header: 'gen tk', group: 'draft' },
  { key: 'accTk', header: 'acc tk', group: 'draft' },
  { key: 'loadTime', header: 'load s' },
  { key: 'vram', header: 'VRAM' },
  { key: 'totalVram', header: 'Total VRAM' },
  { key: 'ram', header: 'RAM' },
  { key: 'actions', header: 'Acciones' },
];

/**
 * Metadatos de los grupos conmutables, para el indicador de leyenda junto al
 * selector de columnas y para tintear/iconizar cada ítem del listado.
 * El orden define el de los grupos en el multiselect.
 */
const COLUMN_GROUPS: ColumnGroupMeta[] = [
  { key: 'gen', icon: 'pi pi-pen-to-square', label: 'Escritura', cellClass: 'col-gen' },
  { key: 'read', icon: 'pi pi-eye', label: 'Lectura', cellClass: 'col-read' },
  { key: 'draft', icon: 'pi pi-eraser', label: 'Especulativo', cellClass: 'col-draft' },
  { key: 'general', icon: 'pi pi-table', label: 'General', cellClass: 'col-general' },
];

/** Orden de los grupos en el listado del multiselect (campo `group` de la opción). */
const GROUP_ORDER: ColumnGroupMeta['key'][] = ['gen', 'read', 'draft', 'general'];

/**
 * Opciones del p-multiselect agrupadas (formato SelectItemGroup[]). El grupo
 * 'general' agrupa todas las columnas que no son escritura/lectura/especulación.
 * Cada ítem conserva el `group` y el `cellClass` para que el template pueda
 * tintear el swatch y el header de grupo.
 */
const GROUPED_COLUMNS: SelectItemGroup[] = GROUP_ORDER.map((gk) => {
  const meta = COLUMN_GROUPS.find((g) => g.key === gk)!;
  const items = COLUMN_DEFS.filter((c) => (c.group ?? 'general') === gk).map((c) => ({
    label: c.header,
    value: c.key,
  }));
  return { label: meta.label, value: gk, items };
});

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
    RatingModule,
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

  /** Catálogo plano completo de columnas (para colVisible / selectedColumns). */
  protected readonly allColumns = COLUMN_DEFS;
  /** Grupos conmutables (leyenda + tinte/icono de cada ítem del listado). */
  protected readonly columnGroups = COLUMN_GROUPS;
  /** Opciones agrupadas para el p-multiselect con [group]="true". */
  protected readonly columnOptions = GROUPED_COLUMNS;
  /** Mapa key → metadatos del grupo, para tintear ítems del multiselect. */
  private readonly groupByKey = new Map(COLUMN_GROUPS.map((g) => [g.key, g]));
  /**
   * Claves de columnas visibles. Se siembra desde localStorage si existe;
   * si no, usa DEFAULT_VISIBLE. El effect persiste cambios.
   */
  protected readonly visibleColumnKeys = signal<string[]>(
    this.storage.loadHistoryColumns() ?? [...DEFAULT_VISIBLE],
  );
  /**
   * Valor seleccionado en el multiselect: claves de columnas (string[]).
   * En modo agrupado el p-multiselect emite los `value` de los ítems.
   */
  protected readonly selectedColumns = computed<string[]>(() => [...this.visibleColumnKeys()]);

  /** Devuelve true si la columna `key` está visible. */
  protected colVisible(key: string): boolean {
    return this.visibleColumnKeys().includes(key);
  }

  /** Metadatos del grupo de una clave de columna (icono + tinte). */
  protected groupOf(key: string): ColumnGroupMeta {
    const col = this.allColumns.find((c) => c.key === key);
    return this.groupByKey.get(col?.group ?? 'general')!;
  }

  /**
   * Metadatos directos por clave de grupo (gen/read/draft/general).
   * A diferencia de `groupOf` (que recibe una clave de *columna*), este recibe
   * la clave del *grupo* tal cual la emite el `SelectItemGroup.value` del
   * p-multiselect agrupado, y devuelve sus metadatos sin derivarlos.
   */
  protected groupMeta(key: ColumnGroupMeta['key']): ColumnGroupMeta {
    return this.groupByKey.get(key) ?? this.groupByKey.get('general')!;
  }

  /** Callback del p-multiselect: sincroniza claves + persiste. */
  protected onColumnsChange(keys: string[]): void {
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
   * Side-effect del sort de la p-table: PrimeNG ya reordenó `[value]`
   * internamente; aquí solo persistimos el estado (columna + dirección) en el
   * store para poder restaurarlo al recargar la página. No tocamos los datos:
   * el orden es responsabilidad de la tabla.
   */
  protected onSort(event: SortEvent | Event): void {
    const { field, order } = event as SortEvent;
    if (field && order) {
      this.store.sortCol.set(field);
      this.store.sortDir.set(order === 1 ? 'asc' : 'desc');
    }
  }

  /**
   * Datos para la tabla: historial visible con campos aplanados que necesita el
   * template/PrimeNG:
   *  - `modelBase`: por el que filtra el p-columnFilter (matchMode "in").
   *  - `totalVramMiB`: suma de VRAM usada (devices del backend o GPUs legacy)
   *    para que la columna "Total VRAM" pueda ordenarse con un `field` real.
   */
  protected readonly tableData = computed<HistoryRow[]>(() =>
    this.store.visibleHistory().map((r) => {
      const dv = r.deviceVram;
      const totalVramMiB =
        dv && dv.length > 0
          ? dv.reduce((s, d) => s + (d.usedMiB ?? 0), 0)
          : (r.gpus || []).reduce((s, g) => s + (g.memUsedMiB ?? 0), 0);
      return {
        ...r,
        modelBase: modelBase(r.config?.model) ?? '',
        totalVramMiB,
      };
    }),
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
  /**
   * Etiqueta del backend (CUDA/Vulkan/…; "CUDA + CPU" si hay expertos MoE en
   * CPU). '' si no se detectó backend ni uso de CPU (no se renderiza el tag).
   */
  protected backend(r: BenchmarkResult): string {
    return computeBackendLabel(r.backend, r.config?.nCpuMoe);
  }
  /** Severidad (color) del tag del backend, según el backend de cómputo. */
  protected backendSeverity(b: BenchmarkResult['backend']) {
    return backendSeverity(b);
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

  /**
   * Persiste el cambio de calificación (1-5 estrellas) de un resultado.
   * Aplica el nuevo valor optimistamente en el store para feedback inmediato;
   * si el backend falla, recarga el historial para revertir y muestra un toast.
   * Un valor de 0 se interpreta como "sin calificar" (null en backend).
   */
  protected onRatingChange(r: BenchmarkResult, value: number | null): void {
    const normalized = !value || value <= 0 ? null : value;
    this.store.setRating(r.id, normalized);
    this.api.setRating(r.id, normalized).subscribe({
      next: () => {
        this.api.getHistory().subscribe({
          next: (h) => this.store.setHistory(h.results || []),
        });
      },
      error: (e: Error) => {
        this.api.getHistory().subscribe({
          next: (h) => this.store.setHistory(h.results || []),
        });
        this.messages.add({
          severity: 'error',
          summary: 'Error al guardar calificación',
          detail: e.message,
          life: 4000,
        });
      },
    });
  }

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

  protected chart(): void {
    if (this.store.selectedCount() < 1) {
      this.messages.add({
        severity: 'warn',
        summary: 'Selecciona al menos un resultado.',
        life: 3000,
      });
      return;
    }
    this.store.openChart();
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
