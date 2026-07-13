# AGENTS.md

## Project Overview

**llama-bench** — a benchmarking tool for `llama-server`. Starts the server, runs inference prompts, parses timing metrics from logs, captures GPU/device/RAM stats, and persists results. Spanish-language UI.

- **Backend**: `src/server.ts` — Bun HTTP server modular (TypeScript, stdlib only). Código dividido por funcionalidad en `src/`. Expone solo la **API JSON** (ya no sirve frontend).
- **Frontend**: `front/` — Angular 22 + PrimeNG 21 (standalone, signals). App aparte, servida por `ng serve` en dev. Habla con el backend por HTTP (CORS `*`).
- **Runtime**: Bun, managed via `mise.toml` (`mise install` o `mise up`).
- **External binary**: `llama-server` (not bundled; must exist on disk).

> La migración eliminó el frontend vanilla anterior (`src/front/app.ts`, `public/`).
> Ahora el backend es una API pura y el frontend vive en `front/` (Angular).

---

## Essential Commands

Ejecutados desde la **raíz** del repo (que orquesta backend + frontend juntos):

| Command               | Purpose                                                                                                                |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `mise install`        | Install Bun via mise version manager                                                                                   |
| `bun install`         | Instala deps de la raíz (incl. `concurrently`)                                                                         |
| `bun run dev`         | **Dev conjunto**: arranca backend (`:3000`) + frontend (`:4242`) con `concurrently` (con `--watch`); Ctrl+C mata ambos |
| `bun run dev:back`    | Solo backend con `--watch`                                                                                             |
| `bun run dev:front`   | Solo frontend Angular (`ng serve`)                                                                                     |
| `bun run start`       | Producción: `bun src/server.ts`                                                                                        |
| `bun run build:front` | Build de producción del frontend Angular (`ng build`) → `front/dist/`                                                  |
| `bun run typecheck`   | `tsc --noEmit` del backend                                                                                             |
| `bun run fix`         | Formatea todo con `prettier`                                                                                           |

Dentro de `front/` (directorio del frontend Angular) también aplican los scripts
`ng` habituales (`start`, `build`, `watch`, `test`) — ver `front/package.json`.

---

## Architecture

### Estructura del proyecto

```
src/                        # Backend (Bun, API pura)
  server.ts                 # Entry point: Bun.serve + bootstrap + shutdown handlers
  config.ts                 # Constantes de entorno (PORT, DATA_DIR, HISTORY_FILE, caps…)
  state.ts                  # Estado global mutable (managed, status, logBuffer, …) + setters
  types.ts                  # Interfaces del dominio (BenchmarkResult, GpuInfo, ParsedScript, TunedParams, ModelMeta…)
  logs.ts                   # Buffer de logs: pushLog, systemLog, getLogBuffer
  script-parser.ts          # Tokenizado y parseo del script de shell (tokenizeScript, parseScript, hasFlag)
  server-manager.ts         # Gestión del proceso llama-server (startServer, stopServer, urlFor)
  gpu.ts                    # Métricas de GPU NVIDIA (nvidia-smi) + AMD (sysfs)
  mem.ts                    # Métricas de RAM del sistema (/proc/meminfo)
  devices.ts                # Enumeración de devices del backend (--list-devices) + detección
  metrics.ts                # Parsing de métricas desde logs + health-check + utilidades
  benchmark.ts              # Orquestador del benchmark completo (runBenchmark, finalize)
  history.ts                # Persistencia del historial (loadHistory, saveResult, …)
  optimizer.ts              # Heurística de VRAM + parser del header GGUF + resolución de archivo (-hf/--model)
  router.ts                 # HTTP request handler: path matching + CORS (solo API JSON)
  shutdown.ts               # Cierre ordenado ante signals (SIGINT/SIGTERM/SIGHUP)
data/                       # Datos locales (gitignored)
  history.json              # Resultados de benchmarks
  script-default.txt        # Script por defecto guardado desde la UI
  prompt-default.txt        # Prompt por defecto guardado desde la UI
front/                      # Frontend (Angular 22 + PrimeNG 21)
  src/app/
    app.config.ts           # Providers: PrimeNG (preset Noir), HttpClient, Router
    app.routes.ts           # Ruta '' → Home (lazy)
    app.ts / app.html       # Shell: header + p-toast + p-confirmdialog + router-outlet
    core/
      models/types.ts       # Interfaces espejo del backend (ParsedScript, TunedParams, ModelMeta, EstimateResponse…)
      services/             # api.service (HttpClient), llama-bench.service, storage.service
      state/bench.store.ts  # Estado global con signals + actions + effects
      data/llama-flags.ts   # Catálogo estático de ~270 flags de llama-server (categorias, defaults, descripciones)
      utils/
        format.ts           # Fn puras de formato (fmt, fmtGB, parseModel, deviceVramLine…)
        flag-writer.ts      # Reescritura de flags en el script (applyTunedParams, parseParamsFromScript)
        vram-estimate.ts    # Heurística client-side de VRAM (estimateVramMiB, buildBreakdown, recommendParams)
        pipes.ts            # Pipes de Angular
    features/               # Componentes standalone (uno por sección):
      home/, status-bar/, script-editor/, benchmark-panel/,
      gpu-grid/, logs-viewer/, response-card/, last-result/,
      history-table/, compare-modal/, chart-modal/,
      optimizer-modal/      # Diálogo optimizador de parámetros (sliders, barras, heurística en vivo)
```

