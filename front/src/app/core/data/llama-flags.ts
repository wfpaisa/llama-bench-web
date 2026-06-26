// Catálogo estático de flags de `llama-server`, extraído del `--help` oficial.
// Fuente de datos de la tabla de flags del editor de script. Cada entrada:
// nombre legible, flag larga (forma canónica), flag corta (si existe), aliases
// extra, valor por defecto (tal cual lo muestra el help), descripción en español
// y categoría (para el filtro). Las descripciones explican para qué sirve, qué
// mejora y qué efecto tiene sobre el servidor / el rendimiento.

/** Categorías de flags (para el filtro por grupo). */
export type FlagCategory = 'común' | 'muestreo' | 'especulativo' | 'servidor'

/** Una entrada del catálogo de flags. */
export interface LlamaFlag {
  /** Nombre legible (etiqueta mostrada en la lista). */
  name: string
  /** Flag larga canónica, p.ej. `--ctx-size`. */
  long: string
  /** Flag corta, p.ej. `-c`. `null` si no existe forma corta. */
  short: string | null
  /** Formas adicionales aceptadas (largas o cortas) para detección de duplicados. */
  aliases?: string[]
  /** Valor por defecto mostrado (string para uniformidad). `null` si es un switch. */
  defaultValue: string | null
  /** Descripción larga en español: para qué sirve, qué mejora, qué efecto tiene. */
  description: string
  /** Categoría para el filtro. */
  category: FlagCategory
}

/**
 * Catálogo completo de flags de `llama-server`, agrupado por categoría.
 * Ordenado dentro de cada grupo de lo más usado a lo más específico.
 */
