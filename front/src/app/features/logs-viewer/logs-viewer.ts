import { Component, ElementRef, afterRenderEffect, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { CheckboxModule } from 'primeng/checkbox';
import { BenchStore } from '../../core/state/bench.store';
import { PlaneLlamaBenchService } from '../../core/services/plane-llama-bench.service';
import { NotifyService } from '../../core/services/notify.service';
import { LogStreamService } from '../../core/services/log-stream.service';
import { FmtNumPipe } from '../../core/utils/pipes';

/**
 * LogsViewer: salida de logs en tiempo real del servidor.
 * - Las líneas llegan empujadas por SSE (LogStreamService); este componente solo
 *   lee store.logs.
 * - Se renderizan verbatim, como en la terminal: el timestamp propio de
 *   llama-server ya viene en la línea. La marca de tiempo relativa del backend
 *   es un toggle opcional, apagado por defecto.
 * - Auto-scroll al pie, que se suspende solo si el usuario sube a leer.
 * - Color por stream: command/stdout/stderr/system.
 * - Botón limpiar (POST /logs/clear + reset local).
 */
@Component({
  selector: 'app-logs-viewer',
  imports: [FormsModule, ButtonModule, CheckboxModule, FmtNumPipe],
  templateUrl: './logs-viewer.html',
  styleUrl: './logs-viewer.css',
})
export class LogsViewer {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(PlaneLlamaBenchService);
  private readonly logStream = inject(LogStreamService);
  private readonly notify = inject(NotifyService);

  private readonly logsEl = viewChild<ElementRef<HTMLDivElement>>('logsEl');

  protected readonly logs = this.store.logs;
  protected readonly showTimestamps = this.store.showTimestamps;
  /** True cuando el stream está caído y se está sondeando de respaldo. */
  protected readonly degraded = this.logStream.degraded;

  /** Modelos de los checkboxes (sembrados del store). */
  protected autoscrollModel = this.store.autoscroll();
  protected timestampsModel = this.store.showTimestamps();

  /**
   * True mientras el usuario está leyendo hacia arriba. Suspende el auto-scroll
   * sin tocar su preferencia: con líneas llegando de a una, arrastrar la vista
   * al pie en mitad de una lectura haría el panel inservible.
   */
  private readonly pinnedToBottom = signal(true);

  constructor() {
    // Auto-scroll al pie cuando llegan logs nuevos, tras renderizar el DOM.
    afterRenderEffect(() => {
      this.logs();
      if (!this.store.autoscroll() || !this.pinnedToBottom()) return;
      const el = this.logsEl()?.nativeElement;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }

  /** Detecta si el usuario se despegó del pie (margen de 1 línea). */
  protected onScroll(): void {
    const el = this.logsEl()?.nativeElement;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.pinnedToBottom.set(distance < 24);
  }

  clear(): void {
    this.api.clearLogs().subscribe({
      next: () => {
        this.store.clearLogs();
        this.pinnedToBottom.set(true);
      },
      error: (e: Error) => this.notify.error(e.message, 'Error'),
    });
  }
}