> Mandates del frontend en `front/AGENTS.md`: `inject()`,
> `input()/output()/computed()`, control flow nativo (`@if/@for`),
> `class`/`style` bindings (sin `ngClass`/`ngStyle`), archivos sin sufijo
> `.component`, lazy loading de rutas.

### Backend (`src/server.ts` + módulos en `src/`)

Servidor HTTP modular sin frameworks. `src/server.ts` es el entry point:
inicializa el historial, registra los handlers de shutdown y arranca
`Bun.serve` con el router. El router (`src/router.ts`) despacha requests de la
**API JSON** a los módulos correspondientes. **No sirve archivos estáticos ni
bundle de frontend** (eso se hizo en la versión anterior con `Bun.build()` +
`public/`, ya eliminado).

**Módulos** (por responsabilidad):

1. **config.ts** — constantes de entorno y paths (`PORT`, `DATA_DIR`, `HISTORY_FILE`, `SCRIPT_FILE`, `PROMPT_FILE`, `HISTORY_CAP`, `LOG_CAP`).
2. **state.ts** — estado global mutable centralizado (`managed`, `status`, `statusError`, `benchmarkRunning`, `logBuffer`, `benchAbortController`) con setters para reasignación desde otros módulos. Exporta también `emptyParsedScript()` y la interfaz `ManagedServer`.
3. **types.ts** — interfaces del dominio (`ParsedScript`, `BenchmarkResult`, `GpuInfo`, `LlamaDevice`, `DeviceVram`, `RamInfo`, `StatusResponse`, `LogEntry`, `LogsResponse`, `ServerStatus`, `GpuBackend`, `TunedParams`, `ModelMeta`, `VramBreakdown`, `EstimateResponse`).
4. **logs.ts** — operaciones del buffer circular de logs (`pushLog`, `systemLog`, `getLogBuffer`). El buffer vive en `state.ts`.
5. **script-parser.ts** — tokenizado de scripts de shell y extracción de flags (`tokenizeScript`, `parseScript`, `flagValue`, `toNumOrNull`, `hasFlag`). Respeta comillas y continuaciones `\`. Extrae escalares para historial, benchmark y optimizador (incluye `--cpu-moe`, `--cache-reuse`, `--no-mmproj`, `--model`).
6. **server-manager.ts** — gestión del proceso llama-server (`startServer`, `stopServer`, `urlFor`, `binaryRuntimeEnv`). `startServer` devuelve el `ManagedServer` (con su promesa `ready`). Spawn con grupo de proceso propio, detección de ready, shutdown graceful (SIGTERM → SIGKILL).
7. **gpu.ts** — lectura de métricas GPU: NVIDIA vía `nvidia-smi` CSV, AMD vía sysfs (`mem_info_vram_*`, `gpu_busy_percent`). Incluye `subtractGpuBaseline` para el delta de VRAM. Re-exporta `mkdir` para `history.ts`.
8. **mem.ts** — lectura de RAM del sistema vía `/proc/meminfo` (`readRamStats`, `subtractRamBaseline`). Linux-only; devuelve `null` si no está disponible.
9. **devices.ts** — enumeración de devices del **backend** vía `--list-devices` (`listDevices`, `parseListDevices`, `detectBackend`, `vendorFromName`, `computeDeviceVram`). Los ids son del backend (CUDA0, Vulkan0, …), no del SO; cubre vendors que sysfs/nvidia-smi no miden (Intel vía Vulkan).
10. **metrics.ts** — parsing regex de métricas desde logs (`parseMetricsFromLogs`, incluye draft-mtp), health-check con polling (`waitForServer`), `DEFAULT_PROMPT`, `sleep`.
11. **benchmark.ts** — orquestador del ciclo completo de benchmark (`runBenchmark`, `finalize`). Importa de server-manager, gpu, mem, devices, metrics, history.
12. **history.ts** — persistencia JSON del historial (`ensureDataDir`, `loadHistory`, `saveResult`, `deleteResult`, `clearHistory`). Cap de `HISTORY_CAP` (200) entradas.
13. **optimizer.ts** — heurística de VRAM y resolución de modelo. Importa `estimateVramMiB`, `recommendParams`, `buildEstimateResponse` (heuristic de VRAM), `parseModelMeta` (deduce params/quant/capas del nombre), `resolveModelFile` (resuelve el `.gguf` real desde `-hf` → HF cache o `--model` → ruta, mide su tamaño exacto) y `readGgufArch` (parser binario del header GGUF que extrae capas, KV heads, head_dim y context_length reales del modelo).
14. **router.ts** — `handleRequest` con path matching manual y CORS. Solo endpoints de la API (incluye `POST /estimate` del optimizador). Re-exporta `existsSync` para el bootstrap.
15. **shutdown.ts** — cierre ordenado ante signals (`registerShutdownHandlers`, `shutdownCleanup`). Aborta el benchmark en curso y detiene el llama-server gestionado para que no quede huérfano ocupando GPU. Idempotente.

### Frontend (`front/`)

App Angular 22 (standalone, signals, zoneless) con PrimeNG 21 (preset `Noir`,
modo oscuro vía clase `.dark`).

- **`core/services/api.service.ts`** — wrapper sobre `HttpClient` con manejo de
  errores unificado (lanza `Error(body.error || status)`). Base URL configurable
  (`API_BASE_URL`, default `http://localhost:3000`).
