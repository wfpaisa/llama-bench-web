# AGENTS.md

## Project Overview

**llama-bench** — a benchmarking tool for `llama-server`. Starts the server, runs inference prompts, parses timing metrics from logs, captures GPU stats, and persists results. Spanish-language UI.

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
| `bun run start`       | Producción: `bun run src/server.ts`                                                                                    |
| `bun run build:front` | Build de producción del frontend Angular (`ng build`) → `front/dist/`                                                  |
| `bun typecheck`       | `tsc --noEmit` del backend                                                                                             |

Dentro de `front/` (directorio del frontend Angular) también aplican los scripts
`ng` habituales (`start`, `build`, `watch`, `test`) — ver `front/package.json`.

---

## Architecture

### Estructura del proyecto

```
src/                        # Backend (Bun, API pura)
  server.ts                 # Entry point: Bun.serve + bootstrap
  config.ts                 # Constantes de entorno (PORT, DATA_DIR, HISTORY_FILE, …)
  state.ts                  # Estado global mutable (managed, status, logBuffer, …) + setters
  types.ts                  # Interfaces compartidas (BenchmarkResult, GpuInfo, …)
  logs.ts                   # Buffer de logs: pushLog, systemLog
  script-parser.ts          # Tokenizado y parseo del script de shell (tokenizeScript, parseScript)
  server-manager.ts         # Gestión del proceso llama-server (startServer, stopServer, urlFor)
  gpu.ts                    # Métricas de GPU NVIDIA (nvidia-smi) + AMD (sysfs)
  metrics.ts                # Parsing de métricas desde logs + health-check + utilidades
  benchmark.ts              # Orquestador del benchmark completo (runBenchmark)
  history.ts                # Persistencia del historial (loadHistory, saveResult, …)
  router.ts                 # HTTP request handler: path matching + CORS (solo API JSON)
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
      models/types.ts       # Interfaces espejo del backend
      services/             # api.service (HttpClient), llama-bench.service, storage.service
      state/bench.store.ts  # Estado global con signals + actions + effects
      utils/                # format.ts (fn puras), pipes.ts
    features/               # Componentes standalone (uno por sección):
      home/, status-bar/, script-editor/, benchmark-panel/,
      gpu-grid/, logs-viewer/, response-card/, last-result/,
      history-table/, compare-modal/
```

### Backend (`src/server.ts` + módulos en `src/`)

Servidor HTTP modular sin frameworks. `src/server.ts` es el entry point:
inicializa el historial y arranca `Bun.serve` con el router. El router
(`src/router.ts`) despacha requests de la **API JSON** a los módulos
correspondientes. **No sirve archivos estáticos ni bundle de frontend** (eso se
hizo en la versión anterior con `Bun.build()` + `public/`, ya eliminado).

**Módulos** (por responsabilidad):

1. **config.ts** — constantes de entorno y paths (`PORT`, `DATA_DIR`, `HISTORY_FILE`, `LOG_CAP`, …).
2. **state.ts** — estado global mutable centralizado (`managed`, `status`, `benchmarkRunning`, `logBuffer`) con setters para reasignación desde otros módulos. Exporta también `emptyParsedScript()` y `ManagedServer` interface.
3. **types.ts** — interfaces del dominio (`BenchmarkResult`, `GpuInfo`, `ParsedScript`, `StatusResponse`, `LogEntry`, `LogsResponse`, `ServerStatus`).
4. **logs.ts** — operaciones del buffer circular de logs (`pushLog`, `systemLog`, `getLogBuffer`). El buffer vive en `state.ts`.
5. **script-parser.ts** — tokenizado de scripts de shell y extracción de flags (`tokenizeScript`, `parseScript`, `flagValue`, `toNumOrNull`).
6. **server-manager.ts** — gestión del proceso llama-server (`startServer`, `stopServer`, `urlFor`). Spawn con grupo de proceso propio, detección de ready, shutdown graceful (SIGTERM → SIGKILL).
7. **gpu.ts** — lectura de métricas GPU: NVIDIA vía `nvidia-smi` CSV, AMD vía sysfs (`mem_info_vram_*`, `gpu_busy_percent`). Incluye `subtractGpuBaseline` para el delta de VRAM.
8. **metrics.ts** — parsing regex de métricas desde logs (`parseMetricsFromLogs`), health-check con polling (`waitForServer`), `DEFAULT_PROMPT`, `sleep`.
9. **benchmark.ts** — orquestador del ciclo completo de benchmark (`runBenchmark`, `finalize`). Importa de server-manager, gpu, metrics, history.
10. **history.ts** — persistencia JSON del historial (`loadHistory`, `saveResult`, `deleteResult`, `clearHistory`). Cap de 200 entradas.
11. **router.ts** — `handleRequest` con path matching manual y CORS. Solo endpoints de la API.

