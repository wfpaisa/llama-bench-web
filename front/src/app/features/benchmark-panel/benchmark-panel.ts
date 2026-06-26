import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { InputNumberModule } from 'primeng/inputnumber';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';

/**
 * BenchmarkPanel: orquesta la ejecución de un benchmark automático.
 * - Edición del prompt + Max Tokens.
 * - Botón Benchmark: POST /benchmark (bloqueante); al terminar pinta el
 *   resultado, refresca el historial y avisa con toast.
 * - Botón Detener (visible durante el run): POST /benchmark/stop.
 * - Timer transcurrido (M:SS) actualizado cada 200ms mientras corre.
 * - Guardar/Restablecer default del prompt (con confirmación).
 */
@Component({
  selector: 'app-benchmark-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, TextareaModule, InputNumberModule],
  template: `
    <section class="card">
      <h2>Benchmark automático</h2>
      <p class="muted small desc">
        Inicia llama-server → espera <code>server is listening</code> → POST
        <code>/v1/chat/completions</code> → parsea timings de logs → lee GPU → guarda resultado →
        detiene el servidor.
      </p>

      <label class="full">Prompt de evaluación</label>
      <textarea
        pTextarea
        [ngModel]="prompt()"
        (ngModelChange)="onPromptChange($event)"
        rows="4"
        class="bench-prompt"
        spellcheck="false"
      ></textarea>

      <div class="bench-params">
        <div class="prompt-actions">
          <p-button
            label="Guardar"
            [text]="true"
            size="small"
            icon="pi pi-save"
            (onClick)="savePromptDefault($event)"
          />
          <p-button
            label="Restablecer guardado"
            [text]="true"
            size="small"
            icon="pi pi-refresh"
            (onClick)="restorePromptDefault($event)"
          />
        </div>

        <div class="bench-row">
          <label
            for="bench-max-tokens"
            class="muted small"
            title="Tokens máximos a generar (-1 = ilimitado)"
          >
            Max Tokens
          </label>
          <p-inputnumber
            inputId="bench-max-tokens"
            [ngModel]="maxTokens()"
            (ngModelChange)="store.setMaxTokens($event)"
            [min]="1"
            [showButtons]="false"
            styleClass="max-tokens"
          />
        </div>
      </div>

      <div class="actions">
        <div class="buttons">
          <p-button
            label="Benchmark"
            icon="pi pi-bolt"
            severity="success"
            [disabled]="running() || store.benchRunning()"
            (onClick)="run()"
          />
          @if (store.benchRunning()) {
            <p-button label="Detener" icon="pi pi-stop" severity="danger" (onClick)="stop()" />
          }
          @if (store.benchState()) {
            <span class="muted small">{{ store.benchState() }}</span>
          }
          @if (store.benchTimer()) {
            <span class="muted small mono">{{ store.benchTimer() }}</span>
          }
        </div>
      </div>
    </section>
  `,
  styleUrl: './benchmark-panel.css',
})
export class BenchmarkPanel implements OnDestroy {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** Modelo del prompt, sincronizado con store.prompt. */
  protected readonly prompt = signal(this.store.prompt());
  protected readonly maxTokens = this.store.maxTokens;
  protected readonly running = this.store.running;

  /** Timer interval (200ms) que refresca el elapsed mientras el benchmark corre. */
  private readonly timerHandle: ReturnType<typeof setInterval>;

  constructor() {
    // Reflejar cambios externos del prompt en el textarea.
    effect(() => {
      const p = this.store.prompt();
      if (p !== this.prompt()) this.prompt.set(p);
    });

    this.timerHandle = setInterval(() => this.store.tickBenchTimer(), 200);
  }

  ngOnDestroy(): void {
    clearInterval(this.timerHandle);
  }

  onPromptChange(value: string): void {
    this.prompt.set(value);
    this.store.setPrompt(value);
  }

  // ── Ejecutar / detener benchmark ──

  run(): void {
    if (this.store.benchRunning()) return;
    this.store.startBenchmark();
    this.api
      .runBenchmark({
        script: this.store.script(),
        prompt: this.store.prompt(),
        maxTokens: this.store.maxTokens(),
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
              this.messages.add({
                severity: 'warn',
                summary: 'Benchmark con errores',
                detail: r.errors.join('; '),
                life: 5000,
              });
            } else {
              this.messages.add({
                severity: 'success',
                summary: 'Benchmark completado',
                life: 2600,
              });
            }
          } else {
            this.store.failBenchmark();
            this.messages.add({
              severity: 'error',
              summary: 'Benchmark falló',
              detail: data.error || 'Error desconocido',
              life: 5000,
            });
          }
        },
        error: (e: Error) => {
          this.store.failBenchmark();
          this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 5000 });
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
        this.api.savePromptDefault(this.store.prompt()).subscribe({
          next: () =>
            this.messages.add({
              severity: 'success',
              summary: 'Prompt default guardado',
              life: 2600,
            }),
          error: (e: Error) =>
            this.messages.add({
              severity: 'error',
              summary: 'Error',
              detail: e.message,
              life: 4000,
            }),
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
            this.messages.add({
              severity: 'success',
              summary: 'Prompt default restablecido',
              life: 2600,
            });
          },
          error: (e: Error) =>
            this.messages.add({
              severity: 'error',
              summary: 'No hay prompt default guardado',
              detail: e.message,
              life: 4000,
            }),
        });
      },
    });
  }
}