- **`core/services/llama-bench.service.ts`** — un Observable por endpoint.
- **`core/services/storage.service.ts`** — **6 claves** de `localStorage`
  (script, prompt, sort, maxTokens, maxTokensEnabled, historyColumns) con
  try/catch. El filtrado por modelo NO se persiste (lo maneja PrimeNG nativamente
  vía `p-columnFilter`).
- **`core/state/bench.store.ts`** — estado central con signals + actions +
  `effect()` de persistencia; `computed()` para derivados (`visibleHistory`
  ordenado, `bests`, `selectedResults`, `statusLabel`, `modelOptions`).
- **`features/*`** — un componente standalone por sección. Cada uno lleva
  encabezado comentado con su responsabilidad. `home` orquesta el polling RxJS
  (status 1.5s, logs 1s, gpu 4s) con `takeUntilDestroyed`.

### Data Flow

1. User configures server options via script editor (textarea PrimeNG) → saved to `localStorage`
2. **Manual mode**: Start server → poll `/status` + `/logs` → see live output → stop
3. **Benchmark mode**: POST `/benchmark` → backend spawns llama-server → waits for `ready` (or process death → immediate error) → health-check → sends inference request → parses logs for metrics → reads GPU/devices/RAM stats → saves result → kills server → returns result
4. Results persisted to `data/history.json` (JSON array, max 200 entries)
5. Frontend polls `/status` (1.5s), `/logs` (1s), `/gpu` (4s)

