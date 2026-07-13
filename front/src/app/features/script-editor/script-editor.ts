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
import { Table, TableModule } from 'primeng/table';
import { ConfirmationService, MessageService } from 'primeng/api';
import { BenchStore } from '../../core/state/bench.store';
import { LlamaBenchService } from '../../core/services/llama-bench.service';
import { formatScript } from '../../core/utils/format';
import {
  addFlagToScript,
  flagForms,
  FlagCategory,
  LLAMA_FLAGS,
  LlamaFlag,
} from '../../core/data/llama-flags';
import { InputGroupModule } from 'primeng/inputgroup';
import { InputGroupAddonModule } from 'primeng/inputgroupaddon';
import { CodeEditor } from '../../shared/code-editor/code-editor';

/** Orden establecido en que se muestran las categorías como row groups. */
const CATEGORY_ORDER: FlagCategory[] = ['Común', 'Muestreo', 'Especulativo', 'Servidor'];

/**
 * ScriptEditor: edición del script de llama-server (fuente de verdad).
 * Layout en dos columnas:
 *  - Columna UNO: CodeMirror (bash) con el script + acciones (formatear, default, play/stop).
 *  - Columna DOS: p-table con todas las flags conocidas, agrupadas por categoría
 *    (rowGroupMode subheader expandible). Búsqueda global en el caption + filtros
 *    por columna (texto para nombre/flag larga/corta). Cada fila con botón "info"
 *    (abre diálogo con descripción) y "agregar" (inserta el flag en el script).
 *    El filtrado lo hace PrimeNG nativamente (p-columnFilter + filterGlobal).
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
    TableModule,
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

  /**
   * Catálogo completo de flags mostrado en la tabla, ordenado por categoría.
   * El orden es requisito de `rowGroupMode="subheader"` para que las filas de un
   * mismo grupo queden contiguas.
   */
  protected readonly flagsList = computed<LlamaFlag[]>(() => {
    const rank = new Map<FlagCategory, number>();
    CATEGORY_ORDER.forEach((c, i) => rank.set(c, i));
    return [...LLAMA_FLAGS].sort(
      (a, b) => (rank.get(a.category) ?? 99) - (rank.get(b.category) ?? 99),
    );
  });

  /** Texto de la búsqueda global (caption). */
  protected readonly search = signal('');

  /** Categorías con su grupo colapsado (oculto) en la tabla. Vacío = todo expandido. */
  protected readonly collapsedCategories = signal<Set<FlagCategory>>(new Set(CATEGORY_ORDER));

  /**
   * Cuando hay búsqueda activa, ignoramos el estado colapsado para que los
   * resultados siempre sean visibles (si no, quedarían ocultos tras un header
   * plegado y el usuario no los vería).
   */
  protected readonly isCategoryExpanded = (cat: FlagCategory): boolean => {
    if (this.search().trim()) return true;
    return !this.collapsedCategories().has(cat);
  };

  /** Cuenta cuántos flags hay por categoría (badge del group header). */
  protected readonly categoryCount = (cat: FlagCategory): number =>
    this.flagsList().filter((f) => f.category === cat).length;

  /** Alterna la expansión de un grupo de categoría. */
  toggleCategory(cat: FlagCategory): void {
    this.collapsedCategories.update((set) => {
      const next = new Set(set);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }

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

  /** Limpia todos los filtros de la tabla (búsqueda global) y restaura expansión. */
  clearFlags(): void {
    this.search.set('');
    this.collapsedCategories.set(new Set());
    this.table()?.clear();
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
