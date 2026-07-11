import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { BenchStore } from '../../core/state/bench.store';

/**
 * StatusBar: indicador visual del estado del servidor llama-server.
 * Lee status/label/meta del store y aplica la clase de color al punto
 * (stopped/starting/running/error) vía class binding.
 */
@Component({
  selector: 'app-status-bar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './status-bar.html',
  styles: [
    `
      .status-bar {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 0.1rem;
        font-size: 0.875rem;
        width: 14rem;
      }
      .status-main {
        display: flex;
        align-items: center;
        gap: 0.5rem;
      }
      .dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        display: inline-block;
        flex-shrink: 0;
      }
      .dot.stopped {
        background: var(--p-neutral-400);
      }
      .dot.starting {
        background: var(--p-amber-400);
        animation: pulse 1.2s infinite;
      }
      .dot.running {
        background: var(--p-green-500);
      }
      .dot.error {
        background: var(--p-red-500);
      }
      @keyframes pulse {
        0%,
        100% {
          opacity: 1;
        }
        50% {
          opacity: 0.35;
        }
      }
      .status-text {
        font-weight: 500;
      }
      .status-meta {
        color: var(--color-text-muted);
        font-size: 0.7rem;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 100%;
      }
    `,
  ],
})
export class StatusBar {
  protected readonly store = inject(BenchStore);
  protected readonly status = this.store.status;
  protected readonly label = this.store.statusLabel;
  protected readonly meta = this.store.statusMeta;
}
