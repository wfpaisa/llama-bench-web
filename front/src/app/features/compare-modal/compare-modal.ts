import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { BenchStore } from '../../core/state/bench.store';
import { BenchmarkResult } from '../../core/models/types';
import { fmt, fmtMs, shortModel } from '../../core/utils/format';

/** Cada fila de la tabla transpuesta: etiqueta + extractor de valor por resultado. */
interface CompareRow {
  label: string;
  value: (r: BenchmarkResult) => string;
}

/**
 * CompareModal: diálogo con tabla transpuesta comparando los resultados
 * seleccionados (métricas como filas, resultados como columnas). Visible
 * cuando store.showCompare() es true.
 */
@Component({
  selector: 'app-compare-modal',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DialogModule],
  template: `
    <p-dialog
      header="Comparación"
      [(visible)]="visible"
      [modal]="true"
      [draggable]="false"
      [resizable]="true"
      [style]="{ width: '92vw', maxWidth: '920px', height: '86vh' }"
      [contentStyle]="{ overflow: 'auto' }"
      [breakpoints]="{ '960px': '95vw' }"
    >
      <div class="table-wrap">
        <table class="compare-table">
          <thead>
            <tr>
              <th>Métrica</th>
              @for (r of items(); track r.id) {
                <th>{{ dateStr(r.timestamp) }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (row of rows(); track row.label) {
              <tr>
                <td>{{ row.label }}</td>
                @for (r of items(); track r.id) {
                  <td class="num">{{ row.value(r) }}</td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
    </p-dialog>
  `,
  styles: [
    `
      .table-wrap {
        overflow-x: auto;
      }
      .compare-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 0.8rem;
      }
      .compare-table th,
      .compare-table td {
        padding: 0.4rem 0.6rem;
        border-bottom: 1px solid var(--color-border);
        text-align: left;
        vertical-align: top;
      }
      .compare-table th {
        font-weight: 600;
        background: var(--color-surface);
        position: sticky;
        top: 0;
        z-index: 1;
      }
      .compare-table td.num {
        font-family: var(--font-mono);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
    `,
  ],
})
export class CompareModal {
  protected readonly store = inject(BenchStore);

  /** Resultados seleccionados para comparar. */
  protected readonly items = computed<BenchmarkResult[]>(() => this.store.selectedResults());

  /** Filas de la tabla transpuesta (label + extractor). */
  protected readonly rows = computed<CompareRow[]>(() => [
    { label: 'Modelo', value: (r) => shortModel(r.config?.model) },
    { label: 'ctx', value: (r) => String(r.config?.ctxSize ?? '—') },
    {
      label: 'batch/ubatch',
      value: (r) => `${r.config?.batchSize ?? '—'}/${r.config?.ubatchSize ?? '—'}`,
    },
    {
      label: 'cache',
      value: (r) => `${r.config?.cacheTypeK ?? '—'}/${r.config?.cacheTypeV ?? '—'}`,
    },
    { label: 'device', value: (r) => r.config?.device || '—' },
    { label: 'tensor-split', value: (r) => r.config?.tensorSplit || '—' },
    { label: 'Prompt T/s', value: (r) => fmt(r.promptTokensPerSecond) },
    { label: 'Gen T/s', value: (r) => fmt(r.generationTokensPerSecond) },
    { label: 'Draft acc', value: (r) => fmt(r.draftAcceptance, 3) },
    { label: 'Gen drafts', value: (r) => fmt(r.genDrafts, 0) },
    { label: 'Acc drafts', value: (r) => fmt(r.accDrafts, 0) },
    { label: 'Gen tokens', value: (r) => fmt(r.genTokens, 0) },
    { label: 'Acc tokens', value: (r) => fmt(r.accTokens, 0) },
    { label: 'Load (s)', value: (r) => fmt(r.loadTimeSeconds, 2) },
    { label: 'Gen time', value: (r) => fmtMs(r.generationTimeMs) },
    { label: 'Latencia (ms)', value: (r) => fmt(r.requestLatencyMs, 0) },
    {
      label: 'VRAM (GB)',
      value: (r) =>
        r.gpus
          .map((g) => (g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : '?'))
          .join(' + ') || '—',
    },
  ]);

  /** Two-way binding del visible: sincroniza con store.showCompare. */
  protected get visible(): boolean {
    return this.store.showCompare();
  }
  protected set visible(v: boolean) {
    if (!v) this.store.closeCompare();
  }

  protected dateStr(iso: string): string {
    return new Date(iso).toLocaleString();
  }
}
