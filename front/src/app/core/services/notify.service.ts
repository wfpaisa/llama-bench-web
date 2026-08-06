// NotifyService: única puerta de salida para los toasts de la app.
//
// Antes cada componente construía a mano el objeto de PrimeNG
// (`{ severity, summary, detail, life }`), repetido 32 veces y con duraciones
// dispares (2200/2600/3000/3200/4000/5000 ms sin criterio). Aquí se fija la
// escala una sola vez y los componentes solo dicen QUÉ pasó, no cómo pintarlo.

import { Injectable, inject } from '@angular/core';
import { MessageService } from 'primeng/api';

/**
 * Duraciones por tipo de mensaje. Un error se lee más despacio que una
 * confirmación, y hay que dar tiempo a leer el detalle.
 */
const LIFE = {
  success: 2600,
  info: 2600,
  warn: 3200,
  error: 4500,
} as const;

@Injectable({ providedIn: 'root' })
export class NotifyService {
  private readonly messages = inject(MessageService);

  /** Confirmación de una acción del usuario. */
  ok(summary: string, detail?: string): void {
    this.messages.add({ severity: 'success', summary, detail, life: LIFE.success });
  }

  /** Información neutra (no es resultado de un fallo ni de un éxito). */
  info(summary: string, detail?: string): void {
    this.messages.add({ severity: 'info', summary, detail, life: LIFE.info });
  }

  /** Aviso: la acción no se hizo, pero no es un fallo del sistema. */
  warn(summary: string, detail?: string): void {
    this.messages.add({ severity: 'warn', summary, detail, life: LIFE.warn });
  }

  /**
   * Error. Acepta el Error tal cual lo lanza ApiService (que ya trae el mensaje
   * del backend) y opcionalmente un encabezado que dé contexto de qué falló.
   */
  error(cause: unknown, summary = 'Error'): void {
    this.messages.add({
      severity: 'error',
      summary,
      detail: cause instanceof Error ? cause.message : cause ? String(cause) : undefined,
      life: LIFE.error,
    });
  }
}
