// Catálogo estático de flags de `llama-server`, extraído del `--help` oficial.
// Fuente de datos de la tabla de flags del editor de script. Cada entrada:
// nombre legible, flag larga (forma canónica), flag corta (si existe), aliases
// extra, valor por defecto (tal cual lo muestra el help), descripción en español
// y categoría (para el filtro). Las descripciones explican para qué sirve, qué
// mejora y qué efecto tiene sobre el Servidor / el rendimiento.

/** Categorías de flags (para el filtro por grupo). */
export type FlagCategory = 'Común' | 'Muestreo' | 'Especulativo' | 'Servidor';

/** Una entrada del catálogo de flags. */
export interface LlamaFlag {
  /** Nombre legible (etiqueta mostrada en la lista). */
  name: string;
  /** Flag larga canónica, p.ej. `--ctx-size`. */
  long: string;
  /** Flag corta, p.ej. `-c`. `null` si no existe forma corta. */
  short: string | null;
  /** Formas adicionales aceptadas (largas o cortas) para detección de duplicados. */
  aliases?: string[];
  /** Valor por defecto mostrado (string para uniformidad). `null` si es un switch. */
  defaultValue: string | null;
  /** Descripción larga en español: para qué sirve, qué mejora, qué efecto tiene. */
  description: string;
  /** Texto original en inglés del --help de llama-server. */
  originalDescription?: string;
  /** Categoría para el filtro. */
  category: FlagCategory;
}

/**
 * Catálogo completo de flags de `llama-server`, agrupado por categoría.
 * Ordenado dentro de cada grupo de lo más usado a lo más específico.
 *
 * La categoría "Común" agrupa los flags que aparecen en casi todos los scripts
 * reales (modelo, capas, contexto, batch, flash-attn, Muestreo básico, jinja,
 * métricas, speculative decoding, etc.). Las categorías "Muestreo",
 * "Especulativo" y "Servidor" contienen el resto de flags más específicas.
 */
