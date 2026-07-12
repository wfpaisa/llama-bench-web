import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { DialogModule } from 'primeng/dialog';
import { TooltipModule } from 'primeng/tooltip';
import { InputTextModule } from 'primeng/inputtext';
import { IconFieldModule } from 'primeng/iconfield';
import { InputIconModule } from 'primeng/inputicon';
import { MultiSelectModule } from 'primeng/multiselect';
import { Table, TableModule } from 'primeng/table';
import { TagModule } from 'primeng/tag';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { formatScript } from '../../core/utils/format';
import { addFlagToScript, flagForms, LLAMA_FLAGS, LlamaFlag } from '../../core/data/llama-flags';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { CodeEditor } from '../../shared/code-editor/code-editor';

/** Severidad de p-tag por categoría de flag (para diferenciarlas visualmente). */
const CATEGORY_SEVERITY: Record<string, 'info' | 'success' | 'warn' | null> = {
  común: 'info',
  muestreo: 'success',
  especulativo: 'warn',
  servidor: null,
};

/**
 * ScriptEditor: edición del script de llama-server (fuente de verdad).
 * Layout en dos columnas:
 *  - Columna UNO: CodeMirror (bash) con el script + acciones (formatear, default, play/stop).
 *  - Columna DOS: p-table con todas las flags conocidas, con búsqueda global
 *    (en el caption) + filtros por columna (multiselect para categoría, texto
 *    para nombre/flag larga/corta). Cada fila con botón "info" (abre diálogo con
 *    descripción) y "agregar" (inserta el flag en el script). El filtrado lo
 *    hace PrimeNG nativamente (p-columnFilter + filterGlobal).
 */
@Component({
  selector: 'app-script-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    ButtonModule,
    DialogModule,
    TooltipModule,
    InputTextModule,
    IconFieldModule,
    InputIconModule,
    MultiSelectModule,
    TableModule,
    TagModule,
    InputGroupModule,
    InputGroupAddonModule,
    CodeEditor,
  ],
  templateUrl: './script-editor.html',
  styleUrl: './script-editor.css',
})
export class ScriptEditor {
  protected readonly store = inject(BenchStore);
  private readonly api = inject(LlamaBenchService);
  private readonly messages = inject(MessageService);
  private readonly confirm = inject(ConfirmationService);

  /** Modelo local del editor, sincronizado bidireccionalmente con store.script. */
  protected readonly script = signal(this.store.script());
  protected readonly running = this.store.running;

  /** Función de formateo pasada al CodeEditor para normalizar el texto pegado. */
  protected readonly formatScriptFn = formatScript;

  /** Referencia a la p-table para poder limpiar filtros / buscar globalmente. */
  protected readonly table = viewChild<Table>('dt');

  /** Catálogo completo de flags mostrado en la tabla. */
  protected readonly flagsList = signal<LlamaFlag[]>(LLAMA_FLAGS);

  /** Texto de la búsqueda global (caption). */
  protected readonly search = signal('');

  /** Categorías únicas para el multiselect de filtro (orden del catálogo). */
  protected readonly categoryOptions = computed<string[]>(() => {
    const seen = new Set<string>();
    for (const f of this.flagsList()) seen.add(f.category);
    return [...seen];
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

  /** Visibilidad del diálogo fullscreen de la tabla de flags. */
  protected readonly fullscreenVisible = signal(false);
  protected toggleFullscreen(): void {
    this.fullscreenVisible.set(true);
  }

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

  /**
   * Formatea el script actual del store (fuente de verdad) y lo refleja en el
   * textarea. No avisa con toast si se invoca desde start()/format interno.
   */
  format(): void {
    const formatted = formatScript(this.store.script());
    this.store.setScript(formatted);
    this.script.set(formatted);
    this.messages.add({ severity: 'success', summary: 'Script formateado', life: 2600 });
  }

  /** Formatea el script silenciosamente (sin toast). */
  private formatSilent(): void {
    const formatted = formatScript(this.store.script());
    this.store.setScript(formatted);
    this.script.set(formatted);
  }

  // ── Catálogo de flags ──

  /** Severidad de p-tag para una categoría de flag. */
  getCategorySeverity(category: string): 'info' | 'success' | 'warn' | null {
    return CATEGORY_SEVERITY[category] ?? null;
  }

  /** Limpia todos los filtros de la tabla (columnas + búsqueda global). */
  clearFlags(): void {
    this.search.set('');
    this.table()?.clear();
  }

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
    // Formatear el script antes de arrancar para enviarlo normalizado al backend.
    this.formatSilent();
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
