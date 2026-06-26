import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';
import { GpuInfo, RamInfo } from '../../core/models/types';
import { alertCls } from '../../core/utils/format';

/**
 * GpuGrid: métricas compactas para el header del shell.
 * Una card por GPU con dos barras verticales (VRAM y utilización), más una
 * para la RAM del sistema. Color verde/amarillo/rojo según uso. Se refresca
 * vía polling del store (cada 4s desde Home), sin botón ni encabezado.
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

  // ── Helpers de cálculo (puros, pero como métodos para usar en template) ──
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

  /** Nombre corto del dispositivo para la card (quita vendor tag, recorta). */
  protected shortName(index: string): string {
    // El índice trae prefijo de vendor (p.ej. "nvidia0", "amdgpu-card0").
    const base = index.replace(/^(nvidia|amd|amdgpu)[-]?/i, '');
    return (base || index).slice(0, 6);
  }

  // ── RAM del sistema (espejo del helper de VRAM) ──
  protected ramPct(r: RamInfo): number {
    if (r.memUsedMiB == null || r.memTotalMiB == null || r.memTotalMiB <= 0) return 0;
    return Math.round((r.memUsedMiB / r.memTotalMiB) * 100);
  }
}
