import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Tema "Plane" para CodeMirror 6.
 *
 * Construido a mano siguiendo el patrón de `@codemirror/theme-one-dark`
 * (`EditorView.theme` + `HighlightStyle.define` + `syntaxHighlighting`), sin
 * depender de `thememirror`. Los colores provienen del tema equivalente de
 * VS Code (objeto `colors` para la chrome del editor y `tokenColors` para el
 * resaltado de sintaxis).
 */

// --- Paleta base (extraída del tema VS Code "Plane") -------------------------
const bg = '#191919'; // editor.background
const fg = '#e6e8ef'; // editor.foreground
const caret = '#aeafad'; // editorCursor.foreground
const selection = '#e8f2f334'; // editor.selectionBackground
const lineHighlight = '#ffffff0d'; // editor.lineHighlightBackground
const lineNumber = '#e6e8ef1b'; // editorLineNumber.foreground
const lineNumberActive = '#e6e8ef5e'; // editorLineNumber.activeForeground
const bracketMatch = '#fdf90027'; // editorBracketMatch.background
const findMatch = '#fff07c51'; // editor.findMatchBackground
const panelBg = '#2b2b2b'; // editorWidget.background

// Colores de sintaxis (tokenColors del tema VS Code).
const keyword = '#B486FF'; // keyword / storage / control / operator
const control = '#B486FF';
const comment = '#D8E4FC75';
const string = '#FFF1CC';
const number = '#E6E8EF'; // constant.numeric / constant.language
const func = '#6BD5FE'; // entity.name.function
const type = '#6BD5FE'; // entity.name.type
const param = '#22DDCC'; // variable.parameter / property / attribute-name
const property = '#22DDCC';
const tag = '#B486FF'; // entity.name.tag
const heading = '#6BD5FE';
const invalid = '#F44747';
const regexp = '#646695'; // constant.regexp
const markupBold = '#FF88AA'; // markup.bold / markup.heading
const stone = '#cccccc'; // meta / soporte genérico

// --- Chrome del editor -------------------------------------------------------
const planeEditorTheme = /*@__PURE__*/ EditorView.theme(
  {
    '&': {
      color: fg,
      backgroundColor: bg,
    },
    '.cm-content': {
      caretColor: caret,
    },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: caret },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: selection },
    '.cm-scroller': {
      fontFamily:
        '"Plane Nd", ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
    },
    '.cm-panels': { backgroundColor: panelBg, color: fg },
    '.cm-searchMatch': {
      backgroundColor: findMatch,
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#e6e8ef40',
    },
    '.cm-activeLine': { backgroundColor: lineHighlight },
    '.cm-selectionMatch': { backgroundColor: '#ffffff0c' },
    '&.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
      backgroundColor: bracketMatch,
    },
    '.cm-gutters': {
      backgroundColor: bg,
      color: lineNumber,
      border: 'none',
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'transparent',
      color: lineNumberActive,
    },
    '.cm-foldPlaceholder': {
      backgroundColor: 'transparent',
      border: 'none',
      color: '#999',
    },
    '.cm-tooltip': {
      border: 'none',
      backgroundColor: panelBg,
    },
  },
  { dark: true },
);

// --- Resaltado de sintaxis ---------------------------------------------------
const planeHighlightStyle = /*@__PURE__*/ HighlightStyle.define([
  // Comentarios.
  { tag: [tags.comment, tags.meta], color: comment, fontStyle: 'italic' },

  // Palabras clave, control, operadores y modificadores (storage).
  {
    tag: [
      tags.keyword,
      tags.controlKeyword,
      tags.operator,
      tags.operatorKeyword,
      tags.modifier,
      tags.definitionKeyword,
      tags.moduleKeyword,
    ],
    color: keyword,
  },
  { tag: tags.controlOperator, color: control },

  // Cadenas y literales crudos.
  {
    tag: [tags.string, tags.special(tags.string), tags.inserted, tags.docString],
    color: string,
  },

  // Números y constantes (constant.numeric / constant.language).
  {
    tag: [
      tags.number,
      tags.integer,
      tags.float,
      tags.bool,
      tags.atom,
      tags.null,
      tags.self,
      tags.unit,
    ],
    color: number,
  },

  // Nombres de función (entity.name.function).
  {
    tag: [
      tags.function(tags.variableName),
      tags.function(tags.propertyName),
      tags.labelName,
      tags.macroName,
    ],
    color: func,
  },

  // Tipos y clases (entity.name.type).
  {
    tag: [tags.typeName, tags.className, tags.namespace, tags.definition(tags.typeName)],
    color: type,
    fontStyle: 'italic',
  },

  // Definición de variable / nombre genérico (variable definida → foreground).
  {
    tag: [tags.definition(tags.variableName), tags.separator],
    color: fg,
  },

  // Parámetros y variables (variable.parameter).
  { tag: tags.variableName, color: fg },
  { tag: tags.local(tags.variableName), color: param, fontStyle: 'italic' },

  // Propiedades / claves de objeto / JSON (meta.object-literal.key).
  {
    tag: [tags.propertyName, tags.definition(tags.propertyName)],
    color: property,
  },

  // Tags y atributos (entity.name.tag / entity.other.attribute-name).
  { tag: tags.tagName, color: tag },
  { tag: tags.attributeName, color: param },
  { tag: tags.angleBracket, color: tag },

  // Expresiones regulares.
  { tag: tags.regexp, color: regexp },

  // Puntuación / soporte genérico.
  { tag: [tags.punctuation, tags.contentSeparator], color: stone },

  // Encabezados markdown.
  { tag: tags.heading, color: heading, fontWeight: 'bold' },

  // Markup: negrita / itálica / tachado / crudo.
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.monospace, tags.quote], color: string },
  { tag: tags.link, color: func, textDecoration: 'underline' },

  // Cambios (diff) y errores.
  { tag: tags.changed, color: markupBold },
  { tag: tags.deleted, color: '#CE9178' },
  { tag: tags.invalid, color: invalid },
]);

/**
 * Extensión que activa el tema Plane (chrome + resaltado).
 * Úsalo como cualquier otra extensión de CodeMirror.
 */
const planeTheme = [planeEditorTheme, /*@__PURE__*/ syntaxHighlighting(planeHighlightStyle)];

export default planeTheme;
export { planeEditorTheme, planeHighlightStyle };
