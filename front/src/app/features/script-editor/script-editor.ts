import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { TextareaModule } from 'primeng/textarea';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { SelectModule } from 'primeng/select';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { formatScript } from '../../core/utils/format';
import {
  addFlagToScript,
  flagForms,
  LLAMA_FLAGS,
  LlamaFlag,
  FlagCategory,
} from '../../core/data/llama-flags';

/**
 * ScriptEditor: edición del script de llama-server (fuente de verdad).
 * Layout en dos columnas:
 *  - Columna UNO: textarea con el script + acciones (formatear, default, play/stop).
 *  - Columna DOS: tabla de todas las flags conocidas con filtro (texto y
 *    categoría); cada fila con botón "info" (abre diálogo con descripción) y
 *    "agregar" (inserta el flag en el script).
 */
@Component({
  selector: 'app-script-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    TextareaModule,
    DialogModule,
    TooltipModule,
    InputTextModule,
    SelectModule,
  ],
  template: `
    <section class="card">
      <h2>Configuración del servidor</h2>

      <div class="cols">
        <!-- Columna UNO: editor del script -->
        <div class="col col-script">
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
              <p-button
                label="Formatear"
                icon="pi pi-replay"
                [text]="true"
                size="small"
                (onClick)="format()"
              />
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
              <p-button
                label="Stop"
                icon="pi pi-stop"
                severity="danger"
                [disabled]="!running()"
                (onClick)="stop()"
              />
            </div>
          </div>
        </div>

        <!-- Columna DOS: tabla de flags -->
        <div class="col col-flags">
          <div class="flags-toolbar">
            <input
              pInputText
              type="text"
              class="flag-filter"
              placeholder="Filtrar flags…"
              [ngModel]="filterText()"
              (ngModelChange)="filterText.set($event)"
            />
            <p-select
              class="flag-category"
              [options]="categoryOptions()"
              [ngModel]="filterCategory()"
              (ngModelChange)="filterCategory.set($event)"
              optionLabel="label"
              optionValue="value"
              placeholder="Categoría"
              [showClear]="true"
            />
            <span class="muted count">{{ filteredFlags().length }} / {{ flagsList().length }}</span>
          </div>

          <div class="flags-scroll">
            <table class="flags-table">
              <thead>
                <tr>
                  <th>Nombre</th>
                  <th>Flag larga</th>
                  <th>Flag corta</th>
                  <th class="th-actions">Info</th>
                  <th class="th-actions">Agregar</th>
                </tr>
              </thead>
              <tbody>
                @for (f of filteredFlags(); track f.long) {
                  <tr [class.present]="flagPresent().has(f.long)">
                    <td class="cell-name">
                      <div class="flag-name">{{ f.name }}</div>
                      @if (f.defaultValue) {
                        <div class="flag-default">
                          default: <code>{{ f.defaultValue }}</code>
                        </div>
                      } @else {
                        <div class="flag-default muted">switch</div>
                      }
                      <div class="flag-cat">{{ f.category }}</div>
                    </td>
                    <td class="cell-code">
                      <code>{{ f.long }}</code>
                    </td>
                    <td class="cell-code">
                      @if (f.short) {
                        <code>{{ f.short }}</code>
                      } @else {
                        <span class="muted">—</span>
                      }
                    </td>
                    <td class="cell-actions">
                      <p-button
                        icon="pi pi-info-circle"
                        [text]="true"
                        size="small"
                        pTooltip="Info"
                        (onClick)="openInfo(f)"
                      />
                    </td>
                    <td class="cell-actions">
                      <p-button
                        icon="pi pi-plus"
                        size="small"
                        severity="success"
                        pTooltip="Agregar al script"
                        (onClick)="addToScript(f)"
                      />
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td colspan="5" class="empty">Ningún flag coincide con el filtro.</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <!-- Diálogo de descripción de un flag -->
    <p-dialog
      [header]="infoFlag()?.name ?? ''"
      [(visible)]="infoVisible"
      [modal]="true"
      [draggable]="false"
      [resizable]="false"
      [style]="{ width: '90vw', maxWidth: '560px' }"
      [breakpoints]="{ '640px': '95vw' }"
    >
      @if (infoFlag(); as f) {
        <div class="info-body">
          <div class="info-codes">
            <code>{{ f.long }}</code>
            @if (f.short) {
              <code class="muted">{{ f.short }}</code>
            }
            @if (f.aliases?.length) {
              <span class="muted">{{ f.aliases.join(', ') }}</span>
            }
          </div>
          <div class="info-default">
            @if (f.defaultValue) {
              Valor por defecto: <code>{{ f.defaultValue }}</code>
            } @else {
              <span class="muted">Switch (sin valor)</span>
            }
          </div>
          <p class="info-desc">{{ f.description }}</p>
        </div>
      }
    </p-dialog>
  `,
  styleUrl: './script-editor.css',
})
export class ScriptEditor {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** Modelo local del textarea, sincronizado bidireccionalmente con store.script. */
  protected readonly script = signal(this.store.script());
  protected readonly running = this.store.running;

