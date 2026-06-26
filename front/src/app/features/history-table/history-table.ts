import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { SelectModule } from 'primeng/select'
import { TableModule, Table } from 'primeng/table'
import { TooltipModule } from 'primeng/tooltip'
import { ConfirmationService, MessageService } from 'primeng/api'
import { BenchStore } from '../../core/state/bench.store'
import { LlamaBenchService } from '../../core/services/llama-bench.service'
import { BenchmarkResult, ParsedScript } from '../../core/models/types'
import { fmt, fmtMs, modelBase, parseModel, shortModel } from '../../core/utils/format'

/**
 * HistoryTable: tabla de resultados históricos de benchmarks.
 * - p-table con sort por columna (sortCol/sortDir persistidos en localStorage).
 * - Filtro por modelo base (p-select en el header).
 * - Checkbox por fila para selección multi (Set en el store).
 * - Highlights "best" (mejor prompt/gen T/s, draft acc, load/gen time) sobre
 *   TODA la history, calculados en store.bests.
 * - Botón ↗ aplicar: carga el script del resultado en el editor.
 * - Botón ✕ eliminar: DELETE /history/:id + refresco (con confirmación).
 * - Botón Comparar/Limpiar todo.
 */
@Component({
  selector: 'app-history-table',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, SelectModule, TableModule, TooltipModule],
  template: `
    <section class="card">
      <div class="row-between">
        <h2>Historial</h2>
        <div class="buttons">
          <p-button
            label="Comparar"
            icon="pi pi-arrows-h"
            [text]="true"
            [disabled]="store.selectedCount() < 2"
            (onClick)="compare()"
          />
          <p-button label="Limpiar todo" icon="pi pi-trash" severity="danger" [text]="true" (onClick)="clearAll($event)" />
        </div>
      </div>

      <p-table
        #dt
        [value]="store.visibleHistory()"
        dataKey="id"
        [rows]="50"
        [rowsPerPageOptions]="[25, 50, 100]"
        [paginator]="true"
        [tableStyle]="{ 'min-width': '100%' }"
        styleClass="p-datatable-sm p-datatable-striped"
        [showGridlines]="true"
      >
        <ng-template #caption>
          <div class="filter-row">
            <span class="muted small">Filtrar por modelo:</span>
            <p-select
              [options]="modelOptions()"
              [ngModel]="store.modelFilter()"
              (ngModelChange)="store.setModelFilter($event)"
              [showClear]="true"
              placeholder="Todos"
              styleClass="model-filter"
            />
            <span class="muted small count">{{ store.history().length }} registros</span>
          </div>
        </ng-template>

        <ng-template #header>
          <tr>
            <th style="width: 3rem"></th>
            <th [pSortableColumn]="'date'">
              Fecha <p-sortIcon field="date" />
            </th>
            <th>Modelo</th>
            <th [pSortableColumn]="'ctx'">ctx <p-sortIcon field="ctx" /></th>
            <th>batch</th>
            <th>cache</th>
            <th>device</th>
            <th>tsplit</th>
            <th [pSortableColumn]="'promptTps'">prompt T/s <p-sortIcon field="promptTps" /></th>
            <th [pSortableColumn]="'genTps'">gen T/s <p-sortIcon field="genTps" /></th>
            <th [pSortableColumn]="'draftAcc'">draft acc <p-sortIcon field="draftAcc" /></th>
            <th>gen dr</th>
            <th>acc dr</th>
            <th>gen tk</th>
            <th>acc tk</th>
            <th [pSortableColumn]="'loadTime'">load s <p-sortIcon field="loadTime" /></th>
            <th [pSortableColumn]="'generationTime'">gen <p-sortIcon field="generationTime" /></th>
            <th>VRAM</th>
            <th [pSortableColumn]="'totalVram'">Total VRAM <p-sortIcon field="totalVram" /></th>
            <th style="width: 5rem"></th>
          </tr>
        </ng-template>

        <ng-template #body let-r>
          <tr [class.selected]="isSelected(r.id)">
            <td>
              <input
                type="checkbox"
                [checked]="isSelected(r.id)"
                (change)="onToggle($event, r.id)"
                title="Seleccionar para comparar"
              />
            </td>
            <td>{{ dateStr(r.timestamp) }}</td>
            <td>
              <span class="model-cell" [title]="r.config?.model ?? ''">
                <span class="model-name">{{ modelBaseName(r.config?.model) }}</span>
                @if (parsed(r.config?.model); as p) {
                  @if (p.size) {
                    <span class="badge badge-size">{{ p.size }}</span>
                  }
                  @if (p.quant) {
                    <span class="badge badge-quant">{{ p.quant }}</span>
                  }
                  @if (p.mtp) {
                    <span class="badge badge-mtp">MTP</span>
                  }
                }
              </span>
            </td>
            <td class="num">{{ fmt(r.config?.ctxSize) }}</td>
            <td class="num">{{ fmt(r.config?.batchSize) }}/{{ fmt(r.config?.ubatchSize) }}</td>
            <td>{{ r.config?.cacheTypeK ?? '—' }}/{{ r.config?.cacheTypeV ?? '—' }}</td>
            <td>{{ r.config?.device ?? '—' }}</td>
            <td>{{ r.config?.tensorSplit ?? '—' }}</td>
            <td class="num" [class.best]="isBestPrompt(r)">{{ fmt(r.promptTokensPerSecond) }}</td>
            <td class="num" [class.best]="isBestGen(r)">{{ fmt(r.generationTokensPerSecond) }}</td>
            <td class="num" [class.best]="isBestDraft(r)">{{ fmt(r.draftAcceptance, 3) }}</td>
            <td class="num">{{ fmt(r.genDrafts, 0) }}</td>
            <td class="num">{{ fmt(r.accDrafts, 0) }}</td>
            <td class="num">{{ fmt(r.genTokens, 0) }}</td>
            <td class="num">{{ fmt(r.accTokens, 0) }}</td>
            <td class="num" [class.best]="isBestLoad(r)">{{ fmt(r.loadTimeSeconds) }}</td>
            <td class="num" [class.best]="isBestGenTime(r)">{{ fmtMs(r.generationTimeMs) }}</td>
            <td class="num">{{ gpuTxt(r) }}</td>
            <td class="num">{{ totalVramTxt(r) }}</td>
            <td>
              <div class="row-actions">
                @if (hasScript(r.config)) {
                  <p-button icon="pi pi-arrow-up-right" [text]="true" size="small" (onClick)="apply(r)" pTooltip="Cargar script en editor" />
                }
                <p-button icon="pi pi-times" [text]="true" severity="danger" size="small" (onClick)="remove($event, r)" />
              </div>
            </td>
          </tr>
        </ng-template>

        <ng-template #emptymessage>
          <tr>
            <td colspan="20" class="muted">Sin resultados todavía. Ejecuta un benchmark.</td>
          </tr>
        </ng-template>
      </p-table>
    </section>
  `,
  styleUrl: './history-table.css',
})
export class HistoryTable {
  protected readonly store = inject(BenchStore)
  private readonly api = inject(LlamaBenchService)
  private readonly messages = inject(MessageService)
  private readonly confirm = inject(ConfirmationService)

