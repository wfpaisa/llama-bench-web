import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { RatingModule } from 'primeng/rating';
import { TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { TooltipModule } from 'primeng/tooltip';
import { ConfirmationService, MessageService, SelectItemGroup, SortEvent } from 'primeng/api';
import { Table } from 'primeng/table';
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

  /** Referencia al p-table (#dt): para resetear el sort interno al llegar al
   *  3er clic (estado "sin orden") y refrescar los iconos de las columnas. */
  protected readonly table = viewChild<Table>('dt');

  /**
   * `sortOrder` numérico que espera el binding `[sortOrder]` del p-table:
   * 1 (asc), -1 (desc) o 0 (sin orden). Cuando es 0 y `sortField` es null la
   * tabla no aplica sort y los iconos quedan en estado neutral.
   */
  protected readonly sortOrderNum = computed<number>(() => {
    const d = this.store.sortDir();
    return d === 'asc' ? 1 : d === 'desc' ? -1 : 0;
  });

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
  protected readonly fullWidth = signal(true);
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
   * Máquina de sort de 3 estados por columna (patrón removableSort):
   *   asc → desc → (sin orden) → asc → …
   * Con `customSort=true`, PrimeNG delega el orden en este handler vía
   * `(sortFunction)` y NO reordena `[value]` por su cuenta. El orden real lo
   * aplica el `computed` `tableData` según `sortCol`/`sortDir` del store, así
   * que aquí solo avanzamos la máquina de estados y dejamos que la reactividad
   * propague el nuevo orden a la tabla.
   *
   * El 3er estado (sin orden) limpia el sort interno de la p-table
   * (`_sortField`/`_sortOrder`) y refresca los iconos de las columnas vía
   * `tableService.onSort(null)`, sin tocar los filtros (a diferencia de
   * `dt.reset()`, que además los borra).
   *
   * Guard de idempotencia: `sortFunction` se dispara tanto por clic del
   * usuario como por la propagación reactiva de `[sortField]`/`[sortOrder]`
   * cuando el store cambia. Si el evento coincide exactamente con el estado
   * actual del store, es la re-emisión y se ignora (evita bucles y que un
   * mismo clic cuente doble).
   */
  protected onSort(event: SortEvent | Event): void {
    const { field } = event as SortEvent;
    if (!field) return;
    const curCol = this.store.sortCol();
    const curDir = this.store.sortDir();

    // Re-emisión reactiva: el evento refleja el estado ya aplicado → ignorar.
    if (
      field === curCol &&
      (event as SortEvent).order === (curDir === 'asc' ? 1 : curDir === 'desc' ? -1 : 0)
    ) {
      return;
    }

    if (field === curCol && curDir === 'asc') {
      // 2do clic sobre la misma columna → descendente.
      this.store.sortDir.set('desc');
    } else if (field === curCol && curDir === 'desc') {
      // 3er clic sobre la misma columna → sin orden.
      this.store.sortCol.set(null);
      this.store.sortDir.set(null);
      this.clearTableSort();
    } else {
      // Columna nueva (o veníamos de "sin orden") → empieza en ascendente.
      this.store.sortCol.set(field);
      this.store.sortDir.set('asc');
    }
  }

  /**
   * Limpia el estado de sort interno de la p-table (iconos + `_sortField`/
   * `_sortOrder`) para reflejar el estado "sin orden". Se difiere una microtask
   * para que corra tras el ciclo de change detection que propagó los bindings
   * `[sortField]`/`[sortOrder]` a null.
   */
  private clearTableSort(): void {
    queueMicrotask(() => {
      const dt = this.table();
      if (!dt) return;
      dt._sortField = null;
      dt._sortOrder = dt.defaultSortOrder;
      dt.tableService.onSort(null);
    });
  }

  /**
   * Datos para la tabla: historial visible con campos aplanados que necesita el
   * template/PrimeNG, ORDENADOS según `sortCol`/`sortDir` del store.
   *  - `modelBase`: por el que filtra el p-columnFilter (matchMode "in").
   *  - `totalVramMiB`: suma de VRAM usada (devices del backend o GPUs legacy)
   *    para que la columna "Total VRAM" pueda ordenarse con un `field` real.
   *
   * Como la tabla usa `customSort`, PrimeNG NO reordena `[value]`; el orden lo
   * aplicamos aquí con un comparador equivalente al interno de PrimeNG
   * (null-safe + `localeCompare` para strings), que además soporta campos
   * anidados con notación punto (`config.ctxSize`). Si no hay sort activo
   * (3er estado), se conserva el orden natural (inserción del historial).
   */
  protected readonly tableData = computed<HistoryRow[]>(() => {
    const rows = this.store.visibleHistory().map((r) => {
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
    });
    const col = this.store.sortCol();
    const dir = this.store.sortDir();
    if (!col || !dir) return rows;
    const order = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => order * compareField(a, b, col));
  });

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

  protected deleteSelected(event: Event): void {
    const ids = [...this.store.selected()];
    const count = ids.length;
    this.confirm.confirm({
      target: event.target as EventTarget,
      message:
        count === 1
          ? '¿Eliminar el resultado seleccionado del historial?'
          : `¿Eliminar ${count} resultados seleccionados del historial?`,
      icon: 'pi pi-info-circle',
      acceptButtonProps: { label: 'Eliminar', severity: 'danger' },
      rejectButtonProps: { label: 'Cancelar', severity: 'secondary', outlined: true },
      accept: () => {
        this.api.deleteSelected(ids).subscribe({
          next: () => {
            this.store.selectMany(ids, false);
            this.api.getHistory().subscribe({
              next: (h) => this.store.setHistory(h.results || []),
            });
            this.messages.add({
              severity: 'success',
              summary: count === 1 ? 'Resultado eliminado.' : `${count} resultados eliminados.`,
              life: 2600,
            });
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

/**
 * Resuelve un campo anidado con notación punto (p.ej. `config.ctxSize`) sobre
 * un objeto. Equivalente al `resolveFieldData` interno de PrimeNG, replicado
 * aquí para no depender de una API no exportada.
 */
function resolveFieldPath(obj: unknown, path: string): unknown {
  if (obj == null) return undefined;
  let cur: any = obj;
  for (const part of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return cur;
}

/**
 * Comparador equivalente al interno de PrimeNG para el sort de una columna:
 * null-safe (los nulos van primero) y `localeCompare` para strings, comparación
 * numérica nativa para el resto. Devuelve -1/0/1 (sin multiplicar por el
 * orden; el llamador lo aplica).
 */
function compareField<T>(a: T, b: T, field: string): number {
  const v1: any = resolveFieldPath(a, field);
  const v2: any = resolveFieldPath(b, field);
  if (v1 == null && v2 != null) return -1;
  if (v1 != null && v2 == null) return 1;
  if (v1 == null && v2 == null) return 0;
  if (typeof v1 === 'string' && typeof v2 === 'string') return v1.localeCompare(v2);
  return v1 < v2 ? -1 : v1 > v2 ? 1 : 0;
}
