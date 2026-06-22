// Tipos compartidos entre backend y frontend.
// Se mantienen intencionalmente simples (sin dependencias externas).

/** Parámetros que el usuario puede editar en la UI. Reflejan un subconjunto de flags de llama-server. */
export interface ServerConfig {
  /** Ruta o nombre del binario llama-server (p.ej. "./llama-server"). */
  binary: string;
  /** Modelo HF repo/file. p.ej. "unsloth/Qwen3.6-35B-A3B-MTP-GGUF:UD-Q4_K_XL". */
  model: string;
  /** --ctx-size */
  ctxSize: number;
  /** --batch-size */
  batchSize: number;
  /** --ubatch-size */
  ubatchSize: number;
  /** --tensor-split (string "2,7"). Vacío = no usar el flag. */
  tensorSplit: string;
  /** --device (p.ej. "Vulkan0,Vulkan1"). */
  device: string;
  /** --n-gpu-layers */
  nGpuLayers: number;
  /** --cache-type-k (f16 | q8_0 | q4_0). */
  cacheTypeK: string;
  /** --cache-type-v (f16 | q8_0 | q4_0). */
  cacheTypeV: string;
  /** --flash-attn (on | off). */
  flashAttn: string;
  /** --no-mmap */
  noMmap: boolean;
  /** --jinja */
  jinja: boolean;
  /** --no-mmproj */
  noMmproj: boolean;
  /** Temperatura de muestreo (para el benchmark; se pasa a la API, no a --temp). */
  temp: number;
  /** top-p (API). */
  topP: number;
  /** top-k (API). */
  topK: number;
  /** --spec-type (draft-mtp | ...). Vacío = no usar el flag. */
  specType: string;
  /** --spec-draft-n-max */
  specDraftNMax: number;
  /** --metrics */
  metrics: boolean;
  /** --log-prefix */
  logPrefix: boolean;
  /** --cache-reuse */
  cacheReuse: number;
  /** Host/port donde escuchará llama-server (lo lanza el backend). */
  host: string;
  /** Puerto del servidor llama.cpp interno. */
  port: number;
}

/** Estado del proceso llama-server gestionado por el backend. */
export type ServerStatus = "stopped" | "starting" | "running" | "error";

/** Respuesta de GET /status. */
export interface StatusResponse {
  status: ServerStatus;
  /** PID del proceso si está corriendo. */
  pid: number | null;
  /** Timestamp ISO de inicio. */
  startedAt: string | null;
  /** URL base de llama-server cuando está corriendo. */
  url: string | null;
  /** Mensaje de error si lo hubiera. */
  error: string | null;
}

/** Línea de log del proceso. */
export interface LogEntry {
  /** Monotónico (ms) desde arranque del backend, para ordenar. */
  t: number;
  /** 'stdout' | 'stderr' | 'system'. */
  stream: "stdout" | "stderr" | "system";
  msg: string;
}

/** Respuesta de GET /logs. */
export interface LogsResponse {
  entries: LogEntry[];
  /** Índice de la última línea incluida, para polling incremental. */
  cursor: number;
}

/** Métricas de una GPU. */
export interface GpuInfo {
  /** Índice/identificador (p.ej. "nvidia0", "amdgpu-card0"). */
  index: string;
  /** Marca. */
  vendor: "nvidia" | "amd";
  /** VRAM usada en MiB. */
  memUsedMiB: number | null;
  /** VRAM total en MiB. */
  memTotalMiB: number | null;
  /** % utilización del GPU. */
  gpuUtilPct: number | null;
}

/** Resultado completo de un benchmark. */
export interface BenchmarkResult {
  /** ID único. */
  id: string;
  /** Timestamp ISO. */
  timestamp: string;
  /** Configuración usada (snapshot). */
  config: ServerConfig;
  /** Tokens por segundo en prompt eval (TG inverso). */
  promptTokensPerSecond: number | null;
  /** Tokens por segundo en generación. */
  generationTokensPerSecond: number | null;
  /** Aceptación del draft (speculative / MTP). */
  draftAcceptance: number | null;
  /** Tiempo de carga del modelo en segundos. */
  loadTimeSeconds: number | null;
  /** Latencia total del request de benchmark en ms. */
  requestLatencyMs: number | null;
  /** Prompt usado. */
  prompt: string;
  /** Respuesta generada (truncada). */
  response: string;
  /** Métricas de GPUs. */
  gpus: GpuInfo[];
  /** Errores encontrados durante el run. */
  errors: string[];
}
