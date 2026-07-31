import { Component, computed, inject } from '@angular/core';
import { DialogModule } from 'primeng/dialog';
import { BenchStore } from '../../core/state/bench.store';
import { BenchmarkResult } from '../../core/models/types';
import {
  fmt,
  fmtGB,
  fmtMs,
  backendLabel,
  deviceVramLine,
  effectiveBatch,
  effectiveCache,
  shortModel,
} from '../../core/utils/format';

/** Cada fila de la tabla transpuesta: etiqueta + extractor de valor por resultado. */
interface CompareRow {
  label: string;
  value: (r: BenchmarkResult) => string;
  /** Valor numérico crudo para decidir el mejor de la fila (omitir si no aplica). */
  raw?: (r: BenchmarkResult) => number | null | undefined;
  /** Dirección del "mejor" valor de la fila (si hay `raw`). */
  better?: 'higher' | 'lower';
}

/**
 * CompareModal: diálogo con tabla transpuesta comparando los resultados
 * seleccionados (métricas como filas, resultados como columnas). Visible
 * cuando store.showCompare() es true.
 */
@Component({
  selector: 'app-compare-modal',
  imports: [DialogModule],
  templateUrl: './compare-modal.html',
  styles: [
    `
      /* Es un diálogo superpuesto, no una sección de la página: no debe
         ocupar una casilla en el flex de .home ni "cobrar" gap cuando
         está oculto. El propio <p-dialog> es también una caja real
         (bloque, alto 0 cuando cerrado), así que hay que aplanarlo un
         nivel más. */
      :host {
        display: contents;
      }
      ::ng-deep p-dialog {
        display: contents;
      }
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
      .compare-table td.best {
        color: var(--p-green-400);
        font-weight: 700;
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
      value: (r) => {
        if (!r.config) return '—/—';
        const { batch, ubatch } = effectiveBatch(r.config.batchSize, r.config.ubatchSize);
        return `${fmt(batch, 0)}/${fmt(ubatch, 0)}`;
      },
    },
    {
      label: 'cache',
      value: (r) => {
        if (!r.config) return '—/—';
        const { k, v } = effectiveCache(r.config.cacheTypeK, r.config.cacheTypeV);
        return `${k}/${v}`;
      },
    },
    { label: 'device', value: (r) => r.config?.device || '—' },
    { label: 'backend', value: (r) => backendLabel(r.backend) || '—' },
    { label: 'tensor-split', value: (r) => r.config?.tensorSplit || '—' },
    {
      label: 'Prompt T/s',
      value: (r) => fmt(r.promptTokensPerSecond),
      raw: (r) => r.promptTokensPerSecond,
      better: 'higher',
    },
    {
      label: 'Gen T/s',
      value: (r) => fmt(r.generationTokensPerSecond),
      raw: (r) => r.generationTokensPerSecond,
      better: 'higher',
    },
    {
      label: 'Draft acc',
      value: (r) => fmt(r.draftAcceptance, 3),
      raw: (r) => r.draftAcceptance,
      better: 'higher',
    },
    { label: 'Gen drafts', value: (r) => fmt(r.genDrafts, 0) },
    { label: 'Acc drafts', value: (r) => fmt(r.accDrafts, 0) },
    {
      label: 'Load (s)',
      value: (r) => fmt(r.loadTimeSeconds, 2),
      raw: (r) => r.loadTimeSeconds,
      better: 'lower',
    },
    {
      label: 'Gen time',
      value: (r) => fmtMs(r.generationTimeMs),
      raw: (r) => r.generationTimeMs,
      better: 'lower',
    },
    {
      label: 'Latencia (ms)',
      value: (r) => fmt(r.requestLatencyMs, 0),
      raw: (r) => r.requestLatencyMs,
      better: 'lower',
    },
    {
      label: 'VRAM (GB)',
      value: (r) => deviceVramLine(r, true) || '—',
    },
    { label: 'RAM (GB)', value: (r) => fmtGB(r.ramUsedMiB, 2) },
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

  /**
   * ¿`r` tiene el mejor valor de la fila entre los resultados comparados?
   * Solo aplica a filas con `raw`/`better` y cuando hay ≥2 resultados con
   * valor numérico (si no, no hay nada que resaltar).
   */
  protected isBest(row: CompareRow, r: BenchmarkResult): boolean {
    if (!row.raw || !row.better) return false;
    const values = this.items()
      .map((it) => row.raw!(it))
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (values.length < 2) return false;
    const target = row.raw(r);
    if (target == null || !Number.isFinite(target)) return false;
    const best = row.better === 'higher' ? Math.max(...values) : Math.min(...values);
    return target === best;
  }
}
