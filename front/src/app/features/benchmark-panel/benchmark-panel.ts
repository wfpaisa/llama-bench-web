import { Component, OnDestroy, effect, inject, linkedSignal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { CheckboxModule } from 'primeng/checkbox';
import { ConfirmationService } from 'primeng/api';
import { BenchStore, DEFAULT_PROMPT_UI } from '../../core/state/bench.store';
import { PlaneLlamaBenchService } from '../../core/services/plane-llama-bench.service';
import { NotifyService } from '../../core/services/notify.service';
import { formatScript } from '../../core/utils/format';

/**
 * BenchmarkPanel: orquesta la ejecución de un benchmark automático.
 * - Edición del prompt + Max Tokens (desactivable con checkbox → sin límite).
 * - Botón Benchmark: POST /benchmark (bloqueante); al terminar pinta el
 *   resultado, refresca el historial y avisa con toast.
 * - Botón Detener (visible durante el run): POST /benchmark/stop.
 * - Timer transcurrido (M:SS) actualizado cada 200ms mientras corre.
 * - Guardar/Obener default del prompt (con confirmación).
 * - Restablecer: llena el textarea con el prompt por defecto built-in (sin
 *   confirmación, al instante).
 * - Si el prompt está en blanco al Guardar, se persiste el prompt por defecto.
 * - Al ejecutar el benchmark se formatea el script automáticamente antes de
 *   enviarlo al backend.
 */
@Component({
  selector: 'app-benchmark-panel',
  imports: [FormsModule, ButtonModule, TextareaModule, InputNumberModule, CheckboxModule],
  templateUrl: './benchmark-panel.html',
  styleUrl: './benchmark-panel.css',
})
export class BenchmarkPanel implements OnDestroy {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(PlaneLlamaBenchService);
  private readonly notify = inject(NotifyService);
  private readonly confirm = inject(ConfirmationService);

  /**
   * Modelo del prompt para el textarea. `linkedSignal` lo reengancha solo cuando
   * el prompt del store cambia desde fuera (restablecer default, cargar de
   * historial) y admite escritura local mientras se teclea, que es justo lo que
   * antes hacía a mano un signal espejo + un effect de sincronización.
   */
  protected readonly prompt = linkedSignal(() => this.store.prompt());
  protected readonly maxTokens = this.store.maxTokens;
  protected readonly maxTokensEnabled = this.store.maxTokensEnabled;
  protected readonly running = this.store.running;

  /**
   * Timer (200ms) que refresca el elapsed. Solo vive mientras el benchmark
   * corre: antes se creaba en el constructor y seguía disparando cada 200ms
   * durante toda la sesión aunque no hubiera nada que medir.
   */
  private timerHandle: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Arrancar/parar el timer siguiendo el estado del benchmark.
    effect(() => {
      if (this.store.benchRunning()) this.startTimer();
      else this.stopTimer();
    });
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  private startTimer(): void {
    if (this.timerHandle) return;
    this.timerHandle = setInterval(() => this.store.tickBenchTimer(), 200);
  }

  private stopTimer(): void {
    if (!this.timerHandle) return;
    clearInterval(this.timerHandle);
    this.timerHandle = null;
  }

  onPromptChange(value: string): void {
    this.prompt.set(value);
    this.store.setPrompt(value);
  }

  // ── Ejecutar / detener benchmark ──

  run(): void {
    if (this.store.benchRunning()) return;
    // Formatear el script antes de ejecutar el benchmark (igual que el botón
    // Formatear del editor) para enviarlo normalizado al backend.
    const formatted = formatScript(this.store.script());
    this.store.setScript(formatted);
    this.store.startBenchmark();
    this.api
      .runBenchmark({
        script: formatted,
        prompt: this.store.prompt(),
        maxTokens: this.store.maxTokensEnabled() ? this.store.maxTokens() : null,
      })
      .subscribe({
        next: (data) => {
          if (data.ok && data.result) {
            const r = data.result;
            this.store.finishBenchmark(r);
            // Refrescar historial tras guardar.
            this.api.getHistory().subscribe({
              next: (h) => this.store.setHistory(h.results || []),
            });
            if (r.errors.length) {
              this.notify.warn('Benchmark con errores', r.errors.join('; '));
            } else {
              this.notify.ok('Benchmark completado');
            }
          } else {
            this.store.failBenchmark();
            this.notify.error(data.error || 'Error desconocido', 'Benchmark falló');
          }
        },
        error: (e: Error) => {
          this.store.failBenchmark();
          this.notify.error(e.message, 'Error');
        },
      });
  }

  stop(): void {
    if (!this.store.benchRunning()) return;
    this.api.stopBenchmark().subscribe({
      next: () => this.store.markBenchStopping(),
      error: () => {
        /* el benchmark puede haber terminado ya */
      },
    });
  }

  // ── Defaults del prompt ──

  savePromptDefault(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Guardar el prompt actual como default?',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        // Si el prompt está en blanco, persistir el prompt por defecto.
        const toSave = this.store.prompt().trim() ? this.store.prompt() : DEFAULT_PROMPT_UI;
        this.api.savePromptDefault(toSave).subscribe({
          next: () => this.notify.ok('Prompt default guardado'),
          error: (e: Error) => this.notify.error(e.message, 'Error'),
        });
      },
    });
  }

  restorePromptDefault(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Restablecer el prompt al default guardado?',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.api.getPromptDefault().subscribe({
          next: (text) => {
            this.store.setPrompt(text);
            this.notify.ok('Prompt default restablecido');
          },
          error: (e: Error) => this.notify.error(e.message, 'No hay prompt default guardado'),
        });
      },
    });
  }

  /** Restablece el textarea al prompt por defecto built-in (sin confirmación). */
  resetPrompt(_event: Event): void {
    this.store.setPrompt(DEFAULT_PROMPT_UI);
    this.notify.info('Prompt restablecido al default');
  }
}