  /** Catálogo completo de flags mostrado en la tabla. */
  protected readonly flagsList = signal<LlamaFlag[]>(LLAMA_FLAGS);

  /** Filtros de la tabla de flags. */
  protected readonly filterText = signal('');
  protected readonly filterCategory = signal<FlagCategory | ''>('');

  /** Flags ya filtrados por texto + categoría (en una pasada). */
  protected readonly filteredFlags = computed<LlamaFlag[]>(() => {
    const q = this.filterText().trim().toLowerCase();
    const cat = this.filterCategory();
    return this.flagsList().filter((f) => {
      if (cat && f.category !== cat) return false;
      if (!q) return true;
      // Buscar en nombre, flag larga, corta y aliases.
      if (f.name.toLowerCase().includes(q)) return true;
      if (f.long.toLowerCase().includes(q)) return true;
      if (f.short?.toLowerCase().includes(q)) return true;
      if (f.aliases?.some((a) => a.toLowerCase().includes(q))) return true;
      return false;
    });
  });

  /** Opciones del filtro por categoría (con conteo). */
  protected readonly categoryOptions = computed(() => {
    const counts = new Map<FlagCategory, number>();
    for (const f of this.flagsList()) counts.set(f.category, (counts.get(f.category) ?? 0) + 1);
    return [...counts.entries()].map(([value, n]) => ({ label: `${value} (${n})`, value }));
  });

  /**
   * Set de flags (por flag larga) que ya están presentes en el script actual.
   * Sirve para resaltar las filas de la tabla que ya se agregaron. Recomputa
   * cuando el script cambia.
   */
  protected readonly flagPresent = computed<Set<string>>(() => {
    const script = this.script();
    const tokens = new Set(script.replace(/\\\r?\n/g, ' ').split(/\s+/));
    const present = new Set<string>();
    for (const f of this.flagsList()) {
      for (const form of flagForms(f)) {
        if (tokens.has(form)) {
          present.add(f.long);
          break;
        }
      }
    }
    return present;
  });

  /** Flag seleccionado para mostrar en el diálogo de info. */
  protected readonly infoFlag = signal<LlamaFlag | null>(null);
  protected readonly infoVisible = signal(false);

  constructor() {
    // Cuando el script cambia externamente (p.ej. "apply" desde el historial),
    // reflejarlo en el textarea.
    effect(() => {
      const s = this.store.script();
      if (s !== this.script()) this.script.set(s);
    });
  }

  /** Usuario edita → actualiza modelo local y store (el effect del store persiste). */
  onScriptChange(value: string): void {
    this.script.set(value);
    this.store.setScript(value);
  }

  // ── Acciones ──

  format(): void {
    const formatted = formatScript(this.store.script());
    this.store.setScript(formatted);
    this.script.set(formatted);
    this.messages.add({ severity: 'success', summary: 'Script formateado', life: 2600 });
  }

  // ── Catálogo de flags ──

  /** Abre el diálogo de info con la descripción del flag. */
  openInfo(f: LlamaFlag): void {
    this.infoFlag.set(f);
    this.infoVisible.set(true);
  }

  /** Inserta el flag en el script actual (no lo pisa si ya existe). */
  addToScript(f: LlamaFlag): void {
    const { script: next, added } = addFlagToScript(this.store.script(), f);
    this.store.setScript(next);
    this.script.set(next);
    this.messages.add(
      added
        ? { severity: 'success', summary: `Flag ${f.long} agregado`, life: 2600 }
        : {
            severity: 'info',
            summary: `El flag ${f.long} ya está en el script`,
            detail: 'Se conservó el valor existente.',
            life: 3200,
          },
    );
  }

  start(): void {
    this.api.startServer(this.store.script()).subscribe({
      next: () =>
        this.messages.add({ severity: 'info', summary: 'Servidor iniciando…', life: 2600 }),
      error: (e: Error) =>
        this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
    });
  }

  stop(): void {
    this.api.stopServer().subscribe({
      next: () =>
        this.messages.add({ severity: 'success', summary: 'Servidor detenido.', life: 2600 }),
      error: (e: Error) =>
        this.messages.add({ severity: 'error', summary: 'Error', detail: e.message, life: 4000 }),
    });
  }

  saveDefault(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Guardar el script actual como default?',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.api.saveScriptDefault(this.store.script()).subscribe({
          next: () =>
            this.messages.add({ severity: 'success', summary: 'Default guardado', life: 2600 }),
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

  restoreDefault(event: Event): void {
    this.confirm.confirm({
      target: event.target as EventTarget,
      message: '¿Restablecer el script al default guardado? Se perderán los cambios no guardados.',
      icon: 'pi pi-exclamation-triangle',
      accept: () => {
        this.api.getScriptDefault().subscribe({
          next: (text) => {
            this.store.setScript(text);
            this.messages.add({ severity: 'success', summary: 'Default restablecido', life: 2600 });
          },
          error: (e: Error) =>
            this.messages.add({
              severity: 'error',
              summary: 'No hay default guardado',
              detail: e.message,
              life: 4000,
            }),
        });
      },
    });
  }
}
