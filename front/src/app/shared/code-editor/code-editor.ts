import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  OnDestroy,
  effect,
  input,
  output,
  untracked,
  viewChild,
} from '@angular/core';
import { basicSetup } from 'codemirror';
import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import planeTheme from './plane-theme';

/**
 * CodeEditor: wrapper fino sobre CodeMirror 6.
 *
 * - `value` (input signal) → contenido del editor; cuando cambia desde fuera
 *   (formateo, restore, apply desde historial…), se reemplaza el doc.
 * - `valueChange` (output) → emite el nuevo contenido al editar (tecleo/pego).
 * - `pasteTransform` (input signal) → función opcional para transformar el
 *   texto resultante de un pegado (p.ej. formatear el script). Si retorna un
 *   valor distinto del merge crudo, se aplica ese en vez del texto pegado.
 *
 * Sincronización sin bucles: un flag `suppressChange` marca los dispatch que
 * provienen de un cambio externo (input) para no reemitirlos por `valueChange`.
 * El editor se crea en un `effect` que depende solo del host (ya montado);
 * el valor inicial se lee con `untracked` para no suscribir el efecto a `value`.
 *
 * Tema: One Dark (oscuro neutro). Lenguaje: shell/bash (legacy-modes vía
 * StreamLanguage, no existe paquete @codemirror/lang-shell).
 */
@Component({
  selector: 'app-code-editor',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div #host class="cm-host"></div>`,
  styleUrl: './code-editor.css',
})
export class CodeEditor implements OnDestroy {
  /** Contenido actual del editor. */
  readonly value = input<string>('');

  /** Transformación opcional del texto pegado (recibe el merge y retorna el resultado). */
  readonly pasteTransform = input<((merged: string) => string) | null>(null);

  /** Emite el contenido del editor cuando cambia (tecleo, pego, etc.). */
  readonly valueChange = output<string>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');

  private view: EditorView | null = null;

  /** Marca los dispatch que NO deben emitir valueChange (cambios externos). */
  private suppressChange = false;

  constructor() {
    // Crear el editor una vez que el host está en el DOM. Lee el valor inicial
    // con untracked para no re-suscribir este effect a `value`.
    effect(() => {
      const el = this.host().nativeElement;
      const initial = untracked(this.value);
      this.view = new EditorView({
        state: EditorState.create({
          doc: initial,
          extensions: [
            basicSetup,
            planeTheme,
            StreamLanguage.define(shell),
            EditorView.lineWrapping,
            EditorView.updateListener.of((u) => {
              if (u.docChanged && !this.suppressChange) {
                this.valueChange.emit(u.state.doc.toString());
              }
            }),
            EditorView.domEventHandlers({
              paste: (event) => this.handlePaste(event),
            }),
          ],
        }),
        parent: el,
      });
    });

    // Sincronización externa: si `value` cambia fuera del editor, reemplazar el
    // doc sin reemitir (suppressChange) y solo si difiere del contenido actual.
    effect(() => {
      const next = this.value();
      const v = this.view;
      if (!v) return;
      const current = v.state.doc.toString();
      if (next === current) return;
      this.suppressChange = true;
      v.dispatch({
        changes: { from: 0, to: current.length, insert: next },
      });
      this.suppressChange = false;
    });
  }

  /**
   * Intercepta el pegado: toma el texto del clipboard, lo mezcla con el doc
   * actual (insertándolo sobre la selección) y, si hay `pasteTransform`, aplica
   * esa función al merge y reemplaza todo el doc con el resultado (paridad con
   * el textarea anterior, que reemplazaba todo el contenido formateado). Así se
   * evita acoplar CodeMirror al dominio: la función de formateo la aporta el padre.
   *
   * El cursor se deja justo después del texto pegado (posición natural de un
   * pegado, `sel.from + pasted.length`), clampeada al rango del resultado por si
   * el transform reformateó y cambió longitudes. Así NO salta al final del doc.
   */
  private handlePaste(event: ClipboardEvent): boolean {
    const transform = this.pasteTransform();
    if (!transform || !this.view) return false;
    const pasted = event.clipboardData?.getData('text') ?? '';
    if (!pasted) return false;

    event.preventDefault();
    const v = this.view;
    const sel = v.state.selection.main;
    const current = v.state.doc.toString();
    const merged = current.slice(0, sel.from) + pasted + current.slice(sel.to);
    const result = transform(merged);

    // Posición natural del cursor: justo después del texto pegado. Si el
    // transform no reformateó (result === merged), es exacta; si reformateó,
    // quedará cerca del punto de pegado en vez de saltar al final del doc.
    const anchor = Math.min(Math.max(sel.from + pasted.length, 0), result.length);

    this.suppressChange = false;
    v.dispatch({
      changes: { from: 0, to: current.length, insert: result },
      selection: { anchor },
      userEvent: 'input.paste',
    });
    this.valueChange.emit(result);
    return true;
  }

  ngOnDestroy(): void {
    this.view?.destroy();
    this.view = null;
  }
}
