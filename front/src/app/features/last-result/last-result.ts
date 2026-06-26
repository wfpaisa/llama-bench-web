import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core'
import { BenchStore } from '../../core/state/bench.store'
import { fmt, fmtMs } from '../../core/utils/format'
import { BenchmarkResult } from '../../core/models/types'

/**
 * LastResult: tarjeta de métricas del último benchmark (prompt T/s, gen T/s,
 * draft acc, drafts, tokens, load, gen time, latencia, VRAM por GPU y errores).
 * Visible solo cuando existe un lastResult.
 */
@Component({
  selector: 'app-last-result',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (result(); as r) {
      <section class="card">
        <h2>Último resultado</h2>
        <div class="metrics">
          <div class="metric">
            <div class="k">Prompt T/s</div>
            <div class="k-sub">Reading (prompt processing)</div>
            <div class="v green">{{ fmt(r.promptTokensPerSecond) }}<small> tok/s</small></div>
          </div>
          <div class="metric">
            <div class="k">Gen T/s</div>
            <div class="k-sub">Generation (token output)</div>
            <div class="v green">{{ fmt(r.generationTokensPerSecond) }}<small> tok/s</small></div>
          </div>
          <div class="metric">
            <div class="k">Draft acc</div>
            <div class="v amber">{{ fmt(r.draftAcceptance, 3) }}</div>
          </div>
          <div class="metric">
            <div class="k">Gen drafts</div>
            <div class="v">{{ fmt(r.genDrafts, 0) }}</div>
          </div>
          <div class="metric">
            <div class="k">Acc drafts</div>
            <div class="v">{{ fmt(r.accDrafts, 0) }}</div>
          </div>
          <div class="metric">
            <div class="k">Gen tokens</div>
            <div class="v">{{ fmt(r.genTokens, 0) }}</div>
          </div>
          <div class="metric">
            <div class="k">Acc tokens</div>
            <div class="v">{{ fmt(r.accTokens, 0) }}</div>
          </div>
          <div class="metric">
            <div class="k">Load time</div>
            <div class="v">{{ fmt(r.loadTimeSeconds) }}<small> s</small></div>
          </div>
          <div class="metric">
            <div class="k">Gen time</div>
            <div class="k-sub">Tiempo de generación (sin prompt ni startup)</div>
            <div class="v green">{{ fmtMs(r.generationTimeMs) }}</div>
          </div>
          <div class="metric">
            <div class="k">Latencia req</div>
            <div class="v">{{ fmt(r.requestLatencyMs, 0) }}<small> ms</small></div>
          </div>

          <div class="metric metric-wide2">
            <div class="k">VRAM</div>
            <div class="v v-small">{{ gpuLine(r) }}</div>
          </div>

          @if (r.errors.length) {
            <div class="metric metric-full">
              <div class="k">Errores</div>
              <div class="v v-error">{{ r.errors.join(' · ') }}</div>
            </div>
          }
        </div>
      </section>
    }
  `,
  styleUrl: './last-result.css',
})
export class LastResult {
  protected readonly store = inject(BenchStore)
  protected readonly result = computed<BenchmarkResult | null>(() => this.store.lastResult())
  protected readonly fmt = fmt
  protected readonly fmtMs = fmtMs

  protected gpuLine(r: BenchmarkResult): string {
    return (
      r.gpus.map((g) => `${g.index}: ${g.memUsedMiB != null ? (g.memUsedMiB / 1024).toFixed(1) : '?'} GB`).join(' · ') ||
      '—'
    )
  }
}
