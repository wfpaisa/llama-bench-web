import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';
import { fmt, fmtMs } from '../../core/utils/format';
import { BenchmarkResult } from '../../core/models/types';

/**
 * LastResult: tarjeta de métricas del último benchmark (prompt T/s, gen T/s,
 * draft acc, drafts, tokens, load, gen time, latencia, VRAM por GPU y errores).
 * Visible solo cuando existe un lastResult.
 */
@Component({
  selector: 'app-last-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './last-result.html',
  styleUrl: './last-result.css',
})
export class LastResult {
  protected readonly store = inject(BenchStore);
  protected readonly result = computed<BenchmarkResult | null>(() => this.store.lastResult());
  protected readonly fmt = fmt;
  protected readonly fmtMs = fmtMs;

  protected gpuLine(r: BenchmarkResult): string {
    return (
      r.gpus
        .map(
          (g) => `${g.index}: ${g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : '?'} GB`,
        )
        .join(' · ') || '—'
    );
  }
}
