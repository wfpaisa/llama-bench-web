## Plan: marcar flags usadas, deshabilitar botón agregar y reorganizar categoría "común"

### Parte 1 — Marcar filas ya usadas en el script (ya implementado, se refuerza)
El `computed` `flagPresent` (`script-editor.ts:102`) ya detecta qué flags están en el script y la clase CSS `.present` ya pinta un borde verde a la izquierda (`script-editor.css:80`). Como elegiste "mantener borde verde actual", **no hay cambios visuales nuevos en la marca** — solo nos apoyamos en lo existente.

### Parte 2 — Deshabilitar el botón "Agregar" de las filas presentes
En `script-editor.html` (botón `pi-arrow-left` de la celda `cell-actions`, ~línea 178):
- Añadir `[disabled]="flagPresent().has(f.long)"`.
- Tooltip dinámico: `pTooltip="Agregar al script"` cuando no está presente → `"Ya está en el script"` cuando sí. Se logra con `[pTooltip]="flagPresent().has(f.long) ? 'Ya está en el script' : 'Agregar al script'"`.
- `addToScript` ya es idempotente (`addFlagToScript` devuelve `added: false`), así que aunque el botón estuviera habilitado no duplicaría; el `[disabled]` es puramente UX.

No se toca la lógica TS (`addToScript`, `flagPresent`): ya hacen lo correcto.

### Parte 3 — Reorganizar la categoría "común" en `front/src/app/core/data/llama-flags.ts`

**A) Mover 12 flags muy usadas → `común`** (cambiar su campo `category`):
- Desde `muestreo` (5): `--temperature`, `--top-k`, `--top-p`, `--min-p`, `--repeat-penalty`
- Desde `especulativo` (2): `--spec-type`, `--spec-draft-n-max`
- Desde `servidor` (5): `--jinja`, `--metrics`, `--mmproj-auto`, `--cache-reuse`, `--chat-template-kwargs`

**B) Mover 46 flags raramente usadas que hoy están en `común` → `servidor`** (excepto las 2 draft-cache que van a `especulativo` por su naturaleza de draft model):
- Hacia `servidor` (44): `--swa-full`, `--perf`, `--escape`, `--kv-offload`, `--defrag-thold`, `--rope-scaling`, `--rope-scale`, `--rope-freq-base`, `--rope-freq-scale`, `--yarn-orig-ctx`, `--yarn-ext-factor`, `--yarn-attn-factor`, `--override-tensor`, `--fit`, `--fit-target`, `--fit-ctx`, `--check-tensors`, `--override-kv`, `--op-offload`, `--direct-io`, `--numa`, `--lora`, `--lora-scaled`, `--control-vector`, `--control-vector-scaled`, `--control-vector-layer-range`, `--cpu-mask`, `--cpu-range`, `--cpu-strict`, `--prio`, `--poll`, `--repack`, `--no-host`, `--verbose`, `--verbosity`, `--log-file`, `--log-colors`, `--log-timestamps`, `--log-disable`, `--offline`, `--version`, `--help`, `--completion-bash`, `--cache-list`
- Hacia `especulativo` (2): `--cache-type-k-draft`, `--cache-type-v-draft`

**Reorganización física del array**: el archivo declara "Ordenado dentro de cada grupo" y tiene comentarios de sección (`// ═══ PARÁMETROS COMUNES ═══`). Para mantenerlo coherente, se **reescribe el array moviendo físicamente cada entrada a su nueva sección**, preservando el contenido exacto de cada entrada (name/long/short/aliases/defaultValue/description) y solo cambiando `category`. Esto produce churn pero mantiene el archivo legible y fiel a su doc comment.

**Resultado de recuentos** (verificado, total sigue 199):
- común: 74 − 46 + 12 = **40**
- muestreo: 34 − 5 = **29**
- especulativo: 22 − 2 + 2 = **22**
- servidor: 69 + 44 − 5 = **108**

**Sin cambios funcionales en el componente**: la tabla lee `f.category` del catálogo para el `<p-tag>` y el multiselect de filtro usa `categoryOptions()` (computado del catálogo), así que la reorganización se refleja automáticamente. No hay hardcoding de categorías en el TS/HTML.

### Verificación
- `cd front && bunx tsc --noEmit` (o `ng build`) para asegurar que el catálogo sigue tipando correctamente (`FlagCategory` no cambia, sigue siendo la misma unión de 4 literales).
- Confirmar que el total de entradas sigue siendo 199 (ninguna pérdida en el reordenamiento).
- Revisar visualmente que el filtro por categoría del multiselect muestra las 4 categorías y que las filas presentes tienen el botón Agregar deshabilitado.

### Archivos tocados
1. `front/src/app/features/script-editor/script-editor.html` — `[disabled]` + tooltip dinámico en el botón agregar.
2. `front/src/app/core/data/llama-flags.ts` — reorganización de categorías (reasignación + reordenamiento físico de entradas).