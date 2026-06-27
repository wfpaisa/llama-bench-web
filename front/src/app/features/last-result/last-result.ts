import { Component, computed, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';
import { gpuLabel } from '../../core/utils/format';
import { FmtGbPipe, FmtMsPipe, FmtNumPipe } from '../../core/utils/pipes';
import { BenchmarkResult, GpuInfo } from '../../core/models/types';

/**
 * Vista de VRAM unificada para el template: id legible, GB usados y nombre
 * (para tooltip). Cubre devices del backend (deviceVram) y GPUs legacy (gpus)
 * cuando no hay deviceVram.
 */
interface VramView {
  id: string;
  usedMiB: number | null;
  name: string;
  totalMiB: number | null;
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
  imports: [FmtNumPipe, FmtMsPipe, FmtGbPipe],
})
export class LastResult {
  protected readonly store = inject(BenchStore);
  protected readonly result = computed<BenchmarkResult | null>(() => this.store.lastResult());

  /**
   * Items de VRAM a mostrar: devices del backend (ids CUDA0/Vulkan0) si los hay;
   * si no, GPUs legacy (nvidia-smi/sysfs) vía gpuLabel.
   */
  protected readonly vramItems = computed<VramView[]>(() => {
    const r = this.result();
    if (!r) return [];
    if (r.deviceVram && r.deviceVram.length > 0) {
      return r.deviceVram.map((d) => ({
        id: d.device.id,
        usedMiB: d.usedMiB,
        name: d.device.name,
        totalMiB: d.device.totalMiB,
      }));
    }
    return r.gpus.map((g: GpuInfo) => ({
      id: gpuLabel(g),
      usedMiB: g.memUsedMiB,
      name: g.index,
      totalMiB: g.memTotalMiB,
    }));
  });
}
