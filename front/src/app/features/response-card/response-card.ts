import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';

/**
 * ResponseCard: muestra la respuesta generada por el modelo en el último
 * benchmark. Visible solo cuando hay un lastResult con respuesta.
 */
@Component({
  selector: 'app-response-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './response-card.html',
  styles: [
    `
      .response-box {
        margin-top: 0.5rem;
        background: var(--color-bg);
        border: 1px solid var(--color-border);
        border-radius: var(--radius);
        padding: 0.75rem 1rem;
        font-family: var(--font-mono);
        font-size: 0.82rem;
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 24rem;
        overflow-y: auto;
      }
    `,
  ],
})
export class ResponseCard {
  protected readonly store = inject(BenchStore);
  protected readonly response = computed(() => this.store.lastResult()?.response || '—');
}