export const LLAMA_FLAGS: LlamaFlag[] = [
  // ════════════════════ PARÁMETROS COMUNES ════════════════════
  {
    name: 'Modelo (archivo local)',
    long: '--model',
    short: '-m',
    defaultValue: null,
    originalDescription: 'model path to load',
    category: 'Común',
    description:
      'Ruta al archivo de modelo GGUF en disco a cargar en memoria. Es la forma tradicional de cargar modelos locales, alternativa a --hf-repo.',
  },
  {
    name: 'Modelo (Hugging Face)',
    long: '--hf-repo',
    short: '-hf',
    aliases: ['-hfr'],
    defaultValue: null,
    originalDescription: 'Hugging Face model repository',
    category: 'Común',
    description:
      'Repositorio de Hugging Face del que descargar/usar el modelo (se cachea en ~/.cache/huggingface). Acepta sufijo de cuantización (p.ej. :Q4_K_M). Descarga el mmproj automáticamente si existe (usa --no-mmproj para evitarlo).',
  },
  {
    name: 'Archivo HF (override)',
    long: '--hf-file',
    short: '-hff',
    defaultValue: null,
    originalDescription: 'Hugging Face model file',
    category: 'Común',
    description:
      'Archivo concreto del repositorio de Hugging Face. Si se indica, sobreescribe la cuantización elegida en --hf-repo.',
  },
  {
    name: 'Token de Hugging Face',
    long: '--hf-token',
    short: '-hft',
    defaultValue: null,
    originalDescription: 'Hugging Face access token',
    category: 'Común',
    description:
      'Token de acceso de Hugging Face para repositorios privados o con rate-limit. Por defecto toma el valor de la variable de entorno HF_TOKEN.',
  },
  {
    name: 'Repositorio Docker',
    long: '--docker-repo',
    short: '-dr',
    defaultValue: null,
    originalDescription: 'Docker Hub model repository',
    category: 'Común',
    description:
      'Repositorio de Docker Hub con el modelo (formato [repo/]modelo[:quant], default ai/:latest). Alternativa a --hf-repo/--model.',
  },
  {
    name: 'URL de descarga del modelo',
    long: '--model-url',
    short: '-mu',
    defaultValue: null,
    originalDescription: 'model download url',
    category: 'Común',
    description: 'URL directa desde la que descargar el modelo (en vez de ruta local).',
  },
  {
    name: 'Capas en GPU',
    long: '--n-gpu-layers',
    short: '-ngl',
    aliases: ['--gpu-layers'],
    defaultValue: 'auto',
    originalDescription: 'max number of layers to store in VRAM',
    category: 'Común',
    description:
      'Cantidad de capas del modelo que se descargan a la VRAM. Puede ser un número exacto, "auto" o "all". Subir este valor mejora drásticamente la velocidad de inferencia (la GPU es mucho más rápida que la CPU) pero consume más VRAM.',
  },
  {
    name: 'Tamaño de contexto',
    long: '--ctx-size',
    short: '-c',
    defaultValue: '0',
    originalDescription: 'size of the prompt context',
    category: 'Común',
    description:
      'Cantidad máxima de tokens del contexto (prompt + generación). 0 = tomado del modelo. Más contexto permite conversaciones/RAG más largos pero consume VRAM proporcionalmente (cache KV).',
  },
  {
    name: 'Tokens a predecir',
    long: '--n-predict',
    short: '-n',
    aliases: ['--predict'],
    defaultValue: '-1',
    originalDescription: 'number of tokens to predict',
    category: 'Común',
    description:
      'Número de tokens a generar en la respuesta. -1 = infinito (hasta EOS o límite de contexto). Útil para acotar la longitud máxima de salida.',
  },
  {
    name: 'Tamaño de batch lógico',
    long: '--batch-size',
    short: '-b',
    defaultValue: '2048',
    originalDescription: 'logical maximum batch size',
    category: 'Común',
    description:
      'Máximo tamaño de batch lógico para el procesamiento del prompt (prompt eval). Valores más grandes aceleran el procesamiento de prompts largos pero usan más memoria temporal.',
  },
  {
    name: 'Tamaño de ubatch físico',
    long: '--ubatch-size',
    short: '-ub',
    defaultValue: '512',
    originalDescription: 'physical maximum batch size',
    category: 'Común',
    description:
      'Máximo tamaño de batch físico enviado al backend de compute durante el prompt eval. Suele alinearse con -b o ser menor. Aumentar mejora el throughput del prompt eval si hay VRAM de sobra.',
  },
  {
    name: 'Tokens a conservar',
    long: '--keep',
    short: null,
    defaultValue: '0',
    originalDescription: 'number of tokens to keep from the initial prompt',
    category: 'Común',
    description:
      'Cantidad de tokens del prompt inicial que se conservan al hacer context-shift. 0 = ninguno, -1 = todos. Útil para preservar el system prompt en conversaciones largas.',
  },
  {
    name: 'Threads (generación)',
    long: '--threads',
    short: '-t',
    defaultValue: '-1',
    originalDescription: 'number of CPU threads to use during generation (default: -1)',
    category: 'Común',
    description:
      'Número de threads de CPU usados durante la generación. -1 = automático. Ideal = cantidad de núcleos físicos; excederlo suele bajar el rendimiento.',
  },
  {
    name: 'Threads (batch)',
    long: '--threads-batch',
    short: '-tb',
    defaultValue: 'igual que --threads',
    originalDescription: 'number of threads to use during batch and prompt processing',
    category: 'Común',
    description:
      'Número de threads de CPU usados durante el procesamiento de batch y prompt. Puede diferir de --threads porque el batch tiene más paralelismo disponible.',
  },
  {
    name: 'Threads HTTP',
    long: '--threads-http',
    short: null,
    defaultValue: '-1',
    originalDescription: 'threads used to process HTTP requests',
    category: 'Común',
    description:
      'Número de threads dedicados a procesar las peticiones HTTP entrantes (-1 = automático).',
  },
  {
    name: 'Flash Attention',
    long: '--flash-attn',
    short: '-fa',
    defaultValue: 'auto',
    originalDescription: 'set Flash Attention use',
    category: 'Común',
    description:
      'Controla Flash Attention (on/off/auto). Mejora la velocidad y reduce el consumo de memoria de la atención, especialmente con contextos grandes. Muy recomendado cuando la GPU lo soporta.',
  },
  {
    name: 'Tipo de cache K',
    long: '--cache-type-k',
    short: '-ctk',
    defaultValue: 'f16',
    originalDescription: 'KV cache data type for K',
    category: 'Común',
    description:
      'Tipo de dato de la cache de claves (key). f16 es por defecto y de mayor calidad. Valores: f32, f16, bf16, q8_0, q4_0, q4_1, iq4_nl, q5_0, q5_1. Cuantizar reduce el consumo de VRAM con pérdida leve de calidad.',
  },
  {
    name: 'Tipo de cache V',
    long: '--cache-type-v',
    short: '-ctv',
    defaultValue: 'f16',
    originalDescription: 'KV cache data type for V',
    category: 'Común',
    description:
      'Tipo de dato de la cache de valores (value). Mismas opciones que -ctk. Cuantizar V suele perjudar más la calidad que K; combinar -ctk q8_0 -ctv q8_0 es un buen balance VRAM/calidad.',
  },
  {
    name: 'Dispositivo(s)',
    long: '--device',
    short: '-dev',
    defaultValue: null,
    originalDescription: 'comma-separated list of devices to use for offloading',
    category: 'Común',
    description:
      'Lista de dispositivos (separados por coma) para offload, p.ej. CUDA0,Vulkan0. none = no hacer offload. Usa --list-devices para ver los disponibles.',
  },
  {
    name: 'Listar dispositivos',
    long: '--list-devices',
    short: null,
    defaultValue: null,
    originalDescription: 'print list of available devices and exit',
    category: 'Común',
    description: 'Imprime la lista de dispositivos disponibles y termina.',
  },
  {
    name: 'Modo de split',
    long: '--split-mode',
    short: '-sm',
    defaultValue: 'layer',
    originalDescription: 'how to split the model across multiple GPUs',
    category: 'Común',
    description:
      'Cómo dividir el modelo entre varias GPUs: none (una GPU), layer (por capas, default), row (por filas, paralelo) o tensor (experimental). layer suele dar el mejor balance para multi-GPU.',
  },
  {
    name: 'Split de tensores',
    long: '--tensor-split',
    short: '-ts',
    defaultValue: null,
    originalDescription: 'fraction of model to offload to each GPU',
    category: 'Común',
    description:
      'Fracción del modelo que se reparte entre GPUs, lista separada por coma (p.ej. 3,1 = 75%/25%). Útil para distribuir un modelo grande entre GPUs de distinto tamaño.',
  },
  {
    name: 'GPU principal',
    long: '--main-gpu',
    short: '-mg',
    defaultValue: '0',
    originalDescription: 'the GPU to use for the model',
    category: 'Común',
    description:
      'GPU usada para el modelo (con split-mode=none) o para resultados intermedios y KV (con split-mode=row).',
  },
  {
    name: 'MoE en CPU',
    long: '--cpu-moe',
    short: '-cmoe',
    defaultValue: null,
    originalDescription: 'keep all Mixture of Experts weights in the CPU',
    category: 'Común',
    description: 'Mantiene todos los pesos de Mixture of Experts (MoE) en la CPU en vez de la GPU.',
  },
  {
    name: 'N capas MoE en CPU',
    long: '--n-cpu-moe',
    short: '-ncmoe',
    defaultValue: null,
    originalDescription: 'keep MoE weights of first N layers in CPU',
    category: 'Común',
    description: 'Mantiene los pesos MoE de las primeras N capas en la CPU (offload parcial).',
  },
  {
    name: 'mmap (memoria mapeada)',
    long: '--mmap',
    short: null,
    aliases: ['--no-mmap'],
    defaultValue: 'enabled',
    originalDescription: 'whether to memory-map model',
    category: 'Común',
    description:
      'Si se mapea el modelo en memoria (mmap). mmap reduce el uso de RAM y acelera el arranque; --no-mmap puede mejorar la latencia cuando sobra RAM.',
  },
  {
    name: 'mlock (bloquear en RAM)',
    long: '--mlock',
    short: null,
    defaultValue: 'false',
    originalDescription: 'force system to keep model in RAM',
    category: 'Común',
    description:
      'Bloquea el modelo en RAM evitando swap (mejora la consistencia de latencia). Requiere permisos (RLIMIT_MEMLOCK / CAP_IPC_LOCK).',
  },
  {
    name: 'Prefijo de log',
    long: '--log-prefix',
    short: null,
    aliases: ['--no-log-prefix'],
    defaultValue: null,
    originalDescription: 'Enable prefix in log messages',
    category: 'Común',
    description: 'Habilita (o --no-log-prefix deshabilita) el prefijo en los mensajes de log.',
  },
  // ── Muestreo básico (presente en casi todos los scripts) ──
  {
    name: 'Temperatura',
    long: '--temperature',
    short: null,
    aliases: ['--temp'],
    defaultValue: '0.80',
    originalDescription: 'temperature',
    category: 'Común',
    description:
      'Temperatura de Muestreo. Valores altos = respuestas más creativas/aleatorias; valores bajos = más deterministas y enfocadas. Típico: 0.6-0.9.',
  },
  {
    name: 'top-k',
    long: '--top-k',
    short: null,
    defaultValue: '40',
    originalDescription: 'top-k sampling',
    category: 'Común',
    description: 'Muestreo top-k: considera solo los K tokens más probables (0 = deshabilitado).',
  },
  {
    name: 'top-p (nucleus)',
    long: '--top-p',
    short: null,
    defaultValue: '0.95',
    originalDescription: 'top-p sampling',
    category: 'Común',
    description:
      'Muestreo nucleus: selecciona el conjunto mínimo de tokens cuya probabilidad acumulada supera p (1.0 = deshabilitado).',
  },
  {
    name: 'min-p',
    long: '--min-p',
    short: null,
    defaultValue: '0.05',
    originalDescription: 'min-p sampling',
    category: 'Común',
    description:
      'Descarta tokens con probabilidad menor a min-p · (prob del token más probable) (0.0 = off).',
  },
  {
    name: 'Penalización repetición',
    long: '--repeat-penalty',
    short: null,
    defaultValue: '1.00',
    originalDescription: 'penalize repeat sequence of tokens',
    category: 'Común',
    description:
      'Penaliza secuencias repetidas de tokens. >1 reduce repeticiones. 1.0 = deshabilitado. Típico: 1.1-1.3.',
  },
  // ── Speculative decoding (muy usado en scripts de rendimiento) ──
  {
    name: 'Tipo de spec decoding',
    long: '--spec-type',
    short: null,
    defaultValue: 'none',
    originalDescription: 'types of speculative decoding to use',
    category: 'Común',
    description:
      'Lista (separada por coma) de tipos de speculative decoding: none, draft-simple, draft-eagle3, draft-mtp, ngram-simple, ngram-map-k, ngram-map-k4v, ngram-mod, ngram-cache.',
  },
  {
    name: 'Tokens a generar (draft)',
    long: '--spec-draft-n-max',
    short: null,
    aliases: ['--draft-max', '--draft', '--draft-n'],
    defaultValue: '3',
    originalDescription: 'number of tokens to draft for speculative decoding',
    category: 'Común',
    description:
      'Número máximo de tokens que el borrador propone por paso. Valores más altos pueden aumentar la aceleración si la tasa de aceptación es alta, pero suben el coste por paso.',
  },
  // ── Plantilla de chat / razonamiento (habilitados por defecto en la mayoría de scripts) ──
  {
    name: 'Jinja (plantilla chat)',
    long: '--jinja',
    short: null,
    aliases: ['--no-jinja'],
    defaultValue: 'enabled',
    originalDescription: 'whether to use jinja template engine for chat',
    category: 'Común',
    description:
      'Usa el motor de plantillas Jinja nativo del modelo. Habilita tool-calling y razonamiento avanzado siguiendo la plantilla Jinja del GGUF.',
  },
  {
    name: 'Kwargs plantilla chat',
    long: '--chat-template-kwargs',
    short: null,
    defaultValue: null,
    originalDescription: 'sets additional params for the json template parser',
    category: 'Común',
    description: 'Parámetros extra para el parser de plantilla JSON (objeto JSON válido).',
  },
  {
    name: 'Reuso de cache',
    long: '--cache-reuse',
    short: null,
    defaultValue: '0',
    originalDescription: 'min chunk size to attempt reusing from the cache',
    category: 'Común',
    description:
      'Tamaño mínimo de chunk para reutilizar de la caché vía KV shifting (requiere prompt caching). 0 = deshabilitado.',
  },
  {
    name: 'Proyector multimodal (auto)',
    long: '--mmproj-auto',
    short: null,
    aliases: ['--no-mmproj', '--no-mmproj-auto'],
    defaultValue: 'enabled',
    originalDescription: 'whether to use multimodal projector file automatically',
    category: 'Común',
    description:
      'Si se usa el proyector multimodal cuando está disponible (útil con -hf). --no-mmproj lo desactiva.',
  },
  {
    name: 'Endpoints /metrics',
    long: '--metrics',
    short: null,
    defaultValue: 'disabled',
    originalDescription: 'enable prometheus compatible metrics endpoint',
    category: 'Común',
    description: 'Habilita el endpoint de métricas compatible con Prometheus.',
  },

  // ════════════════════ PARÁMETROS DE MUESTREO ════════════════════
  {
    name: 'top-n-sigma',
    long: '--top-n-sigma',
    short: null,
    aliases: ['--top-nsigma'],
    defaultValue: '-1.00',
    originalDescription: 'top-n-sigma sampling',
    category: 'Muestreo',
    description:
      'Muestreo top-n-sigma: corta los tokens por debajo de n desviaciones estándar (-1 = off).',
  },
  {
    name: 'Typical-p',
    long: '--typical-p',
    short: null,
    aliases: ['--typical'],
    defaultValue: '1.00',
    originalDescription: 'locally typical sampling',
    category: 'Muestreo',
    description: 'Muestreo localmente típico (parámetro p). 1.0 = deshabilitado.',
  },
  {
    name: 'XTC probabilidad',
    long: '--xtc-probability',
    short: null,
    defaultValue: '0.00',
    originalDescription: 'xtc probability',
    category: 'Muestreo',
    description:
      'Probabilidad de XTC (eXclude Top Choices), que descarta el token más probable (0.0 = off).',
  },
  {
    name: 'XTC umbral',
    long: '--xtc-threshold',
    short: null,
    defaultValue: '0.10',
    originalDescription: 'xtc threshold',
    category: 'Muestreo',
    description:
      'Umbral de XTC: solo aplica XTC si el token top supera esta probabilidad (1.0 = off).',
  },
  {
    name: 'Semilla (seed)',
    long: '--seed',
    short: '-s',
    defaultValue: '-1',
    originalDescription: 'RNG seed',
    category: 'Muestreo',
    description:
      'Semilla del generador aleatorio. -1 = semilla aleatoria. Fijar la semilla hace la salida reproducible.',
  },
  {
    name: 'Secuencia de samplers',
    long: '--samplers',
    short: null,
    defaultValue: 'penalties;dry;top_n_sigma;top_k;typ_p;top_p;min_p;xtc;temperature',
    originalDescription: 'samplers used for generation in order',
    category: 'Muestreo',
    description: 'Orden (separado por ;) de los samplers aplicados durante la generación.',
  },
  {
    name: 'Seq simplificada',
    long: '--sampling-seq',
    short: null,
    aliases: ['--sampler-seq'],
    defaultValue: 'edskypmxt',
    originalDescription: 'simplified sequence for samplers',
    category: 'Muestreo',
    description: 'Secuencia simplificada de samplers (una letra por sampler).',
  },
  {
    name: 'Ventana de repetición',
    long: '--repeat-last-n',
    short: null,
    defaultValue: '64',
    originalDescription: 'last n tokens to consider for penalize',
    category: 'Muestreo',
    description:
      'Últimos N tokens considerados para penalizar repeticiones (0 = off, -1 = ctx completo).',
  },
  {
    name: 'Presence penalty',
    long: '--presence-penalty',
    short: null,
    defaultValue: '0.00',
    originalDescription: 'repeat alpha presence penalty',
    category: 'Muestreo',
    description:
      'Penalización de presencia (alpha): fomenta hablar de temas nuevos. 0.0 = deshabilitado.',
  },
  {
    name: 'Frequency penalty',
    long: '--frequency-penalty',
    short: null,
    defaultValue: '0.00',
    originalDescription: 'repeat alpha frequency penalty',
    category: 'Muestreo',
    description:
      'Penalización de frecuencia (alpha): fomenta no repetir las mismas palabras. 0.0 = deshabilitado.',
  },
  {
    name: 'DRY multiplicador',
    long: '--dry-multiplier',
    short: null,
    defaultValue: '0.00',
    originalDescription: 'set DRY sampling multiplier',
    category: 'Muestreo',
    description: 'Multiplicador del sampler DRY (anti-repetición suave). 0.0 = deshabilitado.',
  },
  {
    name: 'DRY base',
    long: '--dry-base',
    short: null,
    defaultValue: '1.75',
    originalDescription: 'set DRY sampling base value',
    category: 'Muestreo',
    description: 'Valor base del sampler DRY.',
  },
  {
    name: 'DRY longitud permitida',
    long: '--dry-allowed-length',
    short: null,
    defaultValue: '2',
    originalDescription: 'set allowed length for DRY sampling',
    category: 'Muestreo',
    description: 'Longitud permitida para el sampler DRY antes de penalizar.',
  },
  {
    name: 'DRY penalización N',
    long: '--dry-penalty-last-n',
    short: null,
    defaultValue: '-1',
    originalDescription: 'set DRY penalty for the last n tokens',
    category: 'Muestreo',
    description: 'Penalización DRY sobre los últimos N tokens (0 = off, -1 = contexto completo).',
  },
  {
    name: 'DRY sequence breaker',
    long: '--dry-sequence-breaker',
    short: null,
    defaultValue: null,
    originalDescription: 'add sequence breaker for DRY sampling',
    category: 'Muestreo',
    description:
      'Añade un sequence breaker para DRY (limpia los defaults \\n, :, ", *). Usa "none" para ninguno.',
  },
  {
    name: 'adaptive-p objetivo',
    long: '--adaptive-target',
    short: null,
    defaultValue: '-1.00',
    originalDescription: 'adaptive-p: select tokens near this probability',
    category: 'Muestreo',
    description:
      'adaptive-p: selecciona tokens cercanos a esta probabilidad (negativo = deshabilitado).',
  },
  {
    name: 'adaptive-p decaimiento',
    long: '--adaptive-decay',
    short: null,
    defaultValue: '0.90',
    originalDescription: 'adaptive-p: decay rate for target adaptation',
    category: 'Muestreo',
    description: 'adaptive-p: tasa de decaimiento de la adaptación del objetivo (0.0-0.99).',
  },
  {
    name: 'Rango temp dinámica',
    long: '--dynatemp-range',
    short: null,
    defaultValue: '0.00',
    originalDescription: 'dynamic temperature range',
    category: 'Muestreo',
    description: 'Rango de temperatura dinámica (0.0 = deshabilitado).',
  },
  {
    name: 'Exponente temp dinámica',
    long: '--dynatemp-exp',
    short: null,
    defaultValue: '1.00',
    originalDescription: 'dynamic temperature exponent',
    category: 'Muestreo',
    description: 'Exponente de la temperatura dinámica.',
  },
  {
    name: 'Mirostat',
    long: '--mirostat',
    short: null,
    defaultValue: '0',
    originalDescription: 'use Mirostat sampling',
    category: 'Muestreo',
    description:
      'Muestreo Mirostat (0 = off, 1 = Mirostat, 2 = Mirostat 2.0). Ignora top-k/top-p/typical.',
  },
  {
    name: 'Mirostat lr',
    long: '--mirostat-lr',
    short: null,
    defaultValue: '0.10',
    originalDescription: 'Mirostat learning rate',
    category: 'Muestreo',
    description: 'Tasa de aprendizaje de Mirostat (parámetro eta).',
  },
  {
    name: 'Mirostat entropía',
    long: '--mirostat-ent',
    short: null,
    defaultValue: '5.00',
    originalDescription: 'Mirostat target entropy',
    category: 'Muestreo',
    description: 'Entropía objetivo de Mirostat (parámetro tau).',
  },
  {
    name: 'Sesgo de logit',
    long: '--logit-bias',
    short: '-l',
    defaultValue: null,
    originalDescription: 'modifies the likelihood of token appearing',
    category: 'Muestreo',
    description:
      'Modifica la probabilidad de un token, p.ej. --logit-bias 15043+1 aumenta " Hello". Formato TOKEN_ID(+/-)BIAS.',
  },
  {
    name: 'Ignorar EOS',
    long: '--ignore-eos',
    short: null,
    defaultValue: null,
    originalDescription: 'ignore end of stream token and continue generating',
    category: 'Muestreo',
    description: 'Ignora el token de fin de stream y sigue generando.',
  },
  {
    name: 'Gramática (BNF)',
    long: '--grammar',
    short: null,
    defaultValue: null,
    originalDescription: 'BNF-like grammar to constrain generations',
    category: 'Muestreo',
    description: 'Gramática tipo BNF que constriñe la generación (ver ejemplos en grammars/).',
  },
  {
    name: 'Archivo de gramática',
    long: '--grammar-file',
    short: null,
    defaultValue: null,
    originalDescription: 'file to read grammar from',
    category: 'Muestreo',
    description: 'Archivo del que leer la gramática que constriñe la generación.',
  },
  {
    name: 'JSON Schema',
    long: '--json-schema',
    short: '-j',
    defaultValue: null,
    originalDescription: 'JSON schema to constrain generations',
    category: 'Muestreo',
    description:
      'JSON Schema que constriñe la generación a JSON válido (p.ej. {} para cualquier objeto).',
  },
  {
    name: 'Archivo JSON Schema',
    long: '--json-schema-file',
    short: '-jf',
    defaultValue: null,
    originalDescription: 'File containing a JSON schema',
    category: 'Muestreo',
    description: 'Archivo con un JSON Schema que constriñe la generación.',
  },
  {
    name: 'Backend sampling',
    long: '--backend-sampling',
    short: '-bs',
    defaultValue: 'disabled',
    originalDescription: 'enable backend sampling',
    category: 'Muestreo',
    description: 'Habilita el sampling en el backend (experimental).',
  },

  // ════════════════════ PARÁMETROS ESPECULATIVOS ════════════════════
  {
    name: 'Modelo borrador',
    long: '--model-draft',
    short: '-md',
    aliases: ['--spec-draft-model'],
    defaultValue: null,
    originalDescription: 'draft model for speculative decoding',
    category: 'Especulativo',
    description:
      'Modelo borrador pequeño para speculative decoding. Propone tokens que el modelo grande verifica en lote; con buena tasa de aceptación aumenta mucho los tokens/seg de generación.',
  },
  {
    name: 'Borrador HF',
    long: '--hf-repo-draft',
    short: '-hfd',
    aliases: ['--spec-draft-hf', '-hfrd'],
    defaultValue: null,
    originalDescription: 'Same as --hf-repo, but for the draft model',
    category: 'Especulativo',
    description: 'Igual que --hf-repo pero para el modelo borrador de speculative decoding.',
  },
  {
    name: 'Tokens mín. (draft)',
    long: '--spec-draft-n-min',
    short: null,
    aliases: ['--draft-min', '--draft-n-min'],
    defaultValue: '0',
    originalDescription: 'minimum number of draft tokens to use',
    category: 'Especulativo',
    description: 'Número mínimo de tokens del borrador a usar en speculative decoding.',
  },
  {
    name: 'p mínima del draft',
    long: '--draft-p-min',
    short: null,
    aliases: ['--spec-draft-p-min'],
    defaultValue: '0.00',
    originalDescription: 'minimum speculative decoding probability',
    category: 'Especulativo',
    description:
      'Probabilidad mínima aceptada (greedy) para seguir confiando en el borrador. Si un token cae por debajo, se detiene la propuesta.',
  },
  {
    name: 'Prob. split del draft',
    long: '--draft-p-split',
    short: null,
    aliases: ['--spec-draft-p-split'],
    defaultValue: '0.10',
    originalDescription: 'speculative decoding split probability',
    category: 'Especulativo',
    description: 'Probabilidad de split para speculative decoding.',
  },
  {
    name: 'Capas draft en GPU',
    long: '--n-gpu-layers-draft',
    short: '-ngld',
    aliases: ['--spec-draft-ngl', '--gpu-layers-draft'],
    defaultValue: 'auto',
    originalDescription: 'max draft model layers to store in VRAM',
    category: 'Especulativo',
    description: 'Número máximo de capas del modelo borrador en VRAM (número, auto o all).',
  },
  {
    name: 'Dispositivo del draft',
    long: '--device-draft',
    short: '-devd',
    aliases: ['--spec-draft-device'],
    defaultValue: null,
    originalDescription: 'devices to use for offloading the draft model',
    category: 'Especulativo',
    description: 'Lista de dispositivos (coma) para offload del modelo borrador.',
  },
  {
    name: 'Threads del draft',
    long: '--threads-draft',
    short: '-td',
    aliases: ['--spec-draft-threads'],
    defaultValue: 'igual que --threads',
    originalDescription: 'number of threads for draft model',
    category: 'Especulativo',
    description: 'Threads de CPU para la generación del modelo borrador.',
  },
  {
    name: 'Threads batch draft',
    long: '--threads-batch-draft',
    short: '-tbd',
    aliases: ['--spec-draft-threads-batch'],
    defaultValue: 'igual que --threads-draft',
    originalDescription: 'threads for batch processing of draft model',
    category: 'Especulativo',
    description: 'Threads de CPU para el batch/prompt del modelo borrador.',
  },
  {
    name: 'CPU mask draft',
    long: '--cpu-mask-draft',
    short: '-Cd',
    aliases: ['--spec-draft-cpu-mask'],
    defaultValue: 'igual que --cpu-mask',
    originalDescription: 'Draft model CPU affinity mask',
    category: 'Especulativo',
    description: 'Máscara de afinidad de CPU para el modelo borrador.',
  },
  {
    name: 'CPU range draft',
    long: '--cpu-range-draft',
    short: '-Crd',
    aliases: ['--spec-draft-cpu-range'],
    defaultValue: null,
    originalDescription: 'Ranges of CPUs for affinity draft',
    category: 'Especulativo',
    description: 'Rango de CPUs (lo-hi) para afinidad del modelo borrador.',
  },
  {
    name: 'CPU strict draft',
    long: '--cpu-strict-draft',
    short: null,
    aliases: ['--spec-draft-cpu-strict'],
    defaultValue: 'igual que --cpu-strict',
    originalDescription: 'Use strict CPU placement for draft model',
    category: 'Especulativo',
    description: 'Placement estricto de CPU para el modelo borrador (0|1).',
  },
  {
    name: 'Override tensor draft',
    long: '--override-tensor-draft',
    short: '-otd',
    aliases: ['--spec-draft-override-tensor'],
    defaultValue: null,
    originalDescription: 'override tensor buffer type for draft model',
    category: 'Especulativo',
    description:
      'Sobreescribe el tipo de buffer de tensores del modelo borrador (patron=buffer,...).',
  },
  {
    name: 'Backend sampling draft',
    long: '--spec-draft-backend-sampling',
    short: null,
    aliases: ['--no-spec-draft-backend-sampling'],
    defaultValue: 'enabled',
    originalDescription: 'offload draft sampling to the backend',
    category: 'Especulativo',
    description: 'Descarga el sampling del borrador al backend (default habilitado).',
  },
  {
    name: 'ngram-mod N mín.',
    long: '--spec-ngram-mod-n-min',
    short: null,
    defaultValue: '48',
    originalDescription: 'number of tokens ngram for speculative decoding ngram-mod',
    category: 'Especulativo',
    description: 'Número mínimo de tokens ngram para speculative decoding ngram-mod.',
  },
  {
    name: 'ngram-mod N máx.',
    long: '--spec-ngram-mod-n-max',
    short: null,
    defaultValue: '64',
    originalDescription: 'Number maximum of tokens ngram for speculative decoding ngram-mod',
    category: 'Especulativo',
    description: 'Número máximo de tokens ngram para speculative decoding ngram-mod.',
  },
  {
    name: 'ngram-mod lookup',
    long: '--spec-ngram-mod-n-match',
    short: null,
    defaultValue: '24',
    originalDescription: 'Length of the lookup of ngram-mod',
    category: 'Especulativo',
    description: 'Longitud del lookup de ngram-mod.',
  },
  {
    name: 'ngram-simple N',
    long: '--spec-ngram-simple-size-n',
    short: null,
    defaultValue: '12',
    originalDescription: 'Tamaño N (lookup n-gram) for ngram-simple speculative decoding',
    category: 'Especulativo',
    description: 'Tamaño N (lookup n-gram) para ngram-simple speculative decoding.',
  },
  {
    name: 'ngram-simple M',
    long: '--spec-ngram-simple-size-m',
    short: null,
    defaultValue: '48',
    originalDescription: 'Tamaño M (draft m-gram) for ngram-simple speculative decoding',
    category: 'Especulativo',
    description: 'Tamaño M (draft m-gram) para ngram-simple speculative decoding.',
  },
  {
    name: 'ngram-simple min-hits',
    long: '--spec-ngram-simple-min-hits',
    short: null,
    defaultValue: '1',
    originalDescription: 'minimum hits for ngram-simple speculative decoding',
    category: 'Especulativo',
    description: 'Número mínimo de hits para ngram-simple speculative decoding.',
  },
  {
    name: 'Cache K del draft',
    long: '--cache-type-k-draft',
    short: '-ctkd',
    aliases: ['--spec-draft-type-k'],
    defaultValue: 'f16',
    originalDescription: 'KV cache data type for K for the draft model',
    category: 'Especulativo',
    description: 'Tipo de dato de cache K para el modelo borrador (mismos valores que -ctk).',
  },
  {
    name: 'Cache V del draft',
    long: '--cache-type-v-draft',
    short: '-ctvd',
    aliases: ['--spec-draft-type-v'],
    defaultValue: 'f16',
    originalDescription: 'KV cache data type for V for the draft model',
    category: 'Especulativo',
    description: 'Tipo de dato de cache V para el modelo borrador (mismos valores que -ctv).',
  },

  // ════════════════════ PARÁMETROS DEL SERVIDOR ════════════════════
  {
    name: 'Host',
    long: '--host',
    short: null,
    defaultValue: '127.0.0.1',
    originalDescription: 'ip address to listen',
    category: 'Servidor',
    description:
      'Dirección IP donde escucha el Servidor (o socket UNIX si termina en .sock). 127.0.0.1 = solo local; 0.0.0.0 = expone a la red (solo redes de confianza).',
  },
  {
    name: 'Puerto',
    long: '--port',
    short: null,
    defaultValue: '8080',
    originalDescription: 'port to listen',
    category: 'Servidor',
    description:
      'Puerto donde escucha el Servidor HTTP (default 8080). En este proyecto el orquestador usa 3000 para no chocar con este puerto.',
  },
  {
    name: 'Timeout',
    long: '--timeout',
    short: '-to',
    defaultValue: '3600',
    originalDescription: 'server read/write timeout in seconds',
    category: 'Servidor',
    description: 'Timeout de lectura/escritura del Servidor en segundos.',
  },
  {
    name: 'Reuse port',
    long: '--reuse-port',
    short: null,
    defaultValue: 'disabled',
    originalDescription: 'allow multiple sockets to bind to the same port',
    category: 'Servidor',
    description: 'Permite a varios sockets enlazarse al mismo puerto (SO_REUSEPORT).',
  },
  {
    name: 'Path estáticos',
    long: '--path',
    short: null,
    defaultValue: null,
    originalDescription: 'path to serve static files from',
    category: 'Servidor',
    description: 'Ruta desde la que servir archivos estáticos.',
  },
  {
    name: 'API prefix',
    long: '--api-prefix',
    short: null,
    defaultValue: null,
    originalDescription: 'prefix path the server serves from',
    category: 'Servidor',
    description: 'Prefijo de ruta desde el que el Servidor sirve la API (sin barra final).',
  },
  {
    name: 'Slots (paralelismo)',
    long: '--parallel',
    short: '-np',
    defaultValue: '-1',
    originalDescription: 'number of server slots',
    category: 'Servidor',
    description:
      'Número de slots del Servidor (requests concurrentes). -1 = auto. Más de 1 habilita batching entre requests, mejorando el aprovechamiento de la GPU con varios usuarios.',
  },
  {
    name: 'Batching continuo',
    long: '--cont-batching',
    short: '-cb',
    aliases: ['--no-cont-batching', '-nocb'],
    defaultValue: 'enabled',
    originalDescription: 'continuous batching (dynamic batching)',
    category: 'Servidor',
    description:
      'Habilita batching continuo (dynamic batching): las secuencias se añaden/quitan del batch al vuelo. Necesario para servir varios usuarios con -np > 1.',
  },
  {
    name: 'Context shift',
    long: '--context-shift',
    short: null,
    aliases: ['--no-context-shift'],
    defaultValue: 'disabled',
    originalDescription: 'use context shift on infinite text generation',
    category: 'Servidor',
    description:
      'Si al llenarse el contexto se desplazan tokens viejos para hacer sitio (default deshabilitado). Útil para generación infinita; --no-context-shift desactiva el shift.',
  },
  {
    name: 'Cache de prompt',
    long: '--cache-prompt',
    short: null,
    aliases: ['--no-cache-prompt'],
    defaultValue: 'enabled',
    originalDescription: 'whether to enable prompt caching',
    category: 'Servidor',
    description: 'Habilita la caché de prompt (reutiliza el prompt ya evaluado entre requests).',
  },
  {
    name: 'KV unificado',
    long: '--kv-unified',
    short: '-kvu',
    aliases: ['--no-kv-unified', '-no-kvu'],
    defaultValue: 'auto',
    originalDescription: 'use single unified KV buffer',
    category: 'Servidor',
    description: 'Usa un único buffer KV unificado compartido entre todas las secuencias.',
  },
  {
    name: 'Cache RAM',
    long: '--cache-ram',
    short: '-cram',
    defaultValue: '8192',
    originalDescription: 'set the maximum cache size in MiB',
    category: 'Servidor',
    description: 'Tamaño máximo de caché en MiB (-1 = sin límite, 0 = deshabilitado).',
  },
  {
    name: 'Idle slots en cache',
    long: '--cache-idle-slots',
    short: null,
    aliases: ['--no-cache-idle-slots'],
    defaultValue: 'enabled',
    originalDescription: 'save idle slots to the prompt cache',
    category: 'Servidor',
    description:
      'Guarda los slots inactivos en la prompt cache al recibir una nueva tarea (requiere cache-ram).',
  },
  {
    name: 'Checkpoints de ctx',
    long: '--ctx-checkpoints',
    short: '-ctxcp',
    aliases: ['--swa-checkpoints'],
    defaultValue: '32',
    originalDescription: 'max number of context checkpoints per slot',
    category: 'Servidor',
    description: 'Número máximo de checkpoints de contexto por slot.',
  },
  {
    name: 'Paso mín. checkpoint',
    long: '--checkpoint-min-step',
    short: '-cms',
    defaultValue: '256',
    originalDescription: 'minimum spacing between context checkpoints',
    category: 'Servidor',
    description: 'Espaciado mínimo entre checkpoints de contexto en tokens (0 = sin mínimo).',
  },
  {
    name: 'Plantilla de chat',
    long: '--chat-template',
    short: null,
    defaultValue: null,
    originalDescription: 'set custom jinja chat template',
    category: 'Servidor',
    description:
      'Sobreescribe la plantilla de chat Jinja (chatml, llama2, llama3, …). Útil cuando el GGUF no trae la plantilla correcta o se quiere forzar un formato.',
  },
  {
    name: 'Archivo plantilla chat',
    long: '--chat-template-file',
    short: null,
    defaultValue: null,
    originalDescription: 'set custom jinja chat template file',
    category: 'Servidor',
    description: 'Archivo con la plantilla de chat Jinja personalizada.',
  },
  {
    name: 'Reasoning (thinking)',
    long: '--reasoning',
    short: '-rea',
    defaultValue: 'auto',
    originalDescription: 'Use reasoning/thinking in the chat',
    category: 'Servidor',
    description:
      'Controla el razonamiento/thinking en el chat (on/off/auto, default auto = detectar de la plantilla).',
  },
  {
    name: 'Formato de reasoning',
    long: '--reasoning-format',
    short: null,
    defaultValue: 'auto',
    originalDescription: 'controls whether thought tags are extracted',
    category: 'Servidor',
    description:
      'Controla cómo se manejan las etiquetas de pensamiento: none (sin parsear), deepseek (en reasoning_content), deepseek-legacy (conserva  ImGui_).',
  },
  {
    name: 'Presupuesto reasoning',
    long: '--reasoning-budget',
    short: null,
    defaultValue: '-1',
    originalDescription: 'token budget for thinking',
    category: 'Servidor',
    description:
      'Presupuesto de tokens para pensar: -1 sin límite, 0 fin inmediato, N>0 presupuesto.',
  },
  {
    name: 'Mensaje fin reasoning',
    long: '--reasoning-budget-message',
    short: null,
    defaultValue: null,
    originalDescription: 'message injected when reasoning budget is exhausted',
    category: 'Servidor',
    description:
      'Mensaje inyectado antes del tag de fin de pensamiento cuando se agota el presupuesto.',
  },
  {
    name: 'Skip chat parsing',
    long: '--skip-chat-parsing',
    short: null,
    aliases: ['--no-skip-chat-parsing'],
    defaultValue: 'disabled',
    originalDescription: 'force a pure content parser',
    category: 'Servidor',
    description:
      'Fuerza un parser de contenido puro: el modelo saca todo en content (reasoning + tools).',
  },
  {
    name: 'Prefill assistant',
    long: '--prefill-assistant',
    short: null,
    aliases: ['--no-prefill-assistant'],
    defaultValue: 'enabled',
    originalDescription: "whether to prefill the assistant's response",
    category: 'Servidor',
    description:
      'Si el último mensaje es del asistente, lo trata como prefill de su respuesta (en vez de mensaje completo).',
  },
  {
    name: 'Proyector multimodal',
    long: '--mmproj',
    short: '-mm',
    defaultValue: null,
    originalDescription: 'path to a multimodal projector file',
    category: 'Servidor',
    description:
      'Ruta al archivo del proyector multimodal (visión). Con -hf se omite si existe. Necesario para modelos que aceptan imágenes (LLaVA, etc.).',
  },
  {
    name: 'URL del mmproj',
    long: '--mmproj-url',
    short: '-mmu',
    defaultValue: null,
    originalDescription: 'URL to a multimodal projector file',
    category: 'Servidor',
    description: 'URL del archivo del proyector multimodal.',
  },
  {
    name: 'Offload del mmproj',
    long: '--mmproj-offload',
    short: null,
    aliases: ['--no-mmproj-offload'],
    defaultValue: 'enabled',
    originalDescription: 'GPU offloading for multimodal projector',
    category: 'Servidor',
    description: 'Habilita el offload a GPU del proyector multimodal.',
  },
  {
    name: 'Tokens mín. imagen',
    long: '--image-min-tokens',
    short: null,
    defaultValue: null,
    originalDescription: 'minimum number of tokens each image can take',
    category: 'Servidor',
    description:
      'Número mínimo de tokens que ocupa cada imagen (modelos de visión con resolución dinámica).',
  },
  {
    name: 'Tokens máx. imagen',
    long: '--image-max-tokens',
    short: null,
    defaultValue: null,
    originalDescription: 'maximum number of tokens each image can take',
    category: 'Servidor',
    description:
      'Número máximo de tokens que ocupa cada imagen (modelos de visión con resolución dinámica).',
  },
  {
    name: 'Embeddings',
    long: '--embeddings',
    short: null,
    aliases: ['--embedding'],
    defaultValue: 'disabled',
    originalDescription: 'restrict to only support embedding use case',
    category: 'Servidor',
    description:
      'Restringe el Servidor a solo soportar el caso de uso de embeddings (modelos dedicados).',
  },
  {
    name: 'Reranking',
    long: '--reranking',
    short: null,
    aliases: ['--rerank'],
    defaultValue: 'disabled',
    originalDescription: 'enable reranking endpoint on server',
    category: 'Servidor',
    description: 'Habilita el endpoint de reranking en el Servidor.',
  },
  {
    name: 'Pooling',
    long: '--pooling',
    short: null,
    defaultValue: null,
    originalDescription: 'pooling type for embeddings',
    category: 'Servidor',
    description:
      'Tipo de pooling para embeddings: none, mean, cls, last o rank. Si no se indica, el del modelo.',
  },
  {
    name: 'Normalización embeddings',
    long: '--embd-normalize',
    short: null,
    defaultValue: '2',
    originalDescription: 'normalisation for embeddings',
    category: 'Servidor',
    description:
      'Normalización de embeddings (-1 ninguna, 0 max abs int16, 1 taxicab, 2 euclidean, >2 p-norm).',
  },
  {
    name: 'API key',
    long: '--api-key',
    short: null,
    defaultValue: null,
    originalDescription: 'API key to use for authentication',
    category: 'Servidor',
    description: 'API key de autenticación (varias separadas por coma). Por defecto ninguna.',
  },
  {
    name: 'Archivo API keys',
    long: '--api-key-file',
    short: null,
    defaultValue: null,
    originalDescription: 'path to file containing API keys',
    category: 'Servidor',
    description: 'Archivo con las API keys (una por línea).',
  },
  {
    name: 'Archivo SSL key',
    long: '--ssl-key-file',
    short: null,
    defaultValue: null,
    originalDescription: 'path to a PEM-encoded SSL private key',
    category: 'Servidor',
    description: 'Ruta a la clave privada SSL codificada en PEM.',
  },
  {
    name: 'Archivo SSL cert',
    long: '--ssl-cert-file',
    short: null,
    defaultValue: null,
    originalDescription: 'path to a PEM-encoded SSL certificate',
    category: 'Servidor',
    description: 'Ruta al certificado SSL codificado en PEM.',
  },
  {
    name: 'SSE ping interval',
    long: '--sse-ping-interval',
    short: null,
    defaultValue: '30',
    originalDescription: 'server SSE ping interval in seconds',
    category: 'Servidor',
    description: 'Intervalo (segundos) de los pings SSE del Servidor (-1 = deshabilitado).',
  },
  {
    name: 'Web UI',
    long: '--ui',
    short: null,
    aliases: ['--no-ui', '--webui', '--no-webui'],
    defaultValue: 'enabled',
    originalDescription: 'whether to enable the Web UI',
    category: 'Servidor',
    description: 'Habilita (o --no-ui deshabilita) la Web UI integrada.',
  },
  {
    name: 'UI config (JSON)',
    long: '--ui-config',
    short: null,
    defaultValue: null,
    originalDescription: 'JSON that provides default UI settings',
    category: 'Servidor',
    description: 'JSON con ajustes por defecto de la UI (sobreescribe los defaults).',
  },
  {
    name: 'UI config (archivo)',
    long: '--ui-config-file',
    short: null,
    defaultValue: null,
    originalDescription: 'JSON file that provides default UI settings',
    category: 'Servidor',
    description: 'Archivo JSON con ajustes por defecto de la UI.',
  },
  {
    name: 'MCP CORS proxy',
    long: '--ui-mcp-proxy',
    short: null,
    aliases: ['--no-ui-mcp-proxy', '--webui-mcp-proxy', '--no-webui-mcp-proxy'],
    defaultValue: 'disabled',
    originalDescription: 'enable MCP CORS proxy - do not enable in untrusted environments',
    category: 'Servidor',
    description:
      'Experimental: habilita el proxy CORS de MCP (no activar en entornos no confiables).',
  },
  {
    name: 'Tools (agentes)',
    long: '--tools',
    short: null,
    defaultValue: null,
    originalDescription: 'enable built-in tools for AI agents',
    category: 'Servidor',
    description:
      'Experimental: herramientas integradas para agentes (read_file, grep_search, exec_shell_command, …). "all" habilita todas. No activar en entornos no confiables.',
  },
  {
    name: 'Endpoint /props',
    long: '--props',
    short: null,
    defaultValue: 'disabled',
    originalDescription: 'enable changing global properties via POST /props',
    category: 'Servidor',
    description: 'Permite cambiar propiedades globales vía POST /props.',
  },
  {
    name: 'Endpoint /slots',
    long: '--slots',
    short: null,
    aliases: ['--no-slots'],
    defaultValue: 'enabled',
    originalDescription: 'expose slots monitoring endpoint',
    category: 'Servidor',
    description: 'Expone el endpoint de monitorización de slots.',
  },
  {
    name: 'Path guardar slots',
    long: '--slot-save-path',
    short: null,
    defaultValue: null,
    originalDescription: 'path to save slot kv cache',
    category: 'Servidor',
    description: 'Ruta donde guardar la cache KV de los slots (default deshabilitado).',
  },
  {
    name: 'Media path',
    long: '--media-path',
    short: null,
    defaultValue: null,
    originalDescription: 'directory for loading local media files',
    category: 'Servidor',
    description:
      'Directorio para cargar archivos multimedia locales (accesibles vía file:// relativo).',
  },
  {
    name: 'Alias del modelo',
    long: '--alias',
    short: '-a',
    defaultValue: null,
    originalDescription: 'set model name aliases',
    category: 'Servidor',
    description: 'Alias del nombre del modelo (separados por coma), usado por la API.',
  },
  {
    name: 'Tags del modelo',
    long: '--tags',
    short: null,
    defaultValue: null,
    originalDescription: 'set model tags (informational)',
    category: 'Servidor',
    description: 'Tags del modelo (separados por coma), informativos (no se usan para routing).',
  },
  {
    name: 'Dir de modelos (router)',
    long: '--models-dir',
    short: null,
    defaultValue: null,
    originalDescription: 'directory containing models for the router server',
    category: 'Servidor',
    description: 'Directorio con los modelos para el router server.',
  },
  {
    name: 'Preset de modelos (router)',
    long: '--models-preset',
    short: null,
    defaultValue: null,
    originalDescription: 'INI file containing model presets',
    category: 'Servidor',
    description: 'Ruta a un archivo INI con presets de modelos para el router server.',
  },
  {
    name: 'Modelos máx. (router)',
    long: '--models-max',
    short: null,
    defaultValue: '4',
    originalDescription: 'maximum number of models to load simultaneously',
    category: 'Servidor',
    description:
      'Para el router server, número máximo de modelos cargados a la vez (0 = ilimitado).',
  },
  {
    name: 'Autoload modelos (router)',
    long: '--models-autoload',
    short: null,
    aliases: ['--no-models-autoload'],
    defaultValue: 'enabled',
    originalDescription: 'automatically load models',
    category: 'Servidor',
    description: 'Para el router server, carga modelos automáticamente.',
  },
  {
    name: 'Warmup',
    long: '--warmup',
    short: null,
    aliases: ['--no-warmup'],
    defaultValue: 'enabled',
    originalDescription: 'perform warmup with an empty run',
    category: 'Servidor',
    description: 'Realiza un run vacío de calentamiento al iniciar.',
  },
  {
    name: 'Reverse Prompt',
    long: '--reverse-prompt',
    short: '-r',
    defaultValue: null,
    originalDescription: 'halt generation at PROMPT',
    category: 'Servidor',
    description: 'Detiene la generación al hallar PROMPT y devuelve el control (modo interactivo).',
  },
  {
    name: 'Tokens especiales',
    long: '--special',
    short: '-sp',
    defaultValue: 'false',
    originalDescription: 'special tokens output enabled',
    category: 'Servidor',
    description: 'Habilita la salida de tokens especiales.',
  },
  {
    name: 'SPM infill',
    long: '--spm-infill',
    short: null,
    defaultValue: 'disabled',
    originalDescription: 'use Suffix/Prefix/Middle pattern for infill',
    category: 'Servidor',
    description: 'Usa el patrón Suffix/Prefix/Middle para infill (algunos modelos lo prefieren).',
  },
  {
    name: 'Similaridad de slot',
    long: '--slot-prompt-similarity',
    short: '-sps',
    defaultValue: '0.10',
    originalDescription: 'how much prompt must match to use that slot',
    category: 'Servidor',
    description:
      'Cuánto debe coincidir el prompt de un request con el de un slot para reutilizarlo (0.0 = off).',
  },
  {
    name: 'LoRA init sin aplicar',
    long: '--lora-init-without-apply',
    short: null,
    defaultValue: 'disabled',
    originalDescription: 'load LoRA adapters without applying them',
    category: 'Servidor',
    description:
      'Carga los adaptadores LoRA sin aplicarlos (se aplican luego vía POST /lora-adapters).',
  },
  {
    name: 'Sleep si idle',
    long: '--sleep-idle-seconds',
    short: null,
    defaultValue: '-1',
    originalDescription: 'number of seconds of idleness after which server will sleep',
    category: 'Servidor',
    description:
      'Segundos de inactividad tras los que el Servidor entra en sleep (-1 = deshabilitado).',
  },
  {
    name: 'Dir log de prompts',
    long: '--log-prompts-dir',
    short: null,
    defaultValue: null,
    originalDescription: 'Log prompts to directory',
    category: 'Servidor',
    description: 'Directorio donde loguear los prompts (solo para depuración).',
  },
  {
    name: 'Vocoder (audio)',
    long: '--model-vocoder',
    short: '-mv',
    defaultValue: null,
    originalDescription: 'vocoder model for audio generation',
    category: 'Servidor',
    description: 'Modelo vocoder para generación de audio.',
  },
  {
    name: 'TTS guide tokens',
    long: '--tts-use-guide-tokens',
    short: null,
    defaultValue: null,
    originalDescription: 'Use guide tokens to improve TTS word recall',
    category: 'Servidor',
    description: 'Usa guide tokens para mejorar el recall de palabras en TTS.',
  },
  {
    name: 'Cache lookup estática',
    long: '--lookup-cache-static',
    short: '-lcs',
    defaultValue: null,
    originalDescription: 'path to static lookup cache',
    category: 'Servidor',
    description: 'Ruta a la cache de lookup estática (no se actualiza al generar).',
  },
  {
    name: 'Cache lookup dinámica',
    long: '--lookup-cache-dynamic',
    short: '-lcd',
    defaultValue: null,
    originalDescription: 'path to dynamic lookup cache',
    category: 'Servidor',
    description: 'Ruta a la cache de lookup dinámica (se actualiza al generar).',
  },
  // ── Flags que estaban en Común pero son raramente usadas ──
  {
    name: 'Cache SWA completa',
    long: '--swa-full',
    short: null,
    defaultValue: 'false',
    originalDescription: 'use full-size SWA cache',
    category: 'Servidor',
    description:
      'Usa una cache Sliding Window Attention de tamaño completo (en vez de la parcial). Aumenta el consumo de VRAM pero evita recomputar la ventana deslizante.',
  },
  {
    name: 'Métricas de rendimiento',
    long: '--perf',
    short: null,
    aliases: ['--no-perf'],
    defaultValue: 'false',
    originalDescription: 'whether to enable internal libllama performance timings',
    category: 'Servidor',
    description:
      'Habilita (o --no-perf deshabilita) los timings internos de libllama. Las métricas que parsea este proyecto provienen de esa salida de rendimiento.',
  },
  {
    name: 'Procesar escapes',
    long: '--escape',
    short: '-e',
    aliases: ['--no-escape'],
    defaultValue: 'true',
    originalDescription: 'whether to process escapes sequences',
    category: 'Servidor',
    description:
      'Si se procesan secuencias de escape (\\n, \\r, \\t, \\\', \\", \\\\) en los prompts. --no-escape los trata literalmente.',
  },
  {
    name: 'Offload de cache KV',
    long: '--kv-offload',
    short: '-kvo',
    aliases: ['--no-kv-offload', '-nkvo'],
    defaultValue: 'enabled',
    originalDescription: 'whether to enable KV cache offloading',
    category: 'Servidor',
    description:
      'Habilita el offload de la cache KV a la GPU (--no-kv-offload lo desactiva). Mantenerlo activo mejora la velocidad; desactivarlo libera VRAM a costa de latency.',
  },
  {
    name: 'Umbral de defragmentación KV',
    long: '--defrag-thold',
    short: '-dt',
    defaultValue: null,
    originalDescription: 'KV cache defragmentation threshold (DEPRECATED)',
    category: 'Servidor',
    description:
      '[DEPRECATED] Umbral de defragmentación de la cache KV. Mantenido por compatibilidad.',
  },
  {
    name: 'RoPE scaling',
    long: '--rope-scaling',
    short: null,
    defaultValue: 'linear',
    originalDescription: 'RoPE frequency scaling method',
    category: 'Servidor',
    description:
      'Método de escalado de RoPE: none, linear o yarn. Permite extender el contexto más allá del entrenamiento del modelo. yarn (Yet another RoPE extensioN) es Común para contextos muy largos.',
  },
  {
    name: 'Factor RoPE scale',
    long: '--rope-scale',
    short: null,
    defaultValue: null,
    originalDescription: 'RoPE context scaling factor',
    category: 'Servidor',
    description: 'Factor de escalado de contexto RoPE: expande el contexto en un factor N.',
  },
  {
    name: 'Frecuencia base RoPE',
    long: '--rope-freq-base',
    short: null,
    defaultValue: null,
    originalDescription: 'RoPE base frequency, used by NTK-aware scaling',
    category: 'Servidor',
    description:
      'Frecuencia base de RoPE, usada por el escalado NTK-aware. Por defecto se lee del modelo.',
  },
  {
    name: 'Factor de escala RoPE',
    long: '--rope-freq-scale',
    short: null,
    defaultValue: null,
    originalDescription: 'RoPE frequency scaling factor',
    category: 'Servidor',
    description: 'Factor de escala de frecuencia RoPE: expande el contexto en un factor 1/N.',
  },
  {
    name: 'YaRN ctx original',
    long: '--yarn-orig-ctx',
    short: null,
    defaultValue: '0',
    originalDescription: 'YaRN: original context size of model',
    category: 'Servidor',
    description: 'YaRN: tamaño de contexto original del modelo (0 = contexto de entrenamiento).',
  },
  {
    name: 'YaRN factor extrapolación',
    long: '--yarn-ext-factor',
    short: null,
    defaultValue: '-1.00',
    originalDescription: 'YaRN: extrapolation mix factor',
    category: 'Servidor',
    description: 'YaRN: factor de mezcla de extrapolación (0.0 = interpolación completa).',
  },
  {
    name: 'YaRN factor atención',
    long: '--yarn-attn-factor',
    short: null,
    defaultValue: '-1.00',
    originalDescription: 'YaRN: scale sqrt(t) or attention magnitude',
    category: 'Servidor',
    description: 'YaRN: escala de la magnitud de atención sqrt(t).',
  },
  {
    name: 'Override de tensor',
    long: '--override-tensor',
    short: '-ot',
    defaultValue: null,
    originalDescription: 'override tensor buffer type',
    category: 'Servidor',
    description:
      'Sobreescribe el tipo de buffer de un tensor por patrón (formato patron=buffer,...).',
  },
  {
    name: 'Ajustar a memoria (fit)',
    long: '--fit',
    short: '-fit',
    defaultValue: 'on',
    originalDescription: 'whether to adjust unset arguments to fit in device memory',
    category: 'Servidor',
    description:
      'Ajusta argumentos sin definir (p.ej. ctx-size) para que el modelo quepa en la memoria del dispositivo (on/off).',
  },
  {
    name: 'Margen objetivo fit',
    long: '--fit-target',
    short: '-fitt',
    defaultValue: '1024',
    originalDescription: 'target margin per device for --fit',
    category: 'Servidor',
    description: 'Margen objetivo por dispositivo (MiB) para --fit. Valor único se aplica a todos.',
  },
  {
    name: 'ctx mínimo del fit',
    long: '--fit-ctx',
    short: '-fitc',
    defaultValue: '4096',
    originalDescription: 'minimum ctx size that can be set by --fit',
    category: 'Servidor',
    description: 'Tamaño mínimo de ctx que --fit puede asignar.',
  },
  {
    name: 'Verificar tensores',
    long: '--check-tensors',
    short: null,
    defaultValue: 'false',
    originalDescription: 'check model tensor data for invalid values',
    category: 'Servidor',
    description: 'Comprueba los datos de los tensores del modelo en busca de valores inválidos.',
  },
  {
    name: 'Override de metadatos',
    long: '--override-kv',
    short: null,
    defaultValue: null,
    originalDescription: 'advanced option to override model metadata by key',
    category: 'Servidor',
    description:
      'Sobreescribe metadatos del modelo por clave (KEY=TYPE:VALUE,...). Tipos: int, float, bool, str.',
  },
  {
    name: 'Offload de ops host',
    long: '--op-offload',
    short: null,
    aliases: ['--no-op-offload'],
    defaultValue: 'true',
    originalDescription: 'whether to offload host tensor operations to device',
    category: 'Servidor',
    description: 'Si las operaciones de tensor en host se descargan al dispositivo (default true).',
  },
  {
    name: 'Direct I/O',
    long: '--direct-io',
    short: '-dio',
    aliases: ['--no-direct-io', '-ndio'],
    defaultValue: 'disabled',
    originalDescription: 'use DirectIO if available',
    category: 'Servidor',
    description: 'Usa DirectIO si está disponible (elude la page cache del SO al cargar).',
  },
  {
    name: 'Optimización NUMA',
    long: '--numa',
    short: null,
    defaultValue: null,
    originalDescription: 'attempt optimizations that help on some NUMA systems',
    category: 'Servidor',
    description:
      'Optimizaciones para sistemas NUMA: distribute (reparto uniforme), isolate (solo nodo local) o numactl (mapa de numactl). Recomendado vaciar la page cache antes de usarlo.',
  },
  {
    name: 'LoRA',
    long: '--lora',
    short: null,
    defaultValue: null,
    originalDescription: 'path to LoRA adapter',
    category: 'Servidor',
    description: 'Ruta a un adaptador LoRA (separar por coma para cargar varios).',
  },
  {
    name: 'LoRA con escala',
    long: '--lora-scaled',
    short: null,
    defaultValue: null,
    originalDescription: 'path to LoRA adapter with user defined scaling',
    category: 'Servidor',
    description: 'Adaptador LoRA con escala definida por el usuario (formato FNAME:SCALE,...).',
  },
  {
    name: 'Vector de control',
    long: '--control-vector',
    short: null,
    defaultValue: null,
    originalDescription: 'add a control vector',
    category: 'Servidor',
    description: 'Añade un vector de control (separar por coma para varios).',
  },
  {
    name: 'Vector de control escalado',
    long: '--control-vector-scaled',
    short: null,
    defaultValue: null,
    originalDescription: 'add a control vector with user defined scaling',
    category: 'Servidor',
    description: 'Vector de control con escala (formato FNAME:SCALE,...).',
  },
  {
    name: 'Rango de capas vector control',
    long: '--control-vector-layer-range',
    short: null,
    defaultValue: null,
    originalDescription: 'layer range to apply control vector(s)',
    category: 'Servidor',
    description: 'Rango de capas al que aplicar los vectores de control (START END, inclusivo).',
  },
  {
    name: 'Máscara CPU',
    long: '--cpu-mask',
    short: '-C',
    defaultValue: '""',
    originalDescription: 'CPU affinity mask: arbitrarily long hex',
    category: 'Servidor',
    description:
      'Máscara de afinidad de CPU en hex (arbitrariamente larga). Complementa --cpu-range.',
  },
  {
    name: 'Rango de CPU',
    long: '--cpu-range',
    short: '-Cr',
    defaultValue: null,
    originalDescription: 'range of CPUs for affinity',
    category: 'Servidor',
    description: 'Rango de CPUs para afinidad (formato lo-hi). Complementa --cpu-mask.',
  },
  {
    name: 'CPU estricto',
    long: '--cpu-strict',
    short: null,
    defaultValue: '0',
    originalDescription: 'use strict CPU placement',
    category: 'Servidor',
    description: 'Usa placement estricto de CPU (0|1).',
  },
  {
    name: 'Prioridad proceso',
    long: '--prio',
    short: null,
    defaultValue: '0',
    originalDescription: 'set process/thread priority: low(-1) to realtime(3)',
    category: 'Servidor',
    description:
      'Prioridad del proceso/thread: low(-1), normal(0), medium(1), high(2), realtime(3).',
  },
  {
    name: 'Polling',
    long: '--poll',
    short: null,
    defaultValue: '50',
    originalDescription: 'use polling level to wait for work',
    category: 'Servidor',
    description: 'Nivel de polling para esperar trabajo (0 = sin polling, 0-100).',
  },
  {
    name: 'Repack de pesos',
    long: '--repack',
    short: null,
    aliases: ['--no-repack', '-nr'],
    defaultValue: 'enabled',
    originalDescription: 'whether to enable weight repacking',
    category: 'Servidor',
    description: 'Habilita (o --no-repack deshabilita) el repacking de pesos durante la carga.',
  },
  {
    name: 'Sin buffer host',
    long: '--no-host',
    short: null,
    defaultValue: null,
    originalDescription: 'bypass host buffer allowing extra buffers to be used',
    category: 'Servidor',
    description: 'Omite el buffer host permitiendo usar buffers extra.',
  },
  {
    name: 'Verbose (logging)',
    long: '--verbose',
    short: '-v',
    aliases: ['--log-verbose'],
    defaultValue: null,
    originalDescription: 'Set verbosity level to infinity',
    category: 'Servidor',
    description:
      'Sube el nivel de verbosity al máximo (log de todos los mensajes, útil para depurar). Las métricas que parsea este proyecto salen del output verbose.',
  },
  {
    name: 'Umbral de verbosity',
    long: '--verbosity',
    short: '-lv',
    aliases: ['--log-verbosity'],
    defaultValue: '3',
    originalDescription: 'Set the verbosity threshold',
    category: 'Servidor',
    description:
      'Umbral de verbosity (0 genérico, 1 error, 2 warning, 3 info, 4 trace, 5 debug). Se ignoran los mensajes de verbosity mayor.',
  },
  {
    name: 'Log a archivo',
    long: '--log-file',
    short: null,
    defaultValue: null,
    originalDescription: 'Log to file',
    category: 'Servidor',
    description: 'Redirige el log a un archivo en vez de a stdout.',
  },
  {
    name: 'Log con colores',
    long: '--log-colors',
    short: null,
    defaultValue: 'auto',
    originalDescription: 'Set colored logging',
    category: 'Servidor',
    description: 'Logging coloreado (on/off/auto). "auto" lo activa si la salida es una terminal.',
  },
  {
    name: 'Timestamps de log',
    long: '--log-timestamps',
    short: null,
    aliases: ['--no-log-timestamps'],
    defaultValue: null,
    originalDescription: 'Enable timestamps in log messages',
    category: 'Servidor',
    description: 'Habilita (o desactiva) las marcas de tiempo en los mensajes de log.',
  },
  {
    name: 'Deshabilitar log',
    long: '--log-disable',
    short: null,
    defaultValue: null,
    originalDescription: 'Log disable',
    category: 'Servidor',
    description: 'Deshabilita el logging por completo.',
  },
  {
    name: 'Modo offline',
    long: '--offline',
    short: null,
    defaultValue: null,
    originalDescription: 'Offline mode: forces use of cache',
    category: 'Servidor',
    description: 'Modo offline: fuerza el uso de caché e impide el acceso a la red.',
  },
  {
    name: 'Versión',
    long: '--version',
    short: null,
    defaultValue: null,
    originalDescription: 'show version and build info',
    category: 'Servidor',
    description: 'Muestra la versión e info de build y termina.',
  },
  {
    name: 'Ayuda',
    long: '--help',
    short: '-h',
    aliases: ['--usage'],
    defaultValue: null,
    originalDescription: 'print usage and exit',
    category: 'Servidor',
    description: 'Imprime el uso y termina.',
  },
  {
    name: 'Completado bash',
    long: '--completion-bash',
    short: null,
    defaultValue: null,
    originalDescription: 'print source-able bash completion script for llama.cpp',
    category: 'Servidor',
    description: 'Imprime un script de completado bash cargable para llama.cpp.',
  },
  {
    name: 'Listar cache',
    long: '--cache-list',
    short: '-cl',
    defaultValue: null,
    originalDescription: 'show list of models in cache',
    category: 'Servidor',
    description: 'Muestra la lista de modelos en caché y termina.',
  },
];

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
  const tokens = script.split(/\s+/).filter(Boolean);
  if (!tokens.length) return ['./llama-server'];
  const pieces: string[] = [tokens[0]];
  for (let i = 1; i < tokens.length; i++) {
    const tok = tokens[i];
    if (tok.startsWith('-')) {
      const next = tokens[i + 1];
      if (next && !next.startsWith('-')) {
        pieces.push(`${tok} ${next}`);
        i++;
      } else {
        pieces.push(tok);
      }
    } else {
      // Valor suelto sin flag previo (raro): lo dejamos como pieza propia.
      pieces.push(tok);
    }
  }
  return pieces;
}

