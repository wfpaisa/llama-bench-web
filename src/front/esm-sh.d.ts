// Declaraciones de tipos para módulos externos cargados desde esm.sh.
// tsc no resuelve imports por URL; estos stubs permiten typecheck sin instalar
// las dependencias. Los tipos exactos no importan: Bun.build los resuelve en
// tiempo de ejecución.

declare module 'https://esm.sh/codemirror@6.0.1' {
  export const basicSetup: unknown[]
  export class EditorView {
    state: { doc: { toString(): string; length: number } }
    dispatch(update: { changes: { from: number; to: number; insert: string } }): void
    static updateListener: { of(fn: () => void): unknown }
    constructor(options: { doc: string; extensions: unknown[]; parent: Element | null })
  }
}

declare module 'https://esm.sh/@codemirror/theme-one-dark@6.1.2' {
  export const oneDark: unknown
}

declare module 'https://esm.sh/@codemirror/language@6.11.2' {
  export const StreamLanguage: {
    define(lang: unknown): unknown
  }
}

declare module 'https://esm.sh/@codemirror/legacy-modes@6.5.1/mode/shell' {
  export const shell: unknown
}