---

## Port Convention

- **Backend**: port **3000** (NOT 8080). Deliberado — `llama-server` usa 8080 por defecto; 3000 evita el conflicto. Override con `PORT`.
- **Frontend (dev)**: `ng serve` → port **4242**.

---

## Environment Variables

| Variable            | Default          | Purpose                                                             |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| `PORT`              | `3000`           | Backend HTTP port                                                   |
| `LLAMA_SERVER_PATH` | `./llama-server` | Path to llama-server binary (referenced in UI, not used by backend) |
| `DATA_DIR`          | `./data`         | Directory for history.json and defaults                             |

---

## Process Management

`llama-server` is managed as a child process via `Bun.spawn()` (in `src/server-manager.ts`):

- **Detached process group**: `detached: true` so the child gets its own process group (setsid). El árbol entero se mata con `kill(-pid)`.
- **Graceful shutdown**: `stopServer()` sends `SIGTERM` to the process group (`kill(-pid)`), waits 8s (configurable via `killTimeoutMs`), then `SIGKILL`.
- **Ready detection**: la promesa `ready` del `ManagedServer` se resuelve cuando stdout matchea `server is listening` / `llama server is listening` / `HTTP server listening` / `all slots are ready`. Se **rechaza** si el proceso muere antes (con el exit code), lo que permite que el benchmark falle rápido.
- **Working directory**: set to the binary's directory (vía `binaryRuntimeEnv`) so relative `.so` files resolve correctly.
- **LD_LIBRARY_PATH**: prepended with the binary's directory for the same reason. Reutilizado por `devices.ts` para `--list-devices`.

When killing the process group with `kill(-pid)`, the negative PID targets the entire group, not just the leader. This prevents orphaned child processes.

**Shutdown handlers** (`shutdown.ts`): el backend registra `SIGINT`, `SIGTERM`,
`SIGHUP` y `beforeExit`. Al recibir una signal, `shutdownCleanup()` (idempotente)
aborta el benchmark en curso y detiene el llama-server con un timeout corto
(3s) para no colgar la terminal, y luego sale con `128 + signum`. Sin esto, el
hijo detached quedaría huérfano (reclutado por init) y seguiría ocupando la GPU.

---

## Hardware Metrics

Hay **tres** caminos de captura, todos Linux-only:

### GPU (SO) — `src/gpu.ts`

1. **NVIDIA**: Runs `nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits` and parses CSV output. Vendor label: `nvidia`.
2. **AMD**: Reads sysfs files at `/sys/class/drm/card*/device/mem_info_vram_total` and `mem_info_vram_used`. Also attempts `gpu_busy_percent` for utilization (may not be available on all kernels/drivers). Vendor label: `amd`.

`readGpuStats()` combina ambos. GPU index prefixes in history data preserve the vendor tag (e.g. `nvidia0`, `amdgpu-card0`) for disambiguation. El frontend normaliza el vendor para display. `subtractGpuBaseline` calcula el delta de VRAM usada por el modelo (clampeado a ≥0).

### Devices del backend — `src/devices.ts`

Pregunta directamente al binario con `binary --list-devices`. A diferencia de
`gpu.ts`, los ids son del **backend** (CUDA0, Vulkan0, …) — los mismos que
acepta `--device`. Esto:

- Alinea los devices del historial con el flag `--device` del script.
- Cubre vendors que sysfs/nvidia-smi no miden (p.ej. **Intel** vía Vulkan).
- Permite deducir el **backend de cómputo** (`detectBackend`: cuda/vulkan/sycl/metal/opencl/cann/cpu) por el prefijo del primer id.

`computeDeviceVram` calcula el VRAM consumido por el modelo como delta de VRAM
libre (`baseline.free − final.free`), filtrado por el valor de `--device`. Es el
sistema **preferido** de VRAM en el render; si está vacío, se cae a `gpus`.

### RAM — `src/mem.ts`

Lee `/proc/meminfo` (MemTotal + MemAvailable; `used = total − available`).
`subtractRamBaseline` devuelve el delta de RAM consumido por el benchmark.
Devuelve `null` si no es Linux o no se puede leer.

