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
  templateUrl: './script-editor.html',
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