export const LLAMA_FLAGS: LlamaFlag[] = [
  // ════════════════════ PARÁMETROS COMUNES ════════════════════
  {
    name: 'Modelo (archivo local)',
    long: '--model',
    short: '-m',
    defaultValue: null,
    category: 'común',
    description:
      'Ruta al archivo de modelo GGUF en disco a cargar en memoria. Es la forma tradicional de cargar modelos locales, alternativa a --hf-repo.',
  },
  {
    name: 'Modelo (Hugging Face)',
    long: '--hf-repo',
    short: '-hf',
    aliases: ['-hfr'],
    defaultValue: null,
    category: 'común',
    description:
      'Repositorio de Hugging Face del que descargar/usar el modelo (se cachea en ~/.cache/huggingface). Acepta sufijo de cuantización (p.ej. :Q4_K_M). Descarga el mmproj automáticamente si existe (usa --no-mmproj para evitarlo).',
  },
  {
    name: 'Archivo HF (override)',
    long: '--hf-file',
    short: '-hff',
    defaultValue: null,
    category: 'común',
    description:
      'Archivo concreto del repositorio de Hugging Face. Si se indica, sobreescribe la cuantización elegida en --hf-repo.',
  },
  {
    name: 'Token de Hugging Face',
    long: '--hf-token',
    short: '-hft',
    defaultValue: null,
    category: 'común',
    description:
      'Token de acceso de Hugging Face para repositorios privados o con rate-limit. Por defecto toma el valor de la variable de entorno HF_TOKEN.',
  },
  {
    name: 'Repositorio Docker',
    long: '--docker-repo',
    short: '-dr',
    defaultValue: null,
    category: 'común',
    description:
      'Repositorio de Docker Hub con el modelo (formato [repo/]modelo[:quant], default ai/:latest). Alternativa a --hf-repo/--model.',
  },
  {
    name: 'URL de descarga del modelo',
    long: '--model-url',
    short: '-mu',
    defaultValue: null,
    category: 'común',
    description: 'URL directa desde la que descargar el modelo (en vez de ruta local).',
  },
  {
    name: 'Capas en GPU',
    long: '--n-gpu-layers',
    short: '-ngl',
    aliases: ['--gpu-layers'],
    defaultValue: 'auto',
    category: 'común',
    description:
      'Cantidad de capas del modelo que se descargan a la VRAM. Puede ser un número exacto, "auto" o "all". Subir este valor mejora drásticamente la velocidad de inferencia (la GPU es mucho más rápida que la CPU) pero consume más VRAM.',
  },
  {
    name: 'Tamaño de contexto',
    long: '--ctx-size',
    short: '-c',
    defaultValue: '0',
    category: 'común',
    description:
      'Cantidad máxima de tokens del contexto (prompt + generación). 0 = tomado del modelo. Más contexto permite conversaciones/RAG más largos pero consume VRAM proporcionalmente (cache KV).',
  },
  {
    name: 'Tokens a predecir',
    long: '--n-predict',
    short: '-n',
    aliases: ['--predict'],
    defaultValue: '-1',
    category: 'común',
    description:
      'Número de tokens a generar en la respuesta. -1 = infinito (hasta EOS o límite de contexto). Útil para acotar la longitud máxima de salida.',
  },
  {
    name: 'Tamaño de batch lógico',
    long: '--batch-size',
    short: '-b',
    defaultValue: '2048',
    category: 'común',
    description:
      'Máximo tamaño de batch lógico para el procesamiento del prompt (prompt eval). Valores más grandes aceleran el procesamiento de prompts largos pero usan más memoria temporal.',
  },
  {
    name: 'Tamaño de ubatch físico',
    long: '--ubatch-size',
    short: '-ub',
    defaultValue: '512',
    category: 'común',
    description:
      'Máximo tamaño de batch físico enviado al backend de compute durante el prompt eval. Suele alinearse con -b o ser menor. Aumentar mejora el throughput del prompt eval si hay VRAM de sobra.',
  },
  {
    name: 'Tokens a conservar',
    long: '--keep',
    short: null,
    defaultValue: '0',
    category: 'común',
    description:
      'Cantidad de tokens del prompt inicial que se conservan al hacer context-shift. 0 = ninguno, -1 = todos. Útil para preservar el system prompt en conversaciones largas.',
  },
  {
    name: 'Threads (generación)',
    long: '--threads',
    short: '-t',
    defaultValue: '-1',
    category: 'común',
    description:
      'Número de threads de CPU usados durante la generación. -1 = automático. Ideal = cantidad de núcleos físicos; excederlo suele bajar el rendimiento.',
  },
  {
    name: 'Threads (batch)',
    long: '--threads-batch',
    short: '-tb',
    defaultValue: 'igual que --threads',
    category: 'común',
    description:
      'Número de threads de CPU usados durante el procesamiento de batch y prompt. Puede diferir de --threads porque el batch tiene más paralelismo disponible.',
  },
  {
    name: 'Threads HTTP',
    long: '--threads-http',
    short: null,
    defaultValue: '-1',
    category: 'común',
    description: 'Número de threads dedicados a procesar las peticiones HTTP entrantes (-1 = automático).',
  },
  {
    name: 'Flash Attention',
    long: '--flash-attn',
    short: '-fa',
    defaultValue: 'auto',
    category: 'común',
    description:
      'Controla Flash Attention (on/off/auto). Mejora la velocidad y reduce el consumo de memoria de la atención, especialmente con contextos grandes. Muy recomendado cuando la GPU lo soporta.',
  },
  {
    name: 'Cache SWA completa',
    long: '--swa-full',
    short: null,
    defaultValue: 'false',
    category: 'común',
    description:
      'Usa una cache Sliding Window Attention de tamaño completo (en vez de la parcial). Aumenta el consumo de VRAM pero evita recomputar la ventana deslizante.',
  },
  {
    name: 'Métricas de rendimiento',
    long: '--perf',
    short: null,
    aliases: ['--no-perf'],
    defaultValue: 'false',
    category: 'común',
    description:
      'Habilita (o --no-perf deshabilita) los timings internos de libllama. Las métricas que parsea este proyecto provienen de esa salida de rendimiento.',
  },
  {
    name: 'Procesar escapes',
    long: '--escape',
    short: '-e',
    aliases: ['--no-escape'],
    defaultValue: 'true',
    category: 'común',
    description:
      'Si se procesan secuencias de escape (\\n, \\r, \\t, \\\', \\", \\\\) en los prompts. --no-escape los trata literalmente.',
  },
  {
    name: 'Tipo de cache K',
    long: '--cache-type-k',
    short: '-ctk',
    defaultValue: 'f16',
    category: 'común',
    description:
      'Tipo de dato de la cache de claves (key). f16 es por defecto y de mayor calidad. Valores: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1. Cuantizar reduce el consumo de VRAM con pérdida leve de calidad.',
  },
  {
    name: 'Tipo de cache V',
    long: '--cache-type-v',
    short: '-ctv',
    defaultValue: 'f16',
    category: 'común',
    description:
      'Tipo de dato de la cache de valores (value). Mismas opciones que -ctk. Cuantizar V suele perjudar más la calidad que K; combinar -ctk q8_0 -ctv q8_0 es un buen balance VRAM/calidad.',
  },
  {
    name: 'Offload de cache KV',
    long: '--kv-offload',
    short: '-kvo',
    aliases: ['--no-kv-offload', '-nkvo'],
    defaultValue: 'enabled',
    category: 'común',
    description:
      'Habilita el offload de la cache KV a la GPU (--no-kv-offload lo desactiva). Mantenerlo activo mejora la velocidad; desactivarlo libera VRAM a costa de latency.',
  },
  {
    name: 'Umbral de defragmentación KV',
    long: '--defrag-thold',
    short: '-dt',
    defaultValue: null,
    category: 'común',
    description: '[DEPRECATED] Umbral de defragmentación de la cache KV. Mantenido por compatibilidad.',
  },
  {
    name: 'RoPE scaling',
    long: '--rope-scaling',
    short: null,
    defaultValue: 'linear',
    category: 'común',
    description:
      'Método de escalado de RoPE: none, linear o yarn. Permite extender el contexto más allá del entrenamiento del modelo. yarn (Yet another RoPE extensioN) es común para contextos muy largos.',
  },
  {
    name: 'Factor RoPE scale',
    long: '--rope-scale',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Factor de escalado de contexto RoPE: expande el contexto en un factor N.',
  },
  {
    name: 'Frecuencia base RoPE',
    long: '--rope-freq-base',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Frecuencia base de RoPE, usada por el escalado NTK-aware. Por defecto se lee del modelo.',
  },
  {
    name: 'Factor de escala RoPE',
    long: '--rope-freq-scale',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Factor de escala de frecuencia RoPE: expande el contexto en un factor 1/N.',
  },
  {
    name: 'YaRN ctx original',
    long: '--yarn-orig-ctx',
    short: null,
    defaultValue: '0',
    category: 'común',
    description: 'YaRN: tamaño de contexto original del modelo (0 = contexto de entrenamiento).',
  },
  {
    name: 'YaRN factor extrapolación',
    long: '--yarn-ext-factor',
    short: null,
    defaultValue: '-1.00',
    category: 'común',
    description: 'YaRN: factor de mezcla de extrapolación (0.0 = interpolación completa).',
  },
  {
    name: 'YaRN factor atención',
    long: '--yarn-attn-factor',
    short: null,
    defaultValue: '-1.00',
    category: 'común',
    description: 'YaRN: escala de la magnitud de atención sqrt(t).',
  },
  {
    name: 'Dispositivo(s)',
    long: '--device',
    short: '-dev',
    defaultValue: null,
    category: 'común',
    description:
      'Lista de dispositivos (separados por coma) para offload, p.ej. CUDA0,Vulkan0. none = no hacer offload. Usa --list-devices para ver los disponibles.',
  },
  {
    name: 'Listar dispositivos',
    long: '--list-devices',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Imprime la lista de dispositivos disponibles y termina.',
  },
  {
    name: 'Modo de split',
    long: '--split-mode',
    short: '-sm',
    defaultValue: 'layer',
    category: 'común',
    description:
      'Cómo dividir el modelo entre varias GPUs: none (una GPU), layer (por capas, default), row (por filas, paralelo) o tensor (experimental). layer suele dar el mejor balance para multi-GPU.',
  },
  {
    name: 'Split de tensores',
    long: '--tensor-split',
    short: '-ts',
    defaultValue: null,
    category: 'común',
    description:
      'Fracción del modelo que se reparte entre GPUs, lista separada por coma (p.ej. 3,1 = 75%/25%). Útil para distribuir un modelo grande entre GPUs de distinto tamaño.',
  },
  {
    name: 'GPU principal',
    long: '--main-gpu',
    short: '-mg',
    defaultValue: '0',
    category: 'común',
    description:
      'GPU usada para el modelo (con split-mode=none) o para resultados intermedios y KV (con split-mode=row).',
  },
  {
    name: 'MoE en CPU',
    long: '--cpu-moe',
    short: '-cmoe',
    defaultValue: null,
    category: 'común',
    description: 'Mantiene todos los pesos de Mixture of Experts (MoE) en la CPU en vez de la GPU.',
  },
  {
    name: 'N capas MoE en CPU',
    long: '--n-cpu-moe',
    short: '-ncmoe',
    defaultValue: null,
    category: 'común',
    description: 'Mantiene los pesos MoE de las primeras N capas en la CPU (offload parcial).',
  },
  {
    name: 'Override de tensor',
    long: '--override-tensor',
    short: '-ot',
    defaultValue: null,
    category: 'común',
    description: 'Sobreescribe el tipo de buffer de un tensor por patrón (formato patron=buffer,...).',
  },
  {
    name: 'Ajustar a memoria (fit)',
    long: '--fit',
    short: '-fit',
    defaultValue: 'on',
    category: 'común',
    description:
      'Ajusta argumentos sin definir (p.ej. ctx-size) para que el modelo quepa en la memoria del dispositivo (on/off).',
  },
  {
    name: 'Margen objetivo fit',
    long: '--fit-target',
    short: '-fitt',
    defaultValue: '1024',
    category: 'común',
    description: 'Margen objetivo por dispositivo (MiB) para --fit. Valor único se aplica a todos.',
  },
  {
    name: 'ctx mínimo del fit',
    long: '--fit-ctx',
    short: '-fitc',
    defaultValue: '4096',
    category: 'común',
    description: 'Tamaño mínimo de ctx que --fit puede asignar.',
  },
  {
    name: 'Verificar tensores',
    long: '--check-tensors',
    short: null,
    defaultValue: 'false',
    category: 'común',
    description: 'Comprueba los datos de los tensores del modelo en busca de valores inválidos.',
  },
  {
    name: 'Override de metadatos',
    long: '--override-kv',
    short: null,
    defaultValue: null,
    category: 'común',
    description:
      'Sobreescribe metadatos del modelo por clave (KEY=TYPE:VALUE,...). Tipos: int, float, bool, str.',
  },
  {
    name: 'Offload de ops host',
    long: '--op-offload',
    short: null,
    aliases: ['--no-op-offload'],
    defaultValue: 'true',
    category: 'común',
    description: 'Si las operaciones de tensor en host se descargan al dispositivo (default true).',
  },
  {
    name: 'mmap (memoria mapeada)',
    long: '--mmap',
    short: null,
    aliases: ['--no-mmap'],
    defaultValue: 'enabled',
    category: 'común',
    description:
      'Si se mapea el modelo en memoria (mmap). mmap reduce el uso de RAM y acelera el arranque; --no-mmap puede mejorar la latencia cuando sobra RAM.',
  },
  {
    name: 'mlock (bloquear en RAM)',
    long: '--mlock',
    short: null,
    defaultValue: 'false',
    category: 'común',
    description:
      'Bloquea el modelo en RAM evitando swap (mejora la consistencia de latencia). Requiere permisos (RLIMIT_MEMLOCK / CAP_IPC_LOCK).',
  },
  {
    name: 'Direct I/O',
    long: '--direct-io',
    short: '-dio',
    aliases: ['--no-direct-io', '-ndio'],
    defaultValue: 'disabled',
    category: 'común',
    description: 'Usa DirectIO si está disponible (elude la page cache del SO al cargar).',
  },
  {
    name: 'Optimización NUMA',
    long: '--numa',
    short: null,
    defaultValue: null,
    category: 'común',
    description:
      'Optimizaciones para sistemas NUMA: distribute (reparto uniforme), isolate (solo nodo local) o numactl (mapa de numactl). Recomendado vaciar la page cache antes de usarlo.',
  },
  {
    name: 'LoRA',
    long: '--lora',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Ruta a un adaptador LoRA (separar por coma para cargar varios).',
  },
  {
    name: 'LoRA con escala',
    long: '--lora-scaled',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Adaptador LoRA con escala definida por el usuario (formato FNAME:SCALE,...).',
  },
  {
    name: 'Vector de control',
    long: '--control-vector',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Añade un vector de control (separar por coma para varios).',
  },
  {
    name: 'Vector de control escalado',
    long: '--control-vector-scaled',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Vector de control con escala (formato FNAME:SCALE,...).',
  },
  {
    name: 'Rango de capas vector control',
    long: '--control-vector-layer-range',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Rango de capas al que aplicar los vectores de control (START END, inclusivo).',
  },
  {
    name: 'Máscara CPU',
    long: '--cpu-mask',
    short: '-C',
    defaultValue: '""',
    category: 'común',
    description: 'Máscara de afinidad de CPU en hex (arbitrariamente larga). Complementa --cpu-range.',
  },
  {
    name: 'Rango de CPU',
    long: '--cpu-range',
    short: '-Cr',
    defaultValue: null,
    category: 'común',
    description: 'Rango de CPUs para afinidad (formato lo-hi). Complementa --cpu-mask.',
  },
  {
    name: 'CPU estricto',
    long: '--cpu-strict',
    short: null,
    defaultValue: '0',
    category: 'común',
    description: 'Usa placement estricto de CPU (0|1).',
  },
  {
    name: 'Prioridad proceso',
    long: '--prio',
    short: null,
    defaultValue: '0',
    category: 'común',
    description: 'Prioridad del proceso/thread: low(-1), normal(0), medium(1), high(2), realtime(3).',
  },
  {
    name: 'Polling',
    long: '--poll',
    short: null,
    defaultValue: '50',
    category: 'común',
    description: 'Nivel de polling para esperar trabajo (0 = sin polling, 0-100).',
  },
  {
    name: 'Repack de pesos',
    long: '--repack',
    short: null,
    aliases: ['--no-repack', '-nr'],
    defaultValue: 'enabled',
    category: 'común',
    description: 'Habilita (o --no-repack deshabilita) el repacking de pesos durante la carga.',
  },
  {
    name: 'Sin buffer host',
    long: '--no-host',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Omite el buffer host permitiendo usar buffers extra.',
  },
  {
    name: 'Cache K del draft',
    long: '--cache-type-k-draft',
    short: '-ctkd',
    aliases: ['--spec-draft-type-k'],
    defaultValue: 'f16',
    category: 'común',
    description: 'Tipo de dato de cache K para el modelo borrador (mismos valores que -ctk).',
  },
  {
    name: 'Cache V del draft',
    long: '--cache-type-v-draft',
    short: '-ctvd',
    aliases: ['--spec-draft-type-v'],
    defaultValue: 'f16',
    category: 'común',
    description: 'Tipo de dato de cache V para el modelo borrador (mismos valores que -ctv).',
  },
  {
    name: 'Verbose (logging)',
    long: '--verbose',
    short: '-v',
    aliases: ['--log-verbose'],
    defaultValue: null,
    category: 'común',
    description:
      'Sube el nivel de verbosity al máximo (log de todos los mensajes, útil para depurar). Las métricas que parsea este proyecto salen del output verbose.',
  },
  {
    name: 'Umbral de verbosity',
    long: '--verbosity',
    short: '-lv',
    aliases: ['--log-verbosity'],
    defaultValue: '3',
    category: 'común',
    description:
      'Umbral de verbosity (0 genérico, 1 error, 2 warning, 3 info, 4 trace, 5 debug). Se ignoran los mensajes de verbosity mayor.',
  },
  {
    name: 'Log a archivo',
    long: '--log-file',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Redirige el log a un archivo en vez de a stdout.',
  },
  {
    name: 'Log con colores',
    long: '--log-colors',
    short: null,
    defaultValue: 'auto',
    category: 'común',
    description: 'Logging coloreado (on/off/auto). "auto" lo activa si la salida es una terminal.',
  },
  {
    name: 'Prefijo de log',
    long: '--log-prefix',
    short: null,
    aliases: ['--no-log-prefix'],
    defaultValue: null,
    category: 'común',
    description: 'Habilita (o --no-log-prefix deshabilita) el prefijo en los mensajes de log.',
  },
  {
    name: 'Timestamps de log',
    long: '--log-timestamps',
    short: null,
    aliases: ['--no-log-timestamps'],
    defaultValue: null,
    category: 'común',
    description: 'Habilita (o deshabilita) las marcas de tiempo en los mensajes de log.',
  },
  {
    name: 'Deshabilitar log',
    long: '--log-disable',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Deshabilita el logging por completo.',
  },
  {
    name: 'Modo offline',
    long: '--offline',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Modo offline: fuerza el uso de caché e impide el acceso a la red.',
  },
  {
    name: 'Versión',
    long: '--version',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Muestra la versión e info de build y termina.',
  },
  {
    name: 'Ayuda',
    long: '--help',
    short: '-h',
    aliases: ['--usage'],
    defaultValue: null,
    category: 'común',
    description: 'Imprime el uso y termina.',
  },
  {
    name: 'Completado bash',
    long: '--completion-bash',
    short: null,
    defaultValue: null,
    category: 'común',
    description: 'Imprime un script de completado bash cargable para llama.cpp.',
  },
  {
    name: 'Listar cache',
    long: '--cache-list',
    short: '-cl',
    defaultValue: null,
    category: 'común',
    description: 'Muestra la lista de modelos en caché y termina.',
  },

  // ════════════════════ PARÁMETROS DE MUESTREO ════════════════════
  {
    name: 'Temperatura',
    long: '--temperature',
    short: null,
    aliases: ['--temp'],
    defaultValue: '0.80',
    category: 'muestreo',
    description:
      'Temperatura de muestreo. Valores altos = respuestas más creativas/aleatorias; valores bajos = más deterministas y enfocadas. Típico: 0.6-0.9.',
  },
  {
    name: 'top-k',
    long: '--top-k',
    short: null,
    defaultValue: '40',
    category: 'muestreo',
    description: 'Muestreo top-k: considera solo los K tokens más probables (0 = deshabilitado).',
  },
  {
    name: 'top-p (nucleus)',
    long: '--top-p',
    short: null,
    defaultValue: '0.95',
    category: 'muestreo',
    description:
      'Muestreo nucleus: selecciona el conjunto mínimo de tokens cuya probabilidad acumulada supera p (1.0 = deshabilitado).',
  },
  {
    name: 'min-p',
    long: '--min-p',
    short: null,
    defaultValue: '0.05',
    category: 'muestreo',
    description: 'Descarta tokens con probabilidad menor a min-p · (prob del token más probable) (0.0 = off).',
  },
  {
    name: 'top-n-sigma',
    long: '--top-n-sigma',
    short: null,
    aliases: ['--top-nsigma'],
    defaultValue: '-1.00',
    category: 'muestreo',
    description: 'Muestreo top-n-sigma: corta los tokens por debajo de n desviaciones estándar (-1 = off).',
  },
  {
    name: 'Typical-p',
    long: '--typical-p',
    short: null,
    aliases: ['--typical'],
    defaultValue: '1.00',
    category: 'muestreo',
    description: 'Muestreo localmente típico (parámetro p). 1.0 = deshabilitado.',
  },
  {
    name: 'XTC probabilidad',
    long: '--xtc-probability',
    short: null,
    defaultValue: '0.00',
    category: 'muestreo',
    description: 'Probabilidad de XTC (eXclude Top Choices), que descarta el token más probable (0.0 = off).',
  },
  {
    name: 'XTC umbral',
    long: '--xtc-threshold',
    short: null,
    defaultValue: '0.10',
    category: 'muestreo',
    description: 'Umbral de XTC: solo aplica XTC si el token top supera esta probabilidad (1.0 = off).',
  },
  {
    name: 'Semilla (seed)',
    long: '--seed',
    short: '-s',
    defaultValue: '-1',
    category: 'muestreo',
    description: 'Semilla del generador aleatorio. -1 = semilla aleatoria. Fijar la semilla hace la salida reproducible.',
  },
  {
    name: 'Secuencia de samplers',
    long: '--samplers',
    short: null,
    defaultValue: 'penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature',
    category: 'muestreo',
    description: 'Orden (separado por ;) de los samplers aplicados durante la generación.',
  },
  {
    name: 'Seq simplificada',
    long: '--sampling-seq',
    short: null,
    aliases: ['--sampler-seq'],
    defaultValue: 'edskypmxt',
    category: 'muestreo',
    description: 'Secuencia simplificada de samplers (una letra por sampler).',
  },
  {
    name: 'Penalización repetición',
    long: '--repeat-penalty',
    short: null,
    defaultValue: '1.00',
    category: 'muestreo',
    description:
      'Penaliza secuencias repetidas de tokens. >1 reduce repeticiones. 1.0 = deshabilitado. Típico: 1.1-1.3.',
  },
  {
    name: 'Ventana de repetición',
    long: '--repeat-last-n',
    short: null,
    defaultValue: '64',
    category: 'muestreo',
    description: 'Últimos N tokens considerados para penalizar repeticiones (0 = off, -1 = ctx completo).',
  },
  {
    name: 'Presence penalty',
    long: '--presence-penalty',
    short: null,
    defaultValue: '0.00',
    category: 'muestreo',
    description: 'Penalización de presencia (alpha): fomenta hablar de temas nuevos. 0.0 = deshabilitado.',
  },
  {
    name: 'Frequency penalty',
    long: '--frequency-penalty',
    short: null,
    defaultValue: '0.00',
    category: 'muestreo',
    description: 'Penalización de frecuencia (alpha): fomenta no repetir las mismas palabras. 0.0 = deshabilitado.',
  },
  {
    name: 'DRY multiplicador',
    long: '--dry-multiplier',
    short: null,
    defaultValue: '0.00',
    category: 'muestreo',
    description: 'Multiplicador del sampler DRY (anti-repetición suave). 0.0 = deshabilitado.',
  },
  {
    name: 'DRY base',
    long: '--dry-base',
    short: null,
    defaultValue: '1.75',
    category: 'muestreo',
    description: 'Valor base del sampler DRY.',
  },
  {
    name: 'DRY longitud permitida',
    long: '--dry-allowed-length',
    short: null,
    defaultValue: '2',
    category: 'muestreo',
    description: 'Longitud permitida para el sampler DRY antes de penalizar.',
  },
  {
    name: 'DRY penalización N',
    long: '--dry-penalty-last-n',
    short: null,
    defaultValue: '-1',
    category: 'muestreo',
    description: 'Penalización DRY sobre los últimos N tokens (0 = off, -1 = contexto completo).',
  },
  {
    name: 'DRY sequence breaker',
    long: '--dry-sequence-breaker',
    short: null,
    defaultValue: null,
    category: 'muestreo',
    description:
      'Añade un sequence breaker para DRY (limpia los defaults \\n, :, ", *). Usa "none" para ninguno.',
  },
  {
    name: 'adaptive-p objetivo',
    long: '--adaptive-target',
    short: null,
    defaultValue: '-1.00',
    category: 'muestreo',
    description: 'adaptive-p: selecciona tokens cercanos a esta probabilidad (negativo = deshabilitado).',
  },
  {
    name: 'adaptive-p decaimiento',
    long: '--adaptive-decay',
    short: null,
    defaultValue: '0.90',
    category: 'muestreo',
    description: 'adaptive-p: tasa de decaimiento de la adaptación del objetivo (0.0-0.99).',
  },
  {
    name: 'Rango temp dinámica',
    long: '--dynatemp-range',
    short: null,
    defaultValue: '0.00',
    category: 'muestreo',
    description: 'Rango de temperatura dinámica (0.0 = deshabilitado).',
  },
  {
    name: 'Exponente temp dinámica',
    long: '--dynatemp-exp',
    short: null,
    defaultValue: '1.00',
    category: 'muestreo',
    description: 'Exponente de la temperatura dinámica.',
  },
  {
    name: 'Mirostat',
    long: '--mirostat',
    short: null,
    defaultValue: '0',
    category: 'muestreo',
    description: 'Muestreo Mirostat (0 = off, 1 = Mirostat, 2 = Mirostat 2.0). Ignora top-k/top-p/typical.',
  },
  {
    name: 'Mirostat lr',
    long: '--mirostat-lr',
    short: null,
    defaultValue: '0.10',
    category: 'muestreo',
    description: 'Tasa de aprendizaje de Mirostat (parámetro eta).',
  },
  {
    name: 'Mirostat entropía',
    long: '--mirostat-ent',
    short: null,
    defaultValue: '5.00',
    category: 'muestreo',
    description: 'Entropía objetivo de Mirostat (parámetro tau).',
  },
  {
    name: 'Sesgo de logit',
    long: '--logit-bias',
    short: '-l',
    defaultValue: null,
    category: 'muestreo',
    description:
      'Modifica la probabilidad de un token, p.ej. --logit-bias 15043+1 aumenta " Hello". Formato TOKEN_ID(+/-)BIAS.',
  },
  {
    name: 'Ignorar EOS',
    long: '--ignore-eos',
    short: null,
    defaultValue: null,
    category: 'muestreo',
    description: 'Ignora el token de fin de stream y sigue generando.',
  },
  {
    name: 'Gramática (BNF)',
    long: '--grammar',
    short: null,
    defaultValue: null,
    category: 'muestreo',
    description: 'Gramática tipo BNF que constriñe la generación (ver ejemplos en grammars/).',
  },
  {
    name: 'Archivo de gramática',
    long: '--grammar-file',
    short: null,
    defaultValue: null,
    category: 'muestreo',
    description: 'Archivo del que leer la gramática que constriñe la generación.',
  },
  {
    name: 'JSON Schema',
    long: '--json-schema',
    short: '-j',
    defaultValue: null,
    category: 'muestreo',
    description: 'JSON Schema que constriñe la generación a JSON válido (p.ej. {} para cualquier objeto).',
  },
  {
    name: 'Archivo JSON Schema',
    long: '--json-schema-file',
    short: '-jf',
    defaultValue: null,
    category: 'muestreo',
    description: 'Archivo con un JSON Schema que constriñe la generación.',
  },
  {
    name: 'Backend sampling',
    long: '--backend-sampling',
    short: '-bs',
    defaultValue: 'disabled',
    category: 'muestreo',
    description: 'Habilita el sampling en el backend (experimental).',

  },

  // ════════════════════ PARÁMETROS ESPECULATIVOS ════════════════════
  {
    name: 'Tipo de spec decoding',
    long: '--spec-type',
    short: null,
    defaultValue: 'none',
    category: 'especulativo',
    description:
      'Lista (separada por coma) de tipos de speculative decoding: none, draft-simple, draft-eagle3, draft-mtp, ngram-simple, ngram-map-k, ngram-map-k4v, ngram-mod, ngram-cache.',
  },
  {
    name: 'Modelo borrador',
    long: '--model-draft',
    short: '-md',
    aliases: ['--spec-draft-model'],
    defaultValue: null,
    category: 'especulativo',
    description:
      'Modelo borrador pequeño para speculative decoding. Propone tokens que el modelo grande verifica en lote; con buena tasa de aceptación aumenta mucho los tokens/seg de generación.',
  },
  {
    name: 'Borrador HF',
    long: '--hf-repo-draft',
    short: '-hfd',
    aliases: ['--spec-draft-hf', '-hfrd'],
    defaultValue: null,
    category: 'especulativo',
    description: 'Igual que --hf-repo pero para el modelo borrador de speculative decoding.',
  },
  {
    name: 'Tokens a generar (draft)',
    long: '--spec-draft-n-max',
    short: null,
    aliases: ['--draft-max', '--draft', '--draft-n'],
    defaultValue: '3',
    category: 'especulativo',
    description:
      'Número máximo de tokens que el borrador propone por paso. Valores más altos pueden aumentar la aceleración si la tasa de aceptación es alta, pero suben el coste por paso.',
  },
  {
    name: 'Tokens mín. (draft)',
    long: '--spec-draft-n-min',
    short: null,
    aliases: ['--draft-min', '--draft-n-min'],
    defaultValue: '0',
    category: 'especulativo',
    description: 'Número mínimo de tokens del borrador a usar en speculative decoding.',
  },
  {
    name: 'p mínima del draft',
    long: '--draft-p-min',
    short: null,
    aliases: ['--spec-draft-p-min'],
    defaultValue: '0.00',
    category: 'especulativo',
    description:
      'Probabilidad mínima aceptada (greedy) para seguir confiando en el borrador. Si un token cae por debajo, se detiene la propuesta.',
  },
  {
    name: 'Prob. split del draft',
    long: '--draft-p-split',
    short: null,
    aliases: ['--spec-draft-p-split'],
    defaultValue: '0.10',
    category: 'especulativo',
    description: 'Probabilidad de split para speculative decoding.',
  },
  {
    name: 'Capas draft en GPU',
    long: '--n-gpu-layers-draft',
    short: '-ngld',
    aliases: ['--spec-draft-ngl', '--gpu-layers-draft'],
    defaultValue: 'auto',
    category: 'especulativo',
    description: 'Número máximo de capas del modelo borrador en VRAM (número, auto o all).',
  },
  {
    name: 'Dispositivo del draft',
    long: '--device-draft',
    short: '-devd',
    aliases: ['--spec-draft-device'],
    defaultValue: null,
    category: 'especulativo',
    description: 'Lista de dispositivos (coma) para offload del modelo borrador.',
  },
  {
    name: 'Threads del draft',
    long: '--threads-draft',
    short: '-td',
    aliases: ['--spec-draft-threads'],
    defaultValue: 'igual que --threads',
    category: 'especulativo',
    description: 'Threads de CPU para la generación del modelo borrador.',
  },
  {
    name: 'Threads batch draft',
    long: '--threads-batch-draft',
    short: '-tbd',
    aliases: ['--spec-draft-threads-batch'],
    defaultValue: 'igual que --threads-draft',
    category: 'especulativo',
    description: 'Threads de CPU para el batch/prompt del modelo borrador.',
  },
  {
    name: 'CPU mask draft',
    long: '--cpu-mask-draft',
    short: '-Cd',
    aliases: ['--spec-draft-cpu-mask'],
    defaultValue: 'igual que --cpu-mask',
    category: 'especulativo',
    description: 'Máscara de afinidad de CPU para el modelo borrador.',
  },
  {
    name: 'CPU range draft',
    long: '--cpu-range-draft',
    short: '-Crd',
    aliases: ['--spec-draft-cpu-range'],
    defaultValue: null,
    category: 'especulativo',
    description: 'Rango de CPUs (lo-hi) para afinidad del modelo borrador.',
  },
  {
    name: 'CPU strict draft',
    long: '--cpu-strict-draft',
    short: null,
    aliases: ['--spec-draft-cpu-strict'],
    defaultValue: 'igual que --cpu-strict',
    category: 'especulativo',
    description: 'Placement estricto de CPU para el modelo borrador (0|1).',
  },
  {
    name: 'Override tensor draft',
    long: '--override-tensor-draft',
    short: '-otd',
    aliases: ['--spec-draft-override-tensor'],
    defaultValue: null,
    category: 'especulativo',
    description: 'Sobreescribe el tipo de buffer de tensores del modelo borrador (patron=buffer,...).',
  },
  {
    name: 'Backend sampling draft',
    long: '--spec-draft-backend-sampling',
    short: null,
    aliases: ['--no-spec-draft-backend-sampling'],
    defaultValue: 'enabled',
    category: 'especulativo',
    description: 'Descarga el sampling del borrador al backend (default habilitado).',
  },
  {
    name: 'ngram-mod N mín.',
    long: '--spec-ngram-mod-n-min',
    short: null,
    defaultValue: '48',
    category: 'especulativo',
    description: 'Número mínimo de tokens ngram para speculative decoding ngram-mod.',
  },
  {
    name: 'ngram-mod N máx.',
    long: '--spec-ngram-mod-n-max',
    short: null,
    defaultValue: '64',
    category: 'especulativo',
    description: 'Número máximo de tokens ngram para speculative decoding ngram-mod.',
  },
  {
    name: 'ngram-mod lookup',
    long: '--spec-ngram-mod-n-match',
    short: null,
    defaultValue: '24',
    category: 'especulativo',
    description: 'Longitud del lookup de ngram-mod.',
  },
  {
    name: 'ngram-simple N',
    long: '--spec-ngram-simple-size-n',
    short: null,
    defaultValue: '12',
    category: 'especulativo',
    description: 'Tamaño N (lookup n-gram) para ngram-simple speculative decoding.',
  },
  {
    name: 'ngram-simple M',
    long: '--spec-ngram-simple-size-m',
    short: null,
    defaultValue: '48',
    category: 'especulativo',
    description: 'Tamaño M (draft m-gram) para ngram-simple speculative decoding.',
  },
  {
    name: 'ngram-simple min-hits',
    long: '--spec-ngram-simple-min-hits',
    short: null,
    defaultValue: '1',
    category: 'especulativo',
    description: 'Número mínimo de hits para ngram-simple speculative decoding.',
  },

  // ════════════════════ PARÁMETROS DEL SERVIDOR ════════════════════
  {
    name: 'Host',
    long: '--host',
    short: null,
    defaultValue: '127.0.0.1',
    category: 'servidor',
    description:
      'Dirección IP donde escucha el servidor (o socket UNIX si termina en .sock). 127.0.0.1 = solo local; 0.0.0.0 = expone a la red (solo redes de confianza).',
  },
  {
    name: 'Puerto',
    long: '--port',
    short: null,
    defaultValue: '8080',
    category: 'servidor',
    description:
      'Puerto donde escucha el servidor HTTP (default 8080). En este proyecto el orquestador usa 3000 para no chocar con este puerto.',
  },
  {
    name: 'Timeout',
    long: '--timeout',
    short: '-to',
    defaultValue: '3600',
    category: 'servidor',
    description: 'Timeout de lectura/escritura del servidor en segundos.',
  },
  {
    name: 'Reuse port',
    long: '--reuse-port',
    short: null,
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Permite a varios sockets enlazarse al mismo puerto (SO_REUSEPORT).',
  },
  {
    name: 'Path estáticos',
    long: '--path',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta desde la que servir archivos estáticos.',
  },
  {
    name: 'API prefix',
    long: '--api-prefix',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Prefijo de ruta desde el que el servidor sirve la API (sin barra final).',
  },
  {
    name: 'Slots (paralelismo)',
    long: '--parallel',
    short: '-np',
    defaultValue: '-1',
    category: 'servidor',
    description:
      'Número de slots del servidor (requests concurrentes). -1 = auto. Más de 1 habilita batching entre requests, mejorando el aprovechamiento de la GPU con varios usuarios.',
  },
  {
    name: 'Batching continuo',
    long: '--cont-batching',
    short: '-cb',
    aliases: ['--no-cont-batching', '-nocb'],
    defaultValue: 'enabled',
    category: 'servidor',
    description:
      'Habilita batching continuo (dynamic batching): las secuencias se añaden/quitan del batch al vuelo. Necesario para servir varios usuarios con -np > 1.',
  },
  {
    name: 'Context shift',
    long: '--context-shift',
    short: null,
    aliases: ['--no-context-shift'],
    defaultValue: 'disabled',
    category: 'servidor',
    description:
      'Si al llenarse el contexto se desplazan tokens viejos para hacer sitio (default deshabilitado). Útil para generación infinita; --no-context-shift desactiva el shift.',
  },
  {
    name: 'Cache de prompt',
    long: '--cache-prompt',
    short: null,
    aliases: ['--no-cache-prompt'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Habilita la caché de prompt (reutiliza el prompt ya evaluado entre requests).',
  },
  {
    name: 'Reuso de cache',
    long: '--cache-reuse',
    short: null,
    defaultValue: '0',
    category: 'servidor',
    description:
      'Tamaño mínimo de chunk para reutilizar de la caché vía KV shifting (requiere prompt caching). 0 = deshabilitado.',
  },
  {
    name: 'KV unificado',
    long: '--kv-unified',
    short: '-kvu',
    aliases: ['--no-kv-unified', '-no-kvu'],
    defaultValue: 'auto',
    category: 'servidor',
    description: 'Usa un único buffer KV unificado compartido entre todas las secuencias.',
  },
  {
    name: 'Cache RAM',
    long: '--cache-ram',
    short: '-cram',
    defaultValue: '8192',
    category: 'servidor',
    description: 'Tamaño máximo de caché en MiB (-1 = sin límite, 0 = deshabilitado).',
  },
  {
    name: 'Idle slots en cache',
    long: '--cache-idle-slots',
    short: null,
    aliases: ['--no-cache-idle-slots'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Guarda los slots inactivos en la prompt cache al recibir una nueva tarea (requiere cache-ram).',
  },
  {
    name: 'Checkpoints de ctx',
    long: '--ctx-checkpoints',
    short: '-ctxcp',
    aliases: ['--swa-checkpoints'],
    defaultValue: '32',
    category: 'servidor',
    description: 'Número máximo de checkpoints de contexto por slot.',
  },
  {
    name: 'Paso mín. checkpoint',
    long: '--checkpoint-min-step',
    short: '-cms',
    defaultValue: '256',
    category: 'servidor',
    description: 'Espaciado mínimo entre checkpoints de contexto en tokens (0 = sin mínimo).',
  },
  {
    name: 'Jinja (plantilla chat)',
    long: '--jinja',
    short: null,
    aliases: ['--no-jinja'],
    defaultValue: 'enabled',
    category: 'servidor',
    description:
      'Usa el motor de plantillas Jinja nativo del modelo. Habilita tool-calling y razonamiento avanzado siguiendo la plantilla Jinja del GGUF.',
  },
  {
    name: 'Plantilla de chat',
    long: '--chat-template',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description:
      'Sobreescribe la plantilla de chat Jinja (chatml, llama2, llama3, …). Útil cuando el GGUF no trae la plantilla correcta o se quiere forzar un formato.',
  },
  {
    name: 'Archivo plantilla chat',
    long: '--chat-template-file',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Archivo con la plantilla de chat Jinja personalizada.',
  },
  {
    name: 'Kwargs plantilla chat',
    long: '--chat-template-kwargs',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Parámetros extra para el parser de plantilla JSON (objeto JSON válido).',
  },
  {
    name: 'Reasoning (thinking)',
    long: '--reasoning',
    short: '-rea',
    defaultValue: 'auto',
    category: 'servidor',
    description: 'Controla el razonamiento/thinking en el chat (on/off/auto, default auto = detectar de la plantilla).',
  },
  {
    name: 'Formato de reasoning',
    long: '--reasoning-format',
    short: null,
    defaultValue: 'auto',
    category: 'servidor',
    description:
      'Controla cómo se manejan las etiquetas de pensamiento: none (sin parsear), deepseek (en reasoning_content), deepseek-legacy (conserva <think>).',
  },
  {
    name: 'Presupuesto reasoning',
    long: '--reasoning-budget',
    short: null,
    defaultValue: '-1',
    category: 'servidor',
    description: 'Presupuesto de tokens para pensar: -1 sin límite, 0 fin inmediato, N>0 presupuesto.',
  },
  {
    name: 'Mensaje fin reasoning',
    long: '--reasoning-budget-message',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Mensaje inyectado antes del tag de fin de pensamiento cuando se agota el presupuesto.',
  },
  {
    name: 'Skip chat parsing',
    long: '--skip-chat-parsing',
    short: null,
    aliases: ['--no-skip-chat-parsing'],
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Fuerza un parser de contenido puro: el modelo saca todo en content (reasoning + tools).',
  },
  {
    name: 'Prefill assistant',
    long: '--prefill-assistant',
    short: null,
    aliases: ['--no-prefill-assistant'],
    defaultValue: 'enabled',
    category: 'servidor',
    description:
      'Si el último mensaje es del asistente, lo trata como prefill de su respuesta (en vez de mensaje completo).',
  },
  {
    name: 'Proyector multimodal',
    long: '--mmproj',
    short: '-mm',
    defaultValue: null,
    category: 'servidor',
    description:
      'Ruta al archivo del proyector multimodal (visión). Con -hf se omite si existe. Necesario para modelos que aceptan imágenes (LLaVA, etc.).',
  },
  {
    name: 'URL del mmproj',
    long: '--mmproj-url',
    short: '-mmu',
    defaultValue: null,
    category: 'servidor',
    description: 'URL del archivo del proyector multimodal.',
  },
  {
    name: 'mmproj auto',
    long: '--mmproj-auto',
    short: null,
    aliases: ['--no-mmproj', '--no-mmproj-auto'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Si se usa el proyector multimodal cuando está disponible (útil con -hf). --no-mmproj lo desactiva.',
  },
  {
    name: 'Offload del mmproj',
    long: '--mmproj-offload',
    short: null,
    aliases: ['--no-mmproj-offload'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Habilita el offload a GPU del proyector multimodal.',
  },
  {
    name: 'Tokens mín. imagen',
    long: '--image-min-tokens',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Número mínimo de tokens que ocupa cada imagen (modelos de visión con resolución dinámica).',
  },
  {
    name: 'Tokens máx. imagen',
    long: '--image-max-tokens',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Número máximo de tokens que ocupa cada imagen (modelos de visión con resolución dinámica).',
  },
  {
    name: 'Embeddings',
    long: '--embeddings',
    short: null,
    aliases: ['--embedding'],
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Restringe el servidor a solo soportar el caso de uso de embeddings (modelos dedicados).',
  },
  {
    name: 'Reranking',
    long: '--reranking',
    short: null,
    aliases: ['--rerank'],
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Habilita el endpoint de reranking en el servidor.',
  },
  {
    name: 'Pooling',
    long: '--pooling',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Tipo de pooling para embeddings: none, mean, cls, last o rank. Si no se indica, el del modelo.',
  },
  {
    name: 'Normalización embeddings',
    long: '--embd-normalize',
    short: null,
    defaultValue: '2',
    category: 'servidor',
    description:
      'Normalización de embeddings (-1 ninguna, 0 max abs int16, 1 taxicab, 2 euclidean, >2 p-norm).',
  },
  {
    name: 'API key',
    long: '--api-key',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'API key de autenticación (varias separadas por coma). Por defecto ninguna.',
  },
  {
    name: 'Archivo API keys',
    long: '--api-key-file',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Archivo con las API keys (una por línea).',
  },
  {
    name: 'Archivo SSL key',
    long: '--ssl-key-file',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta a la clave privada SSL codificada en PEM.',
  },
  {
    name: 'Archivo SSL cert',
    long: '--ssl-cert-file',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta al certificado SSL codificado en PEM.',
  },
  {
    name: 'SSE ping interval',
    long: '--sse-ping-interval',
    short: null,
    defaultValue: '30',
    category: 'servidor',
    description: 'Intervalo (segundos) de los pings SSE del servidor (-1 = deshabilitado).',
  },
  {
    name: 'Web UI',
    long: '--ui',
    short: null,
    aliases: ['--no-ui', '--webui', '--no-webui'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Habilita (o --no-ui deshabilita) la Web UI integrada.',
  },
  {
    name: 'UI config (JSON)',
    long: '--ui-config',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'JSON con ajustes por defecto de la UI (sobreescribe los defaults).',
  },
  {
    name: 'UI config (archivo)',
    long: '--ui-config-file',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Archivo JSON con ajustes por defecto de la UI.',
  },
  {
    name: 'MCP CORS proxy',
    long: '--ui-mcp-proxy',
    short: null,
    aliases: ['--no-ui-mcp-proxy', '--webui-mcp-proxy', '--no-webui-mcp-proxy'],
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Experimental: habilita el proxy CORS de MCP (no activar en entornos no confiables).',
  },
  {
    name: 'Tools (agentes)',
    long: '--tools',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description:
      'Experimental: herramientas integradas para agentes (read_file, grep_search, exec_shell_command, …). "all" habilita todas. No activar en entornos no confiables.',
  },
  {
    name: 'Endpoints /metrics',
    long: '--metrics',
    short: null,
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Habilita el endpoint de métricas compatible con Prometheus.',
  },
  {
    name: 'Endpoint /props',
    long: '--props',
    short: null,
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Permite cambiar propiedades globales vía POST /props.',
  },
  {
    name: 'Endpoint /slots',
    long: '--slots',
    short: null,
    aliases: ['--no-slots'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Expone el endpoint de monitorización de slots.',
  },
  {
    name: 'Path guardar slots',
    long: '--slot-save-path',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta donde guardar la cache KV de los slots (default deshabilitado).',
  },
  {
    name: 'Media path',
    long: '--media-path',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Directorio para cargar archivos multimedia locales (accesibles vía file:// relativo).',
  },
  {
    name: 'Alias del modelo',
    long: '--alias',
    short: '-a',
    defaultValue: null,
    category: 'servidor',
    description: 'Alias del nombre del modelo (separados por coma), usado por la API.',
  },
  {
    name: 'Tags del modelo',
    long: '--tags',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Tags del modelo (separados por coma), informativos (no se usan para routing).',
  },
  {
    name: 'Dir de modelos (router)',
    long: '--models-dir',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Directorio con los modelos para el router server.',
  },
  {
    name: 'Preset de modelos (router)',
    long: '--models-preset',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta a un archivo INI con presets de modelos para el router server.',
  },
  {
    name: 'Modelos máx. (router)',
    long: '--models-max',
    short: null,
    defaultValue: '4',
    category: 'servidor',
    description: 'Para el router server, número máximo de modelos cargados a la vez (0 = ilimitado).',
  },
  {
    name: 'Autoload modelos (router)',
    long: '--models-autoload',
    short: null,
    aliases: ['--no-models-autoload'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Para el router server, carga modelos automáticamente.',
  },
  {
    name: 'Warmup',
    long: '--warmup',
    short: null,
    aliases: ['--no-warmup'],
    defaultValue: 'enabled',
    category: 'servidor',
    description: 'Realiza un run vacío de calentamiento al iniciar.',
  },
  {
    name: 'Reverse prompt',
    long: '--reverse-prompt',
    short: '-r',
    defaultValue: null,
    category: 'servidor',
    description: 'Detiene la generación al hallar PROMPT y devuelve el control (modo interactivo).',
  },
  {
    name: 'Tokens especiales',
    long: '--special',
    short: '-sp',
    defaultValue: 'false',
    category: 'servidor',
    description: 'Habilita la salida de tokens especiales.',
  },
  {
    name: 'SPM infill',
    long: '--spm-infill',
    short: null,
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Usa el patrón Suffix/Prefix/Middle para infill (algunos modelos lo prefieren).',
  },
  {
    name: 'Similaridad de slot',
    long: '--slot-prompt-similarity',
    short: '-sps',
    defaultValue: '0.10',
    category: 'servidor',
    description: 'Cuánto debe coincidir el prompt de un request con el de un slot para reutilizarlo (0.0 = off).',
  },
  {
    name: 'LoRA init sin aplicar',
    long: '--lora-init-without-apply',
    short: null,
    defaultValue: 'disabled',
    category: 'servidor',
    description: 'Carga los adaptadores LoRA sin aplicarlos (se aplican luego vía POST /lora-adapters).',
  },
  {
    name: 'Sleep si idle',
    long: '--sleep-idle-seconds',
    short: null,
    defaultValue: '-1',
    category: 'servidor',
    description: 'Segundos de inactividad tras los que el servidor entra en sleep (-1 = deshabilitado).',
  },
  {
    name: 'Dir log de prompts',
    long: '--log-prompts-dir',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Directorio donde loguear los prompts (solo para depuración).',
  },
  {
    name: 'Vocoder (audio)',
    long: '--model-vocoder',
    short: '-mv',
    defaultValue: null,
    category: 'servidor',
    description: 'Modelo vocoder para generación de audio.',
  },
  {
    name: 'TTS guide tokens',
    long: '--tts-use-guide-tokens',
    short: null,
    defaultValue: null,
    category: 'servidor',
    description: 'Usa guide tokens para mejorar el recall de palabras en TTS.',
  },
  {
    name: 'Cache lookup estática',
    long: '--lookup-cache-static',
    short: '-lcs',
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta a la cache de lookup estática (no se actualiza al generar).',
  },
  {
    name: 'Cache lookup dinámica',
    long: '--lookup-cache-dynamic',
    short: '-lcd',
    defaultValue: null,
    category: 'servidor',
    description: 'Ruta a la cache de lookup dinámica (se actualiza al generar).',
  },
]

/**
 * Agrupa los tokens de un script ya "aplanado" (sin `\` de continuación) en
 * piezas: el comando, y luego cada flag junto con su valor (si lo lleva).
 * p.ej. `llama-server -hf model.gguf --jinja --ctx-size 8192` →
 *       ['llama-server', '-hf model.gguf', '--jinja', '--ctx-size 8192'].
 *
 * Un token que NO empieza por `-` se interpreta como valor del flag anterior.
 * El primer token (comando) se trata aparte.
 */
function tokenizeIntoPieces(script: string): string[] {
  const tokens = script.split(/\s+/).filter(Boolean)
  if (!tokens.length) return ['./llama-server']
  const pieces: string[] = [tokens[0]]
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok.startsWith('-')) {
      const next = tokens[i + 1]
      if (next && !next.startsWith('-')) {
        pieces.push(`${tok} ${next}`)
        i++
      } else {
        pieces.push(tok)
      }
    } else {
      // Valor suelto sin flag previo (raro): lo dejamos como pieza propia.
      pieces.push(tok)
    }
  }
  return pieces
}

/** Aplana un script: quita `\` de continuación de línea, deja todo en una línea. */
function flattenScript(script: string): string {
  return script.replace(/\\\r?\n/g, ' ').replace(/\\/g, '').trim()
}

/** Todas las formas reconocidas de un flag (larga + corta + aliases). */
export function flagForms(flag: LlamaFlag): string[] {
  return [flag.long, flag.short, ...(flag.aliases ?? [])].filter(Boolean) as string[]
}

/**
 * Inserta un flag en el script: si el flag ya existe (cualquier forma) NO hace
 * nada (preserva el valor que el usuario haya puesto a mano); si no existe, lo
 * añade al final con su valor por defecto. Respeta el estilo "una flag por
 * línea" con continuación `\`.
 *
 * Devuelve `{ script, added }`: `added` es false cuando ya existía (para que la
 * UI pueda avisar en vez de mostrar "agregado").
 */
export function addFlagToScript(
  script: string,
  flag: LlamaFlag,
): { script: string; added: boolean } {
  const pieces = tokenizeIntoPieces(flattenScript(script))
  const cmd = pieces[0]
  const rest = pieces.slice(1)

  const forms = flagForms(flag)
  // ¿Ya está presente el flag (en cualquier pieza, como primer token)?
  const exists = rest.some((p) => forms.includes(p.split(/\s+/)[0]))
  if (exists) {
    return { script: joinPieces(cmd, rest), added: false }
  }

  const value = flag.defaultValue
  const piece = value && value !== '' ? `${flag.long} ${value}` : flag.long
  rest.push(piece)
  return { script: joinPieces(cmd, rest), added: true }
}

/** Reconstruye el script con `\` de continuación, una pieza por línea. */
function joinPieces(cmd: string, pieces: string[]): string {
  return [cmd, ...pieces].join(' \\\n')
}