### Frontend (`front/`)

App Angular 22 (standalone, signals, zoneless) con PrimeNG 21 (preset `Noir`,
modo oscuro vía clase `.dark`). Sigue los mandates de `front/AGENTS.md`:
`inject()`, `input()/output()/computed()`, control flow nativo (`@if/@for`),
`class`/`style` bindings (sin `ngClass`/`ngStyle`), archivos sin sufijo
`.component`, lazy loading de rutas.

- **`core/services/api.service.ts`** — wrapper sobre `HttpClient` con manejo de
  errores unificado (lanza `Error(body.error || status)`). Base URL configurable
  (`API_BASE_URL`, default `http://localhost:3000`).
- **`core/services/llama-bench.service.ts`** — un Observable por endpoint.
- **`core/services/storage.service.ts`** — las 4 claves de `localStorage`
  (script, prompt, sort, modelFilter) con try/catch.
- **`core/state/bench.store.ts`** — estado central con signals + actions +
  `effect()` de persistencia; `computed()` para derivados (`visibleHistory`
  ordenado/filtrado, `bests`, `selectedResults`, `statusLabel`).
- **`features/*`** — un componente standalone por sección. Cada uno lleva
  encabezado comentado con su responsabilidad. `home` orquesta el polling RxJS
  (status 1.5s, logs 1s, gpu 4s) con `takeUntilDestroyed`.

### Data Flow

1. User configures server options via script editor (textarea PrimeNG) → saved to `localStorage`
2. **Manual mode**: Start server → poll `/status` + `/logs` → see live output → stop
3. **Benchmark mode**: POST `/benchmark` → backend spawns llama-server → waits for ready → sends inference request → parses logs for metrics → reads GPU stats → saves result → kills server → returns result
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

- **Detached process groups**: `detached: true` + `setpgid: true` so the child gets its own process group
- **Graceful shutdown**: `stopServer()` sends `SIGTERM` to the process group (`kill(-pid)`), waits 8s, then `SIGKILL`
- **Ready detection**: polls stdout for `server is listening` or `llama server listening` (configurable timeout)
- **Working directory**: set to the binary's directory so relative `.so` files resolve correctly
- **LD_LIBRARY_PATH**: prepended with the binary's directory for the same reason

When killing the process group with `kill(-pid)`, the negative PID targets the entire group, not just the leader. This prevents orphaned child processes.

---

## GPU Metrics

Two collection paths, both Linux-only (in `src/gpu.ts`):

1. **NVIDIA**: Runs `nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits` and parses CSV output. Vendor label: `nvidia`.
2. **AMD**: Reads sysfs files at `/sys/class/drm/card*/device/mem_info_vram_total` and `mem_info_vram_used`. Also attempts `gpu_busy_percent` for utilization (may not be available on all kernels/drivers). Vendor label: `amd`.

GPU index prefixes in history data preserve the vendor tag (e.g. `nvidia0`, `amdgpu-card0`) for disambiguation. The frontend normaliza el vendor para display.

