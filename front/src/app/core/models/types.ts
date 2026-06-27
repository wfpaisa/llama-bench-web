// Modelos compartidos con el backend (src/types.ts del proyecto original).
// Espejo fiel de las interfaces para tipar las respuestas HTTP desde Angular.

/**
 * Script de llama-server ya parseado: texto crudo + tokens + escalares extraídos.
 * Un escalar `null` significa "el flag no estaba en el script".
 */
export interface ParsedScript {
  /** Script crudo tal como se edita (con continuaciones `\` y newlines). */
  script: string;
  /** Ruta/nombre del binario (primer token del script). */
  binary: string;
  /** Argumentos tokenizados (sin el binario). */
  argv: string[];

  model: string | null;
  host: string;
  port: number;
  ctxSize: number | null;
  batchSize: number | null;
  ubatchSize: number | null;
  cacheTypeK: string | null;
  cacheTypeV: string | null;
  device: string | null;
  tensorSplit: string | null;
  temp: number | null;
  topP: number | null;
  topK: number | null;
}

/** Estado del proceso llama-server gestionado por el backend. */
export type ServerStatus = 'stopped' | 'starting' | 'running' | 'error';

/** Respuesta de GET /status. */
export interface StatusResponse {
  status: ServerStatus;
  pid: number | null;
  startedAt: string | null;
  url: string | null;
  error: string | null;
}

/** Línea de log del proceso. */
export interface LogEntry {
  /** Monotónico (ms) desde arranque del backend, para ordenar. */
  t: number;
  /** 'stdout' | 'stderr' | 'system'. */
  stream: 'stdout' | 'stderr' | 'system';
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
  index: string;
  vendor: 'nvidia' | 'amd';
  memUsedMiB: number | null;
  memTotalMiB: number | null;
  gpuUtilPct: number | null;
}

/** Backend de cómputo del binario de llama-server (deducido de --list-devices). */
export type GpuBackend =
  | 'cuda'
  | 'vulkan'
  | 'sycl'
  | 'metal'
  | 'opencl'
  | 'cann'
  | 'cpu'
  | 'unknown';

/**
 * Device reportado por `llama-server --list-devices`: id del BACKEND (CUDA0,
 * Vulkan0, …). A diferencia de GpuInfo, cubre todos los vendors del binario.
 */
export interface LlamaDevice {
  /** Id del backend (p.ej. "CUDA0", "Vulkan0"). */
  id: string;
  /** Nombre legible (p.ej. "NVIDIA GeForce RTX 5070 Ti"). */
  name: string;
  /** Marca deducida del nombre. */
  vendor: 'nvidia' | 'amd' | 'intel' | 'unknown';
  /** VRAM total en MiB. */
  totalMiB: number;
  /** VRAM libre en MiB. */
  freeMiB: number;
}

/**
 * VRAM consumida por el modelo en un device del backend: device + delta de VRAM
 * libre (antes − después de cargar el modelo). `usedMiB` null si no se pudo medir.
 */
export interface DeviceVram {
  device: LlamaDevice;
  usedMiB: number | null;
}

/** Métricas de RAM del sistema (Linux, /proc/meminfo). null si no disponible. */
export interface RamInfo {
  memTotalMiB: number | null;
  memUsedMiB: number | null;
  memAvailableMiB: number | null;
}

/** Resultado completo de un benchmark. */
export interface BenchmarkResult {
  id: string;
  timestamp: string;
  config: ParsedScript;
  promptTokensPerSecond: number | null;
  promptTokenCount: number | null;
  promptEvalTimeMs: number | null;
  generationTokensPerSecond: number | null;
  generationTokenCount: number | null;
  draftAcceptance: number | null;
  genDrafts: number | null;
  accDrafts: number | null;
  genTokens: number | null;
  accTokens: number | null;
  loadTimeSeconds: number | null;
  generationTimeMs: number | null;
  requestLatencyMs: number | null;
  prompt: string;
  response: string;
  gpus: GpuInfo[];
  /** Backend de cómputo del binario (cuda/vulkan/…). null si no se detectó. */
  backend: GpuBackend | null;
  /**
   * VRAM por device del backend (delta consumido por el modelo), filtrado por
   * `--device`. Vacío en entradas viejas o si --list-devices falló; el render
   * cae a `gpus` (legacy nvidia-smi/sysfs).
   */
  deviceVram: DeviceVram[];
  /** RAM usada por el benchmark (delta MemUsed durante el run) en MiB. null si no disponible. */
  ramUsedMiB: number | null;
  errors: string[];
}

/** Respuestas de los endpoints JSON { ok, error?, ... }. */
export interface OkResponse {
  ok: boolean;
  error?: string;
}
export interface StartResponse extends OkResponse {
  pid?: number;
}
export interface BenchmarkResponse extends OkResponse {
  result?: BenchmarkResult;
}
