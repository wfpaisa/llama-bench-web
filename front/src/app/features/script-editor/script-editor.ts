import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { ButtonModule } from 'primeng/button'
import { TextareaModule } from 'primeng/textarea'
import { ConfirmationService, MessageService } from 'primeng/api'
import { BenchStore } from '../../core/state/bench.store'
import { LlamaBenchService } from '../../core/services/llama-bench.service'
import { formatScript } from '../../core/utils/format'

/**
 * ScriptEditor: edición del script de llama-server (fuente de verdad).
 * - textarea con autosave a localStorage (vía effect del store).
 * - Formatear (reagrupa flags uno por línea).
 * - Guardar/Restablecer default en el backend (con confirmación).
 * - Play/Stop del servidor manual (deshabilitados según running).
 */
@Component({
  selector: 'app-script-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, TextareaModule],
  template: `
    <section class="card">
      <h2>Configuración del servidor</h2>

      <textarea
        pTextarea
        [ngModel]="script()"
        (ngModelChange)="onScriptChange($event)"
        rows="10"
        placeholder="./llama-server -hf modelo --ctx-size 8192 ..."
        spellcheck="false"
        class="script-area"
      ></textarea>

      <div class="actions">
        <div class="buttons">
          <p-button label="Formatear" icon="pi pi-replay" [text]="true" size="small" (onClick)="format()" />
          <p-button
            label="Guardar default"
            icon="pi pi-save"
            [text]="true"
            size="small"
            (onClick)="saveDefault($event)"
          />
          <p-button
            label="Restablecer default"
            icon="pi pi-refresh"
            [text]="true"
            size="small"
            (onClick)="restoreDefault($event)"
          />
        </div>

        <div class="buttons">
          <p-button
            label="Play"
            icon="pi pi-play"
            severity="success"
            [disabled]="running() || store.benchRunning()"
            (onClick)="start()"
          />
          <p-button label="Stop" icon="pi pi-stop" severity="danger" [disabled]="!running()" (onClick)="stop()" />
        </div>
      </div>
    </section>
  `,
  styleUrl: './script-editor.css',
})
export class ScriptEditor {
  protected readonly store = inject(BenchStore)
  private readonly api = inject(LlamaBenchService)
  private readonly messages = inject(MessageService)
  private readonly confirm = inject(ConfirmationService)

  /** Modelo local del textarea, sincronizado bidireccionalmente con store.script. */
  protected readonly script = signal(this.store.script())
  protected readonly running = this.store.running

  constructor() {
    // Cuando el script cambia externamente (p.ej. "apply" desde el historial),
    // reflejarlo en el textarea.
    effect(() => {
      const s = this.store.script()
      if (s !== this.script()) this.script.set(s)
    })
  }

  /** Usuario edita → actualiza modelo local y store (el effect del store persiste). */
  onScriptChange(value: string): void {
    this.script.set(value)
    this.store.setScript(value)
  }

  // ── Acciones ──

  format(): void {
    const formatted = formatScript(this.store.script())
    this.store.setScript(formatted)
    this.script.set(formatted)
    this.messages.add({ severity: 'success', summary: 'Script formateado', life: 2600 })
  }

  start(): void {
    this.api.startServer(this.store.script()).subscribe({
      next: () => this.messages.add({ severity: 'info', summary: 'Servidor iniciando…', life: 2600 }),
      error: (e: Error) => this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
    })
  }

  stop(): void {
    this.api.stopServer().subscribe({
      next: () => this.messages.add({ severity: 'success', summary: 'Servidor detenido.', life: 2600 }),
      error: (e: Error) => this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
    })
  }

  saveDefault(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Guardar el script actual como default?',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.api.saveScriptDefault(this.store.script()).subscribe({
          next: () => this.messages.add({ severity: 'success', summary: 'Default guardado', life: 2600 }),
          error: (e: Error) => this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
        })
      },
    })
  }

  restoreDefault(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Restablecer el script al default guardado? Se perderán los cambios no guardados.',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.api.getScriptDefault().subscribe({
          next: (text) => {
            this.store.setScript(text)
            this.messages.add({ severity: 'success', summary: 'Default restablecido', life: 2600 })
          },
          error: (e: Error) =>
            this.messages.add({ severity: 'error', summary: 'No hay default guardado', detail: e.message, life: 4000 }),
        })
      },
    })
  }
}
