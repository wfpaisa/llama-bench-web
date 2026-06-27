import { Component, computed, inject } from '@angular/core';
import { TooltipModule } from 'primeng/tooltip';
import { BenchStore } from '../../core/state/bench.store';
import { gpuLabel, deviceVramRows, type DeviceVramRow } from '../../core/utils/format';
import { FmtGbPipe, FmtMsPipe, FmtNumPipe } from '../../core/utils/pipes';
import { BenchmarkResult, GpuInfo } from '../../core/models/types';

/**
 * Vista de VRAM para el fallback legacy (resultados sin deviceVram): id legible
 * (índice del SO) y GB usados.
 */
interface LegacyVramView {
  id: string;
  usedMiB: number | null;
}

/**
 * LastResult: tarjeta de métricas del último benchmark (prompt T/s, gen T/s,
 * draft acc, drafts, tokens, load, gen time, latencia, VRAM por GPU, RAM y
 * errores). Visible solo cuando existe un lastResult.
 */
@Component({
  selector: 'app-last-result',
  templateUrl: './last-result.html',
  styleUrl: './last-result.css',
  imports: [FmtNumPipe, FmtMsPipe, FmtGbPipe, TooltipModule],
})
export class LastResult {
  protected readonly store = inject(BenchStore);
  protected readonly result = computed<BenchmarkResult | null>(() => this.store.lastResult());

  /**
   * Filas de VRAM por device del backend (vendor + índice + GB + tooltip),
   * igual que en la tabla de historial. Vacío si no hay deviceVram: en ese
   * caso el template cae al fallback legacy (legacyVramItems).
   */
  protected readonly deviceRows = computed<DeviceVramRow[]>(() => {
    const r = this.result();
    return r ? deviceVramRows(r) : [];
  });

  /**
   * Items de VRAM legacy (índice del SO + GB) para resultados sin deviceVram
   * (entradas viejas o cuando el backend no reporta devices).
   */
  protected readonly legacyVramItems = computed<LegacyVramView[]>(() => {
    const r = this.result();
    if (!r) return [];
    if (r.deviceVram && r.deviceVram.length > 0) return [];
    return r.gpus.map((g: GpuInfo) => ({
      id: gpuLabel(g),
      usedMiB: g.memUsedMiB,
    }));
  });
}