---

## Log Parsing

Regex-based extraction from llama-server stdout (in `src/metrics.ts`). Fragile — depends on exact output format of the llama-server build. `parseMetricsFromLogs` recorre las líneas **desde el final** (se queda con la última medición). Key patterns:

- `prompt eval time … X tokens per second` → prompt tokens/second
- `prompt eval time = X ms` → prompt eval time
- `eval time … X tokens per second` → generation tokens/second
- `eval time = X ms` (con lookbehind negativo de "prompt") → generation time
- `draft acceptance = X` → draft acceptance (fraction 0-1)
- **draft-mtp**: una sola línea con `#gen drafts`, `#acc drafts`, `#gen tokens`, `#acc tokens` (4 capturas en un mismo regex)
- `model loaded … X ms` → load time in seconds

Fallback de load time: si la regex no matchea, se mide el delta de timestamps
entre `loading model` y `model loaded`. Cualquier métrica sin match queda `null`.

---

## Benchmark Lifecycle

`runBenchmark()` (in `src/benchmark.ts`) orchestrates the full cycle, con
`checkAbort()` en cada checkpoint (cancelable desde la UI vía `POST /benchmark/stop`):

1. Parse script → extract config (error → resultado fallido temprano vía `finalize`)
2. Capturar **baseline** en paralelo: GPU + RAM + devices del backend (`listDevices`)
3. Crear `AbortController` y setearlo en `state` (cancelación desde la UI)
4. Start llama-server → obtener `ManagedServer`
5. **`await m.ready`** — si el proceso muere durante el arranque (exit≠0), rechaza al instante con el exit code (evita los 120s de health-check inútil). Propaga al router → toast de error.
6. Health-check HTTP (`waitForServer`, polling 500ms, timeout 120s)
7. Send POST to `http://<host>:<port>/v1/chat/completions` (streaming=false). `max_tokens: null` → `-1` (generar hasta EOS). Sampling (`temp`/`top_p`/`top_k`) solo si estaba en el script.
8. Measure request latency; captura `response` (`content` o `reasoning_content`)
9. `sleep(400)` para flush de líneas de timing
10. Parse logs for timing metrics (draft-mtp incluido)
11. Capture final GPU + RAM + devices stats, subtract baseline; `computeDeviceVram` + `detectBackend`
12. **`finally`**: stop server SIEMPRE + reset del AbortController
13. Persist result to history
14. Return result

El endpoint `POST /benchmark` guards against concurrent runs with a
`benchmarkRunning` flag (in `src/state.ts`). Returns 409 if another benchmark is
in progress or if manual server is still running.

---

## Optimizador de parámetros

Diálogo (`features/optimizer-modal/`) que precalcula parámetros de
`llama-server` según los recursos de VRAM disponibles, **sin arrancar el
binario**. Estimación puramente heurística (client-side), con un botón
"Default" que restaura los valores de `llama-server --help`.

### Flujo

1. Usuario abre el diálogo (botón "Optimizar ⚡" en `script-editor`).
2. `POST /estimate` → backend enumera devices (`--list-devices`), resuelve el
   archivo `.gguf` real (`-hf` → HF cache o `--model` → ruta), lee el header
   GGUF y devuelve `ModelMeta` + devices.
3. Frontend siembra los sliders desde el **script actual** (lo que el usuario ya
   tiene configurado), no desde una recomendación.
4. La heurística se calcula **client-side** como `computed` (instantánea, sin
   HTTP por cada cambio de slider) → las barras de consumo se actualizan en vivo.
5. "Aplicar al script" reescribe los flags afinados en el editor (copia temporal
   hasta confirmar; "Cancelar" no toca nada).

### Fórmula de estimación

```
VRAM = pesos + KV cache + overhead
```

- **Pesos**: tamaño **real** del archivo `.gguf` (medido en disco vía
  `resolveModelFile`), ajustado por el **offload fraction** de `--n-gpu-layers`
  (`ngl / capas`). Si `ngl >= capas`, todos los pesos van a VRAM; si no, solo la
  fracción correspondiente. Si no se resuelve el archivo, se estima con
  `paramsB × bytesPerParam` (tabla de quants).
