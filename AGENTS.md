# AGENTS.md

## Project Overview

**llama-bench** — a zero-dependency benchmarking tool for `llama-server`. Starts the server, runs inference prompts, parses timing metrics from logs, captures GPU stats, and persists results. Spanish-language UI.

- **Backend**: `src/server.ts` — Bun HTTP server modular (TypeScript, stdlib only). Código dividido por funcionalidad en `src/`.
- **Frontend**: `src/front/app.ts` — vanilla TypeScript, no frameworks. Se transpila con `Bun.build()` al arranque y se sirve en `/app.js`.
- **Static files**: `public/` — solo `index.html` y `style.css`.
- **Runtime**: Bun, managed via `mise.toml` (`mise install` o `mise up`).
- **External binary**: `llama-server` (not bundled; must exist on disk).

---

## Essential Commands

| Command         | Purpose                                                            |
| --------------- | ------------------------------------------------------------------ |
| `mise install`  | Install Bun via mise version manager                               |
| `bun install`   | Initialize node_modules (zero deps, just creates the dir)          |
| `bun start`     | Production: `bun run src/server.ts`                                |
| `bun dev`       | Development with `--watch` (rebundlea el frontend automáticamente) |
| `bun typecheck` | `tsc --noEmit` (TypeScript checking only)                          |

---

## Architecture

### Estructura del proyecto

```
src/
  server.ts            # Entry point: Bun.serve + bootstrap + Bun.build del frontend
  config.ts            # Constantes de entorno (PORT, DATA_DIR, HISTORY_FILE, …)
  state.ts             # Estado global mutable (managed, status, logBuffer, …) + setters
  types.ts             # Interfaces compartidas (BenchmarkResult, GpuInfo, …)
  logs.ts              # Buffer de logs: pushLog, systemLog
  script-parser.ts     # Tokenizado y parseo del script de shell (tokenizeScript, parseScript)
  server-manager.ts    # Gestión del proceso llama-server (startServer, stopServer, urlFor)
  gpu.ts               # Métricas de GPU NVIDIA (nvidia-smi) + AMD (sysfs)
  metrics.ts           # Parsing de métricas desde logs + health-check + utilidades
  benchmark.ts         # Orquestador del benchmark completo (runBenchmark)
  history.ts           # Persistencia del historial (loadHistory, saveResult, …)
  router.ts            # HTTP request handler: path matching + CORS + archivos estáticos
  front/
    app.ts             # Frontend TypeScript (vanilla, módulo ES)
    esm-sh.d.ts        # Stubs de tipos para imports de CodeMirror desde esm.sh
public/
  index.html           # UI estática
  style.css            # Tema oscuro, CSS custom properties
data/
  history.json         # Resultados de benchmarks (gitignored)
  script-default.txt   # Script por defecto guardado desde la UI (gitignored)
```

### Backend (`src/server.ts` + módulos en `src/`)

Servidor HTTP modular sin frameworks. `src/server.ts` es el entry point: transpila el frontend con `Bun.build()`, inicializa el historial, arranca `Bun.serve` con el router. El router (`src/router.ts`) despacha requests a los módulos correspondientes.

**Módulos** (por responsabilidad):

1. **config.ts** — constantes de entorno y paths (`PORT`, `DATA_DIR`, `HISTORY_FILE`, `LOG_CAP`, …).
2. **state.ts** — estado global mutable centralizado (`managed`, `status`, `benchmarkRunning`, `logBuffer`) con setters para reasignación desde otros módulos. Exporta también `emptyParsedScript()` y `ManagedServer` interface.
3. **types.ts** — interfaces compartidas entre backend y frontend (`BenchmarkResult`, `GpuInfo`, `ParsedScript`, `StatusResponse`, `LogEntry`, `LogsResponse`, `ServerStatus`).
4. **logs.ts** — operaciones del buffer circular de logs (`pushLog`, `systemLog`, `getLogBuffer`). El buffer vive en `state.ts`.
5. **script-parser.ts** — tokenizado de scripts de shell y extracción de flags (`tokenizeScript`, `parseScript`, `flagValue`, `toNumOrNull`).
6. **server-manager.ts** — gestión del proceso llama-server (`startServer`, `stopServer`, `urlFor`). Spawn con grupo de proceso propio, detección de ready, shutdown graceful (SIGTERM → SIGKILL).
7. **gpu.ts** — lectura de métricas GPU: NVIDIA vía `nvidia-smi` CSV, AMD vía sysfs (`mem_info_vram_*`, `gpu_busy_percent`). Incluye `subtractGpuBaseline` para el delta de VRAM.
8. **metrics.ts** — parsing regex de métricas desde logs (`parseMetricsFromLogs`), health-check con polling (`waitForServer`), `DEFAULT_PROMPT`, `sleep`.
9. **benchmark.ts** — orquestador del ciclo completo de benchmark (`runBenchmark`, `finalize`). Importa de server-manager, gpu, metrics, history.
10. **history.ts** — persistencia JSON del historial (`loadHistory`, `saveResult`, `deleteResult`, `clearHistory`). Cap de 200 entradas.
11. **router.ts** — `handleRequest` con path matching manual, CORS, y serving de archivos estáticos + bundle del frontend.