---

## Log Parsing

Regex-based extraction from llama-server stdout (in `src/metrics.ts`). Fragile — depends on exact output format of the llama-server build. Key patterns:

- `Prompt eval speed`: prompt tokens/second
- `Eval speed`: generation tokens/second
- `draft acceptance`: speculative decoding efficiency (fraction 0-1)
- `model loaded in` with a time suffix: total load time in seconds

Time suffix parsing handles `ms`, `s`, and bare numbers (assumed seconds). If regex doesn't match, metric is `null`.

Errors from llama-server logs are captured via `error` or `ERR` patterns (case-insensitive).

---

## Benchmark Lifecycle

`runBenchmark()` (in `src/benchmark.ts`) orchestrates the full cycle:

1. Create result object with UUID
2. Parse script → extract config
3. Capture GPU baseline (for VRAM delta)
4. Start llama-server with provided config
5. Wait for ready signal (with timeout)
6. Send POST to `http://localhost:8080/v1/chat/completions` (streaming=false)
7. Measure request latency
8. Parse logs for timing metrics
9. Capture final GPU stats, subtract baseline
10. Stop server
11. Persist result to history
12. Return result

The benchmark endpoint (`POST /benchmark`) guards against concurrent runs with a `benchmarkRunning` flag (in `src/state.ts`). Returns 409 if another benchmark is in progress or if manual server is still running.

---

## Gotchas

1. **Port 3000, not 8080**: The backend deliberately avoids llama-server's default port. Don't "fix" this to 8080.
2. **llama-server binary required**: The project won't work without `llama-server` on disk. It's not in the repo and not installed by any script.
3. **Linux-only GPU metrics**: NVIDIA uses `nvidia-smi`, AMD uses sysfs paths. Neither works on macOS/Windows.
4. **Log parsing is brittle**: Regex patterns match specific llama-server output formats. Binary updates may break parsing silently (metrics become `null`).
5. **Process group kill**: `kill(-pid)` uses negative PID for group kill. On Windows this won't work (but the project is Linux-targeted anyway).
6. **Relative .so files**: The binary's directory is added to `LD_LIBRARY_PATH` and set as CWD because llama-server ships with relative library paths.
7. **History cap**: `data/history.json` is trimmed to 200 entries on each write. No pagination or lazy loading.
8. **`.gitignore` ignores `data/*`**: History.json is not tracked in git. Each developer has their own local history.
9. **No CORS issues**: Backend sets `Access-Control-Allow-Origin: *` on all responses, so el frontend Angular (dev en `:4242`) llama al backend (`:3000`) sin proxy. No usar `withCredentials` (incompatible con `*`).
10. **Backend = API pura**: Ya no sirve `index.html`, `/app.js` ni `/style.css`. El frontend se sirve aparte (`ng serve` en dev, o estáticos del `front/dist/` en producción). El code de `Bun.build()`/`public/` fue eliminado en la migración a Angular.
11. **Spanish UI**: All user-facing text is in Spanish. Code comments are also in Spanish.
12. **`src/types.ts` (backend) y `front/.../core/models/types.ts` son espejos**: El backend ya no comparte tipos con el frontend (viven en proyectos separados). Si una interfaz cambia, actualizar ambos lados.
13. **ESM live bindings**: State variables in `src/state.ts` (`managed`, `status`, etc.) are `let` exports. ESM modules see the current value on each access (live bindings), so closures in `server-manager.ts` correctly observe state changes.
14. **State mutations via setters**: Because `let` exports can't be reassigned from another module directly, `state.ts` provides setter functions (`setManaged`, `setStatus`, etc.) used by all other modules.
15. **Dev conjunto con `concurrently -k`**: `bun run dev` arranca backend + frontend juntos; la flag `-k` hace que al morir uno se mate el otro (Ctrl+C limpia ambos). Para correr uno solo, usar `dev:back` / `dev:front`.
