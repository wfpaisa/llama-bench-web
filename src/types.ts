// Tipos compartidos entre backend y frontend.
// Se mantienen intencionalmente simples (sin dependencias externas).
//
// NOTA IMPORTANTE (cambio de arquitectura):
//   La fuente de verdad de la configuración del servidor pasó de ser un objeto
//   estructurado (ServerConfig) a un SCRIPT de shell crudo editado en la UI.
//   ParsedScript representa tanto el script tal cual como los escalares que el
//   backend extrae de él (para display de historial y para la API de benchmark).

/**
 * Script de llama-server ya parseado: texto crudo + tokens + escalares extraídos.
 *
 * - `script`: el texto exacto que edita el usuario (con `\` y saltos de línea).
 * - `binary` / `argv`: tokens resultantes de parsear `script` (listo para spawn).
 * - Los escalares (`model`, `ctxSize`, etc.) vienen del parseo de `argv`;
 *   un valor `null` significa "el flag no estaba en el script". Se usan tanto
 *   para poblar columnas del historial como para armar el request del benchmark.
 *
 * Backward-compat: las entradas viejas del historial guardaban una ServerConfig
 * estructurada con estas mismas claves escalares. El render usa `?? "—"`, así
 * que siguen funcionando. Solo las entradas nuevas traen `script`.
 */
export interface ParsedScript {
  /** Script crudo tal como se edita (con continuaciones `\` y newlines). */
  script: string
  /** Ruta/nombre del binario (primer token del script). */
  binary: string
  /** Argumentos tokenizados (sin el binario). */
  argv: string[]

  // ── Escalares extraídos para historial + benchmark ──
  /** Modelo HF repo/file (`-hf`). null si no estaba. */
  model: string | null
  /** Host (`--host`); default "127.0.0.1" si no estaba. */
  host: string
  /** Puerto (`--port`); default 8080 si no estaba. */
  port: number
  /** `--ctx-size`. null si no estaba. */
  ctxSize: number | null
  /** `--batch-size`. null si no estaba. */
  batchSize: number | null
  /** `--ubatch-size`. null si no estaba. */
  ubatchSize: number | null
  /** `--cache-type-k`. null si no estaba. */
  cacheTypeK: string | null
  /** `--cache-type-v`. null si no estaba. */
  cacheTypeV: string | null
  /** `--device` (p.ej. "Vulkan0,Vulkan1"). null si no estaba. */
  device: string | null
  /** `--tensor-split`. null si no estaba. */
  tensorSplit: string | null
  /** `--temp` (sampling, usado en el request del benchmark). null si no estaba. */
  temp: number | null
  /** `--top-p` (sampling). null si no estaba. */
  topP: number | null
  /** `--top-k` (sampling). null si no estaba. */
  topK: number | null
}

/** Estado del proceso llama-server gestionado por el backend. */
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error'

/** Respuesta de GET /status. */
export interface StatusResponse {
  status: ServerStatus
  /** PID del proceso si está corriendo. */
  pid: number | null
  /** Timestamp ISO de inicio. */
  startedAt: string | null
  /** URL base de llama-server cuando está corriendo. */
  url: string | null
  /** Mensaje de error si lo hubiera. */
  error: string | null
}

/** Línea de log del proceso. */
export interface LogEntry {
  /** Monotónico (ms) desde arranque del backend, para ordenar. */
  t: number
  /** 'stdout' | 'stderr' | 'system'. */
  stream: 'stdout' | 'stderr' | 'system'
  msg: string
}

/** Respuesta de GET /logs. */
export interface LogsResponse {
  entries: LogEntry[]
  /** Índice de la última línea incluida, para polling incremental. */
  cursor: number
}

/** Métricas de una GPU. */
export interface GpuInfo {
  /** Índice/identificador (p.ej. "nvidia0", "amdgpu-card0"). */
  index: string
  /** Marca. */
  vendor: 'nvidia' | 'amd'
  /** VRAM usada en MiB. */
  memUsedMiB: number | null
  /** VRAM total en MiB. */
  memTotalMiB: number | null
  /** % utilización del GPU. */
  gpuUtilPct: number | null
}

/** Backend de cómputo del binario de llama-server (deducido de --list-devices). */
export type GpuBackend = 'cuda' | 'vulkan' | 'sycl' | 'metal' | 'opencl' | 'cann' | 'cpu' | 'unknown'