### Frontend (`src/front/app.ts`)

TypeScript vanilla, módulo ES. Se escribe como `.ts` en `src/front/` y Bun lo transpila a un bundle JS en memoria al arrancar el servidor (vía `Bun.build()`). El bundle se sirve en `/app.js`; `index.html` referencia ese path sin cambios.

- Usa CodeMirror (importado desde `esm.sh` como URL) para el editor de scripts.
- Tipos compartidos importados de `../types.ts`.
- `esm-sh.d.ts` provee stubs de tipo para que `tsc --noEmit` no falle con los imports de URL.

### Bundling del frontend

En `src/server.ts` (entry), al bootstrap:

```ts
const result = await Bun.build({
  entrypoints: [import.meta.dir + "/front/app.ts"],
  target: "browser",
  format: "esm",
  external: ["https://esm.sh/codemirror*", "https://esm.sh/@codemirror/*"],
});
const appJs = await result.outputs[0].text();
```

El router sirve `appJs` en `/app.js`. Con `bun dev --watch`, Bun re-ejecuta el entry al detectar cambios y rebundlea automáticamente.

### Data Flow

1. User configures server options via CodeMirror script editor → saved to `localStorage`
2. **Manual mode**: Start server → poll `/status` + `/logs` → see live output → stop
3. **Benchmark mode**: POST `/benchmark` → backend spawns llama-server → waits for ready → sends inference request → parses logs for metrics → reads GPU stats → saves result → kills server → returns result
4. Results persisted to `data/history.json` (JSON array, max 200 entries)
5. Frontend polls `/status` (1.5s), `/logs` (1s), `/gpu` (4s)

---

## Port Convention

**Backend runs on port 3000, NOT 8080.** This is intentional — `llama-server` defaults to port 8080. Using 3000 avoids conflicts when both processes run simultaneously.

Override with `PORT` env var.

---

## Environment Variables

| Variable            | Default          | Purpose                                                             |
| ------------------- | ---------------- | ------------------------------------------------------------------- |
| `PORT`              | `3000`           | Backend HTTP port                                                   |
| `LLAMA_SERVER_PATH` | `./llama-server` | Path to llama-server binary (referenced in UI, not used by backend) |
| `DATA_DIR`          | `./data`         | Directory for history.json and script-default.txt                   |

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

GPU index prefixes in history data preserve the vendor tag (e.g., `nvidia0`, `amdgpu-card0`) for disambiguation. The frontend strips these prefixes for display.

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

## Frontend Patterns

### Config Persistence

- Config stored in `localStorage` under key `llama-bench-script`
- On init: `localStorage` takes priority over backend defaults (`/script-default`)
- "Guardar default" saves to server (`POST /script-default`); "Restablecer default" loads from server
- "Reset" button clears localStorage

### CodeMirror Editor

- Full CodeMirror 6 editor with shell syntax highlighting (loaded from `esm.sh`)
- Auto-saves to localStorage on every change
- Script is the source of truth (not structured form fields)

### Polling

Three independent intervals after `init()`:

- `/status` every 1500ms — updates status dot and text
- `/logs` every 1000ms — cursor-based incremental log fetching
- `/gpu` every 4000ms — GPU stats refresh

### History Comparison

Multi-select via checkboxes → "Comparar" button opens modal with side-by-side metric table. Best values in history are highlighted with a `best` CSS class (green text).

### History Sorting

Columns with `data-sort` attribute are clickable. Sort state (column + direction) persisted in localStorage.

### Model Filter

Dropdown populated with unique model base names from history. Filter state persisted in localStorage.

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
9. **No CORS issues in dev**: Backend sets `Access-Control-Allow-Origin: *` on all responses.
10. **Static file serving**: `index.html` and `style.css` are served from `public/` as static files. `/app.js` is the transpiled frontend bundle served from memory (built by `Bun.build()` at server startup). Path traversal protection checks `filePath.startsWith(staticRoot)`.
11. **Spanish UI**: All user-facing text is in Spanish. Code comments are also in Spanish.
12. **`src/types.ts` is shared**: Both backend modules and frontend (`src/front/app.ts`) import types from `src/types.ts`. Keep it in sync if types change.
13. **Frontend is TypeScript, not JS**: `src/front/app.ts` is compiled to JS by `Bun.build()` at server startup — it's not served as raw `.ts` to the browser. CodeMirror imports from `esm.sh` are marked as `external` in the build so the browser resolves them.
14. **ESM live bindings**: State variables in `src/state.ts` (`managed`, `status`, etc.) are `let` exports. ESM modules see the current value on each access (live bindings), so closures in `server-manager.ts` correctly observe state changes.
15. **State mutations via setters**: Because `let` exports can't be reassigned from another module directly, `state.ts` provides setter functions (`setManaged`, `setStatus`, etc.) used by all other modules.
