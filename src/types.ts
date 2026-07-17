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
  /** `--n-gpu-layers` (capas offload a GPU). null si no estaba. */
  ngl: number | null
  /** `--flash-attn` activado. false si no estaba. */
  flashAttn: boolean
  /** `--threads` (-t). null si no estaba. */
  threads: number | null
  /** `--min-p` (sampling). null si no estaba. */
  minP: number | null
  /** `--repeat-penalty` (sampling). null si no estaba. */
  repeatPenalty: number | null
  /** `--model` / `-m` (ruta local al .gguf). null si no estaba. */
  modelFile: string | null
  /** `--n-cpu-moe` (capas cuyos expertos MoE van a CPU). 0 si no estaba. */
  nCpuMoe: number
  /** `--cache-reuse` (tokens reutilizables del cache). 0 si no estaba. */
  cacheReuse: number
  /** `--no-mmproj` presente. */
  noMmproj: boolean
  /** `--spec-draft-n-max` (número de drafts para MTP/speculative). null si no estaba. */
  specDraftNMax: number | null
  /** `--cache-ram` (presupuesto MiB que el KV cache puede derramar a RAM). null si no estaba. */
  cacheRam: number | null
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
   * Calificación del usuario (0-10). null = sin calificar.
   * Campo opcional para compatibilidad con entradas viejas del historial.
   */
  rating?: number | null
  /**
   * Marca de favorito (corazón) del usuario. false = no destacado.
   * Campo opcional para compatibilidad con entradas viejas del historial.
   */
  favorite?: boolean
  /** Errores encontrados durante el run. */
  errors: string[]
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Optimizador de parámetros (estimación heurística + dry-fit real)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parámetros afinables por el optimizador: los que impactan el consumo de VRAM
 * y/o el rendimiento. El diálogo los expone como sliders/selects y los aplica
 * al script al confirmar.
 */
export interface TunedParams {
  ctxSize: number
  ngl: number
  cacheTypeK: string
  cacheTypeV: string
  batchSize: number
  ubatchSize: number
  flashAttn: boolean
  /** Devices seleccionados (ids del backend, p.ej. "Vulkan0,Vulkan1"). Vacío = todos. */
  device: string[]
  /** Reparto entre devices (valor de --tensor-split, p.ej. "2,7"). null = automático. */
  tensorSplit: number[] | null
  /** --n-cpu-moe: capas de expertos MoE en CPU (offload de expertos). 0 = desactivado. */
  nCpuMoe: number
  /** --cache-reuse: tokens del cache anterior que se pueden reutilizar. 0 = desactivado. */
  cacheReuse: number
  /** --no-mmproj: si true, no carga el vision projector (ahorra VRAM del mmproj). */
  noMmproj: boolean
  /** --spec-draft-n-max: tokens draft por paso (speculative/MTP). 0 = desactivado. */
  specDraftMax: number
  /** --cache-ram: presupuesto máximo (MiB) que el KV cache puede derramar a RAM. */
  cacheRam: number
}

/** Desglose heurístico del consumo de VRAM de una configuración. */
export interface VramBreakdown {
  /** Consumo por device (en el orden de los devices seleccionados), en MiB. */
  perDeviceMiB: number[]
  /** Suma total estimada en MiB. */
  totalMiB: number
  /** MiB de pesos del modelo (params × bytes/quant). */
  weightsMiB: number
  /** MiB del KV cache (2 × capas × kvHeads × headDim × ctx × bytesKv). */
  kvMiB: number
  /** MiB de overhead (compute buffer, ~proporcional a ubatch). */
  overheadMiB: number
  /** True si el consumo total cabe en la VRAM libre disponible. */
  fits: boolean
}

/**
 * Respuesta de POST /estimate: devices disponibles + heurística instantánea +
 * recomendación automática de parámetros. No arranca el binario.
 */
export interface EstimateResponse {
  devices: LlamaDevice[]
  /** VRAM total libre de los devices seleccionados (suma). */
  totalFreeMiB: number
  /** Backend detectado (cuda/vulkan/…). */
  backend: GpuBackend
  /** Metadatos del modelo parseado (familia, params, quant, capas…). */
  modelMeta: ModelMeta
  /** Estimación heurística con los parámetros actuales del script. */
  heuristic: VramBreakdown
  /** Recomendación automática de parámetros que cabe en la VRAM libre. */
  recommendation: TunedParams
}

/**
 * Respuesta de POST /dryfit: VRAM consumida REAL al arrancar llama-server con
 * los parámetros indicados (sin enviar request de inferencia, solo cargando el
 * modelo + reservando el ctx). El servidor se detiene siempre al final.
 */
export interface DryfitResponse {
  /** Consumo real por device (delta de VRAM libre tras cargar el modelo). */
  perDevice: DeviceVram[]
  /** Suma del consumo real en MiB. null si no se pudo medir. */
  totalMiB: number | null
  /** Tiempo de carga del modelo en segundos. null si no se midió. */
  loadTimeSeconds: number | null
  /** True si el consumo real cabe en la VRAM libre. */
  fits: boolean
  /** Error si el arranque falló (OOM, modelo inválido, etc.). */
  error: string | null
}

/** Metadatos de un modelo deducidos del nombre (-hf / --hf-repo). */
export interface ModelMeta {
  /** Texto original (p.ej. "unsloth/Qwen3.6-27B-MTP-GGUF:Q4_K_S"). */
  raw: string
  /** Familia/base legible (p.ej. "Qwen3.6"). */
  base: string
  /** Cuantización (p.ej. "Q4_K_S"). null si no se deduce. */
  quant: string | null
  /** Bytes por parámetro según el quant. null si desconocido. */
  bytesPerParam: number | null
  /** Número de parámetros en miles de millones (p.ej. 27). null si no se deduce. */
  paramsB: number | null
  /** Número de capas (layers) totales. null si no se deduce de la familia. */
  layers: number | null
  /**
   * Número de capas que contribuyen al KV cache (de atención). En modelos
   * híbridos SSM/Attention (Qwen3.5/3.6, Jamba, Zamba, MiniMax, Nemotron-H,
   * Falcon-H1…) solo una fracción de las capas son de atención; el resto son
   * recurrentes (Mamba/SSM) con estado fijo que no escala con el contexto.
   * null = todas las capas son de atención (modelo denso normal, = layers).
   * Se deduce del header GGUF (attention.recurrent_layers o full_attention_interval).
   */
  attentionLayers: number | null
  /** Número de KV heads. null si no se deduce. */
  kvHeads: number | null
  /** Dimensión de head (head_dim). null si no se deduce. */
  headDim: number | null
  /** Tamaño real del .gguf en MiB (medido en disco). null si no se resolvió. */
  weightsFileMiB: number | null
  /** Ruta del archivo .gguf resuelto. null si no se encontró. */
  weightsFile: string | null
  /** Tamaño del mmproj (vision projector) en MiB. null si no hay o no se midió. */
  mmprojSizeMiB: number | null
}