  protected readonly fmt = fmt
  protected readonly fmtMs = fmtMs
  protected readonly modelOptions = this.store.modelOptions

  // ── Helpers de celda ──

  protected dateStr(iso: string): string {
    return new Date(iso).toLocaleString()
  }
  protected modelBaseName(m: string | null | undefined): string {
    return modelBase(m) ?? '—'
  }
  protected parsed(m: string | null | undefined) {
    return parseModel(m)
  }
  protected hasScript(c: ParsedScript | undefined): boolean {
    return !!c && typeof c.script === 'string' && c.script.length > 0
  }
  protected gpuTxt(r: BenchmarkResult): string {
    return (
      r.gpus
        .map((g) => {
          const vendor = (g.vendor || 'gpu').replace(/^amdgpu/i, 'AmdGPU')
          const val = g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : '?'
          return `${vendor}:${val}`
        })
        .join(', ') || '—'
    )
  }
  protected totalVramTxt(r: BenchmarkResult): string {
    const total = r.gpus.reduce((sum, g) => sum + (g.memUsedMiB ?? 0), 0) / 1024
    return total > 0 ? `${total.toFixed(1)} GB` : '—'
  }

  // ── Highlights "best" (sobre TODA la history) ──
  protected isBestPrompt(r: BenchmarkResult): boolean {
    const b = this.store.bests()
    return r.promptTokensPerSecond != null && r.promptTokensPerSecond === b.p && b.p > -Infinity
  }
  protected isBestGen(r: BenchmarkResult): boolean {
    const b = this.store.bests()
    return r.generationTokensPerSecond != null && r.generationTokensPerSecond === b.g && b.g > -Infinity
  }
  protected isBestDraft(r: BenchmarkResult): boolean {
    const b = this.store.bests()
    return r.draftAcceptance != null && r.draftAcceptance === b.d && b.d > -Infinity
  }
  protected isBestLoad(r: BenchmarkResult): boolean {
    const b = this.store.bests()
    return r.loadTimeSeconds != null && r.loadTimeSeconds === b.l && b.l < Infinity
  }
  protected isBestGenTime(r: BenchmarkResult): boolean {
    const b = this.store.bests()
    return r.generationTimeMs != null && r.generationTimeMs === b.gt && b.gt < Infinity
  }

  // ── Selección ──
  protected isSelected(id: string): boolean {
    return this.store.isSelected(id)
  }
  protected onToggle(ev: Event, id: string): void {
    const checked = (ev.target as HTMLInputElement).checked
    this.store.toggleSelected(id, checked)
  }

  // ── Acciones de fila ──
  protected apply(r: BenchmarkResult): void {
    const script = r.config?.script
    if (script) {
      this.store.setScript(script)
      this.messages.add({
        severity: 'info',
        summary: `Script de ${shortModel(r.config?.model)} cargado.`,
        life: 2600,
      })
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
            this.store.toggleSelected(r.id, false)
            this.api.getHistory().subscribe({
              next: (h) => this.store.setHistory(h.results || []),
            })
            this.messages.add({ severity: 'success', summary: 'Resultado eliminado.', life: 2600 })
          },
          error: (e: Error) =>
            this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
        })
      },
    })
  }

  // ── Acciones de cabecera ──
  protected compare(): void {
    if (this.store.selectedCount() < 2) {
      this.messages.add({ severity: 'warn', summary: 'Selecciona 2 o más resultados.', life: 3000 })
      return
    }
    this.store.openCompare()
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
            this.store.setHistory([])
            this.messages.add({ severity: 'success', summary: 'Historial limpiado.', life: 2600 })
          },
          error: (e: Error) =>
            this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
        })
      },
    })
  }
}