- **KV cache**: `2 × capas × kv_heads × head_dim × ctx_size × bytes_kv`.
  Las capas, KV heads y head_dim se leen del **header GGUF** (`readGgufArch`:
  `block_count`, `attention.head_count_kv`, `attention.key_length`), no se
  adivinan por familia. `--cache-reuse` reduce el ctx efectivo
  (`ctx − cacheReuse`).
- **Overhead**: `128 + ubatch × 0.5` MiB (buffers de cómputo del backend). Si
  `--no-mmproj` está **off** y hay mmproj, se suma su tamaño al overhead.

### Parser del header GGUF (`readGgufArch`)

Lee los primeros 2MB del `.gguf` (sin cargar el archivo entero) y parsea el
header binario: magic `GGUF` → version → tensor_count → kv_count → pares
clave/valor tipados. Extrae:

| Clave GGUF                       | Campo ModelMeta                      |
| -------------------------------- | ------------------------------------ |
| `<arch>.block_count`             | `layers`                             |
| `<arch>.attention.head_count_kv` | `kvHeads`                            |
| `<arch>.attention.key_length`    | `headDim`                            |
| `<arch>.context_length`          | (disponible, no usado en la fórmula) |

Detiene la lectura apenas tiene las 4 claves. Tolerante a fallos: si el buffer
se corta o hay un tipo inesperado, devuelve lo que tenga y la fórmula cae a
defaults conservadores (32 capas, 8 kv_heads, 128 head_dim).

### Resolución del archivo (`resolveModelFile`)

- `-hf "org/model:quant"` → busca en `~/.cache/huggingface/hub/models--org--model/snapshots/<hash>/*.gguf`.
  Si el hf trae `:Q4_K_S`, prioriza el archivo cuyo nombre coincida con ese
  quant. Respeta `HF_HOME` (sino `~/.cache/huggingface/hub`).
- `--model / -m` → usa la ruta explícita (archivo o directorio).
- También busca el **mmproj** (`mmproj-*.gguf`) en el mismo directorio y mide
  su tamaño para el cálculo del overhead.

### Backend: `POST /estimate`

Body: `{ script, params?, priority? }`. Devuelve `{ devices, totalFreeMiB,
backend, modelMeta, heuristic, recommendation }`. No arranca el binario — solo
ejecuta `--list-devices` (rápido) y resuelve el archivo.

### Frontend: arquitectura sin loops

- **Heurística client-side** (`core/utils/vram-estimate.ts`): espejo de la
  fórmula del backend, calculada como `computed` que lee `params()` + `meta()` +
  `devices()`. Los sliders solo hacen `params.set(...)` → las barras se
  actualizan sin HTTP.
- **`untracked`** en el `effect` del constructor: `loadDevices()` no lee
  `params()` de forma reactiva, evitando el loop (params.set → effect → HTTP →
  params.set → …).
- **Flag `seeded`**: los params solo se siembran una vez al abrir (desde el
  script parseado), no en cada llamada.

### Comparación de VRAM

Las barras y el resumen comparan contra la **VRAM total** del device
(`totalMiB`), no la libre (`freeMiB`). El modelo puede usar VRAM que el
display-server reporta como "ocupada" — el tope real es la capacidad total de
la GPU, no el `free` del momento.

---

## Gotchas

