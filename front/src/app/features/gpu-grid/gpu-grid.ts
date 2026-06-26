import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { MessageService } from 'primeng/api';
import { GpuInfo, RamInfo } from '../../core/models/types';
import { alertCls } from '../../core/utils/format';

/**
 * GpuGrid: tarjetas con métricas en vivo de cada GPU (VRAM usada/total y %
 * de utilización) y de la RAM del sistema. Barras de color
 * verde/amarillo/rojo según uso. Botón de refresco manual (además del
 * polling automático desde Home).
 */
@Component({
  selector: 'app-gpu-grid',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ButtonModule],
  templateUrl: './gpu-grid.html',
  styleUrl: './gpu-grid.css',
})
export class GpuGrid {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);

  protected readonly gpus = this.store.gpus;
  protected readonly ram = this.store.ram;
  protected readonly alert = alertCls;

  // ── Helpers de cálculo (puros, pero como métodos para usar en template) ──
  protected vramUsed(g: GpuInfo): string {
    return g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : '?';
  }
  protected vramTotal(g: GpuInfo): string {
    return g.memTotalMiB != null ? (g.memTotalMiB / 1024).toFixed(1) : '?';
  }
  protected vramPct(g: GpuInfo): number {
    if (g.memUsedMiB == null || g.memTotalMiB == null || g.memTotalMiB <= 0) return 0;
    return Math.round((g.memUsedMiB / g.memTotalMiB) * 100);
  }
  protected utilValue(g: GpuInfo): number {
    return g.gpuUtilPct ?? 0;
  }
  protected utilPct(g: GpuInfo): string {
    return g.gpuUtilPct != null ? `${g.gpuUtilPct}%` : '?';
  }
  protected barWidth(pct: number): number {
    return Math.min(100, pct);
  }

  // ── RAM del sistema (espejo de los helpers de VRAM) ──
  protected ramUsed(r: RamInfo): string {
    return r.memUsedMiB != null ? (r.memUsedMiB / 1024).toFixed(1) : '?';
  }
  protected ramTotal(r: RamInfo): string {
    return r.memTotalMiB != null ? (r.memTotalMiB / 1024).toFixed(1) : '?';
  }
  protected ramPct(r: RamInfo): number {
    if (r.memUsedMiB == null || r.memTotalMiB == null || r.memTotalMiB <= 0) return 0;
    return Math.round((r.memUsedMiB / r.memTotalMiB) * 100);
  }

  refresh(): void {
    this.api.getGpus().subscribe({
      next: (data) => {
        this.store.setGpus(data.gpus);
        this.store.setRam(data.ram ?? null);
      },
      error: () => {
        this.store.setGpus([]);
        this.store.setRam(null);
      },
    });
  }
}
