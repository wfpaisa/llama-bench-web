import { Component, computed, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';
import { fmtGB, gpuLabel } from '../../core/utils/format';
import { FmtGbPipe, FmtMsPipe, FmtNumPipe } from '../../core/utils/pipes';
import { BenchmarkResult, GpuInfo } from '../../core/models/types';

/**
 * LastResult: tarjeta de métricas del último benchmark (prompt T/s, gen T/s,
 * draft acc, drafts, tokens, load, gen time, latencia, VRAM por GPU, RAM y
 * errores). Visible solo cuando existe un lastResult.
 */
@Component({
  selector: 'app-last-result',
  templateUrl: './last-result.html',
  styleUrl: './last-result.css',
  imports: [FmtNumPipe, FmtMsPipe, FmtGbPipe],
})
export class LastResult {
  protected readonly store = inject(BenchStore);
  protected readonly result = computed<BenchmarkResult | null>(() => this.store.lastResult());

  /** Etiqueta legible del dispositivo (índice del SO) para cada GPU. */
  protected label(g: GpuInfo): string {
    return gpuLabel(g);
  }
}