1. **Port 3000, not 8080**: The backend deliberately avoids llama-server's default port. Don't "fix" this to 8080.
2. **llama-server binary required**: The project won't work without `llama-server` on disk. It's not in the repo and not installed by any script.
3. **Linux-only hardware metrics**: NVIDIA uses `nvidia-smi`, AMD uses sysfs paths, RAM uses `/proc/meminfo`. None works on macOS/Windows.
4. **Log parsing is brittle**: Regex patterns match specific llama-server output formats. Binary updates may break parsing silently (metrics become `null`).
5. **Process group kill**: `kill(-pid)` uses negative PID for group kill. On Windows this won't work (but the project is Linux-targeted anyway).
6. **Relative .so files**: The binary's directory is added to `LD_LIBRARY_PATH` and set as CWD (vía `binaryRuntimeEnv`) because llama-server ships with relative library paths.
7. **History cap**: `data/history.json` is trimmed to `HISTORY_CAP` (200) entries on each write. No pagination or lazy loading.
8. **`.gitignore` ignores `data/*`**: History.json is not tracked in git. Each developer has their own local history.
9. **No CORS issues**: Backend sets `Access-Control-Allow-Origin: *` on all responses, so el frontend Angular (dev en `:4242`) llama al backend (`:3000`) sin proxy. No usar `withCredentials` (incompatible con `*`).
10. **Backend = API pura**: Ya no sirve `index.html`, `/app.js` ni `/style.css`. El frontend se sirve aparte (`ng serve` en dev, o estáticos del `front/dist/` en producción). El code de `Bun.build()`/`public/` fue eliminado en la migración a Angular.
11. **Spanish UI**: All user-facing text is in Spanish. Code comments are also in Spanish.
12. **`src/types.ts` (backend) y `front/.../core/models/types.ts` son espejos**: El backend ya no comparte tipos con el frontend (viven en proyectos separados). Si una interfaz cambia, actualizar ambos lados. Incluye `TunedParams`, `ModelMeta`, `VramBreakdown`, `EstimateResponse` del optimizador.
13. **ESM live bindings**: State variables in `src/state.ts` (`managed`, `status`, etc.) are `let` exports. ESM modules see the current value on each access (live bindings), so closures in `server-manager.ts` correctly observe state changes.
14. **State mutations via setters**: Because `let` exports can't be reassigned from another module directly, `state.ts` provides setter functions (`setManaged`, `setStatus`, etc.) used by all other modules.
15. **Dev conjunto con `concurrently -k`**: `bun run dev` arranca backend + frontend juntos; la flag `-k` hace que al morir uno se mate el otro (Ctrl+C limpia ambos). Para correr uno solo, usar `dev:back` / `dev:front`.
16. **`m.ready` antes del health-check**: El benchmark hace `await m.ready` antes de `waitForServer`. Si el proceso muere durante el arranque (modelo inválido, OOM, crash), el error llega de inmediato al frontend en vez de esperar el timeout de 120s.
17. **Dos sistemas de VRAM**: `deviceVram` (delta de VRAM libre del backend vía `--list-devices`) es el preferido; si está vacío, el render cae a `gpus` (nvidia-smi/sysfs). El backend se deduce del prefijo del primer device, no del binario ni del script.
18. **Optimizador = heurística sin arrancar el binario**: El optimizador NO hace dry-fit (no arranca `llama-server` para medir). Estima con una fórmula determinística: peso real del `.gguf` + KV cache (arquitectura del header GGUF) + overhead. La única llamada HTTP al abrir es `POST /estimate` (que ejecuta `--list-devices` y resuelve el archivo). Ver sección "Optimizador de parámetros".
19. **Header GGUF del modelo**: `readGgufArch` lee los primeros 2MB del `.gguf` y extrae capas/KV heads/head_dim reales. Si el modelo no está cacheado (p.ej. se descarga por primera vez), no se puede resolver y la heurística cae a la interpolación por tamaño (menos precisa). El archivo se busca en el HF cache (`~/.cache/huggingface/hub`) o vía `--model` con ruta explícita.
20. **`--n-gpu-layers` afecta los pesos en VRAM**: Si `ngl < capas`, solo esa fracción de pesos va a VRAM; el resto a RAM del sistema. El KV cache y el overhead siempre van a GPU (no se pueden offload). Mover el slider de "Capas en GPU" reduce los pesos visibles en las barras.
21. **Comparación contra VRAM total, no libre**: Las barras del optimizador comparan contra `totalMiB` del device, no `freeMiB`. El modelo puede usar VRAM que el display-server reporta como "ocupada" — comparar contra `free` daba falsos rojos. El "¿cabe?" real es contra la capacidad total de la GPU.