/** Aplana un script: quita `\` de continuación de línea, deja todo en una línea. */
function flattenScript(script: string): string {
  return script
    .replace(/\\\r?\n/g, ' ')
    .replace(/\\/g, '')
    .trim();
}

/** Todas las formas reconocidas de un flag (larga + corta + aliases). */
export function flagForms(flag: LlamaFlag): string[] {
  return [flag.long, flag.short, ...(flag.aliases ?? [])].filter(Boolean) as string[];
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
  const pieces = tokenizeIntoPieces(flattenScript(script));
  const cmd = pieces[0];
  const rest = pieces.slice(1);

  const forms = flagForms(flag);
  // ¿Ya está presente el flag (en cualquier pieza, como primer token)?
  const exists = rest.some((p) => forms.includes(p.split(/\s+/)[0]));
  if (exists) {
    return { script: joinPieces(cmd, rest), added: false };
  }

  const value = flag.defaultValue;
  const piece = value && value !== '' ? `${flag.long} ${value}` : flag.long;
  rest.push(piece);
  return { script: joinPieces(cmd, rest), added: true };
}

/** Reconstruye el script con `\` de continuación, una pieza por línea. */
function joinPieces(cmd: string, pieces: string[]): string {
  return [cmd, ...pieces].join(' \\\n');
}
