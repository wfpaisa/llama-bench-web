import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';
import { GpuInfo, RamInfo } from '../../core/models/types';
import { alertCls, fmtGB } from '../../core/utils/format';

/**
 * GpuGrid: métricas horizontales para el header del shell.
 * Una card por GPU con dos barras horizontales (VRAM y utilización),
 * más una para la RAM del sistema. Muestra cantidades tipo "14,2 / 16 GB".
 * Color verde/amarillo/rojo según uso. Se refresca vía polling del store.
 */
@Component({
  selector: 'app-gpu-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './gpu-grid.html',
  styleUrl: './gpu-grid.css',
})
export class GpuGrid {
  protected readonly store = inject(BenchStore);

  protected readonly gpus = this.store.gpus;
  protected readonly ram = this.store.ram;
  protected readonly alert = alertCls;
  protected readonly gb = fmtGB;

  // ── Helpers de cálculo ──
  protected vramPct(g: GpuInfo): number {
    if (g.memUsedMiB == null || g.memTotalMiB == null || g.memTotalMiB <= 0) return 0;
    return Math.round((g.memUsedMiB / g.memTotalMiB) * 100);
  }
  protected utilPct(g: GpuInfo): string {
    return g.gpuUtilPct != null ? `${g.gpuUtilPct}%` : '?';
  }
  protected utilValue(g: GpuInfo): number {
    return g.gpuUtilPct ?? 0;
  }
  protected barWidth(pct: number): number {
    return Math.min(100, pct);
  }

  /** Texto de VRAM para la card: "14,2 / 16 GB". */
  protected vramLabel(g: GpuInfo): string {
    return `${fmtGB(g.memUsedMiB, 1)} / ${fmtGB(g.memTotalMiB, 0)} GB`;
  }

  /** Texto de RAM para la card: "14,2 / 32 GB". */
  protected ramLabel(r: RamInfo): string {
    return `${fmtGB(r.memUsedMiB, 1)} / ${fmtGB(r.memTotalMiB, 0)} GB`;
  }

  // ── RAM del sistema ──
  protected ramPct(r: RamInfo): number {
    if (r.memUsedMiB == null || r.memTotalMiB == null || r.memTotalMiB <= 0) return 0;
    return Math.round((r.memUsedMiB / r.memTotalMiB) * 100);
  }
}
