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
  template: `
    <section class="card">
      <div class="row-between">
        <h2>Métricas</h2>
        <p-button icon="pi pi-refresh" [text]="true" size="small" (onClick)="refresh()" />
      </div>

      @if (gpus().length || ram()) {
        <div class="gpu-grid">
          @for (g of gpus(); track g.index) {
            <div class="gpu">
              <div class="gpu-name">
                {{ g.index }}
                <span class="muted">({{ g.vendor }})</span>
              </div>

              <div class="gpu-line">VRAM: {{ vramUsed(g) }} / {{ vramTotal(g) }} GB</div>
              <div class="bar" [class]="alert(vramPct(g))">
                <span [style.width.%]="barWidth(vramPct(g))"></span>
              </div>

              <div class="gpu-line">Util: {{ utilPct(g) }}</div>
              <div class="bar" [class]="alert(utilValue(g))">
                <span [style.width.%]="barWidth(utilValue(g))"></span>
              </div>
            </div>
          }

          @if (ram(); as r) {
            <div class="gpu">
              <div class="gpu-name">RAM del sistema</div>

              <div class="gpu-line">RAM: {{ ramUsed(r) }} / {{ ramTotal(r) }} GB</div>
              <div class="bar" [class]="alert(ramPct(r))">
                <span [style.width.%]="barWidth(ramPct(r))"></span>
              </div>
            </div>
          }
        </div>
      } @else {
        <p class="muted">—</p>
      }
    </section>
  `,
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