/**
 * Device reportado por `llama-server --list-devices`: el id del BACKEND
 * (CUDA0, Vulkan0, …), no del SO. A diferencia de GpuInfo (nvidia-smi/sysfs),
 * cubre todos los vendors del binario, incluido Intel vía Vulkan.
 */
export interface LlamaDevice {
  /** Id del backend (p.ej. "CUDA0", "Vulkan0"). */
  id: string
  /** Nombre legible (p.ej. "NVIDIA GeForce RTX 5070 Ti"). */
  name: string
  /** Marca deducida del nombre. */
  vendor: 'nvidia' | 'amd' | 'intel' | 'unknown'
  /** VRAM total en MiB. */
  totalMiB: number
  /** VRAM libre en MiB. */
  freeMiB: number
}

/**
 * VRAM consumida por el modelo en un device del backend: el device reportado
 * por --list-devices + el delta de VRAM libre (antes − después de cargar el
 * modelo). `usedMiB` es null si no se pudo medir el delta.
 */
export interface DeviceVram {
  device: LlamaDevice
  /** Delta de VRAM libre consumido por el modelo (baseline.free − final.free). */
  usedMiB: number | null
}

/** Métricas de RAM del sistema (Linux, /proc/meminfo). null si no disponible. */
export interface RamInfo {
  /** RAM total en MiB (MemTotal). */
  memTotalMiB: number | null
  /** RAM usada en MiB (MemTotal − MemAvailable). */
  memUsedMiB: number | null
  /** RAM disponible en MiB (MemAvailable). */
  memAvailableMiB: number | null
}

/** Resultado completo de un benchmark. */
export interface BenchmarkResult {
  /** ID único. */
  id: string
  /** Timestamp ISO. */
  timestamp: string
  /** Configuración usada (snapshot del script parseado). */
  config: ParsedScript
  /** Tokens por segundo en prompt eval (TG inverso). */
  promptTokensPerSecond: number | null
  /** Cantidad de tokens del prompt (nº tras "/" en "prompt eval time"). */
  promptTokenCount: number | null
  /** Tiempo de procesado del prompt en ms ("prompt eval time = X ms"). */
  promptEvalTimeMs: number | null
  /** Tokens por segundo en generación. */
  generationTokensPerSecond: number | null
  /** Cantidad de tokens generados (nº tras "/" en "eval time"). */
  generationTokenCount: number | null
  /** Aceptación del draft (speculative / MTP). */
  draftAcceptance: number | null
  /** draft-mtp: drafts generados (`#gen drafts`). null si no aplica. */
  genDrafts: number | null
  /** draft-mtp: drafts aceptados (`#acc drafts`). null si no aplica. */
  accDrafts: number | null
  /** draft-mtp: tokens generados (`#gen tokens`). null si no aplica. */
  genTokens: number | null
  /** draft-mtp: tokens aceptados (`#acc tokens`). null si no aplica. */
  accTokens: number | null
  /** Tiempo de carga del modelo en segundos. */
  loadTimeSeconds: number | null
  /** Tiempo de generación (eval time) en ms, sin incluir prompt ni startup. */
  generationTimeMs: number | null
  /** Latencia total del request de benchmark en ms. */
  requestLatencyMs: number | null
  /** Prompt usado. */
  prompt: string
  /** Respuesta generada (truncada). */
  response: string
  /** Métricas de GPUs. */
  gpus: GpuInfo[]
  /** Backend de cómputo del binario (cuda/vulkan/…). null si no se detectó. */
  backend: GpuBackend | null
  /**
   * VRAM por device del backend (delta consumido por el modelo), filtrado por
   * `--device`. Vacío en entradas viejas o si --list-devices falló; en ese caso
   * el render cae a `gpus` (legacy nvidia-smi/sysfs).
   */
  deviceVram: DeviceVram[]
  /** RAM usada por el benchmark (delta MemUsed durante el run) en MiB. null si no disponible. */
  ramUsedMiB: number | null
  /**
   * Calificación del usuario (1-5 estrellas). null = sin calificar.
   * Campo opcional para compatibilidad con entradas viejas del historial.
   */
  rating?: number | null
  /** Errores encontrados durante el run. */
  errors: string[]
}
