import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { MessageService } from 'primeng/api';

/**
 * LogsViewer: salida de logs en tiempo real del servidor.
 * - Polling incremental manejado en Home (este componente solo lee store.logs).
 * - Auto-scroll al pie cuando está activado (checkbox).
 * - Color por stream: stdout/stderr/system.
 * - Botón limpiar (POST /logs/clear + reset local).
 */
@Component({
  selector: 'app-logs-viewer',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, CheckboxModule],
  templateUrl: './logs-viewer.html',
  styleUrl: './logs-viewer.css',
})
export class LogsViewer {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);

  private readonly logsEl = viewChild<ElementRef<HTMLDivElement>>('logsEl');

  protected readonly logs = this.store.logs;
  /** Modelo del checkbox (sembrado del store). */
  protected autoscrollModel = this.store.autoscroll();

  constructor() {
    // Auto-scroll al pie cuando llegan logs nuevos y está activado.
    effect(() => {
      // Tocar logs() para reaccionar a cambios.
      this.logs();
      const el = this.logsEl()?.nativeElement;
      if (el && this.store.autoscroll()) {
        // Defer al siguiente tick para que el DOM se haya renderizado.
        queueMicrotask(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }

  clear(): void {
    this.api.clearLogs().subscribe({
      next: () => this.store.clearLogs(),
      error: (e: Error) =>
        this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
    });
  }
}
