// Configuración del entorno: puertos, rutas de datos y binario.
// Todos los valores admiten override por variable de entorno.

import { join } from 'node:path'

// Puerto del backend web. NO usar 8080: es el default de llama-server y
// chocaría/confundiría con él.
export const PORT = Number(process.env.PORT ?? 3000)

// Carpeta donde se persisten history.json y script-default.txt.
export const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data')

// Historial de benchmarks (JSON array, cap de 200 entradas).
export const HISTORY_FILE = join(DATA_DIR, 'history.json')

// Script por defecto guardado desde la UI (botón "Guardar default").
// Vive fuera de git (.gitignore ignora data/*). Solo existe tras el primer guardado.
export const SCRIPT_FILE = join(DATA_DIR, 'script-default.txt')

// Prompt de benchmark por defecto guardado desde la UI.
export const PROMPT_FILE = join(DATA_DIR, 'prompt-default.txt')

// Flags destacadas (favoritos) del editor de script. Array JSON con las flags
// largas canónicas (p.ej. ['--ctx-size', '--n-gpu-layers']).
export const FLAGS_FAV_FILE = join(DATA_DIR, 'flags-favorites.json')

// Límite del historial persistido.
export const HISTORY_CAP = 200

// Capacidad del buffer circular de logs en memoria.
export const LOG_CAP = 5000

// Archivo de diagnóstico del último benchmark (debug de métricas en null).
// Se sobrescribe en cada run con las últimas líneas del slice del benchmark.
export const DEBUG_LOG_FILE = join(DATA_DIR, 'log_debug.txt')

// Máximo de líneas volcadas a log_debug.txt por cada benchmark.
export const DEBUG_LOG_TAIL_LINES = 1000
