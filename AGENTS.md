# AGENTS.md

## Project Overview

**llama-bench** — a zero-dependency benchmarking tool for `llama-server`. Starts the server, runs inference prompts, parses timing metrics from logs, captures GPU stats, and persists results. Spanish-language UI.

- **Backend**: `server.ts` — single-file Bun HTTP server (TypeScript, stdlib only)
- **Frontend**: `public/` — vanilla HTML/CSS/JS, no frameworks
- **Runtime**: Bun, managed via `mise.toml` (`mise install` or `mise up`)
- **External binary**: `llama-server` (not bundled; must exist on disk)

---

## Essential Commands

| Command | Purpose |
|---------|---------|
| `mise install` | Install Bun via mise version manager |
| `bun install` | Initialize node_modules (zero deps, just creates the dir) |
| `bun start` | Production: `bun run server.ts` |
| `bun dev` | Development with `--watch` |
| `bun typecheck` | `tsc --noEmit` (TypeScript checking only) |

---

## Architecture

### Backend (`server.ts`)

Single-file Bun server. No frameworks, no routers — manual `handleRequest()` with path matching. Serves both the API and static frontend files.

**Key modules** (top to bottom in the file):
1. Config & env vars
2. `llama-server` process management (`startServer` / `stopServer`)
3. GPU metrics collection (NVIDIA via `nvidia-smi`, AMD via sysfs)
4. Log parsing (regex extraction from llama-server stdout)
5. Benchmark runner (`runBenchmark` — full lifecycle)
6. History persistence (`data/history.json`, capped at 200 entries)
7. HTTP router + static file serving
8. Bootstrap

### Frontend (`public/`)

- `index.html` — static page with sections: config form, benchmark trigger, GPU grid, last result card, history table, live logs, comparison modal
- `app.js` — vanilla JS, dynamic form generation from `CONFIG_FIELDS` array, localStorage config persistence, API polling
- `style.css` — dark theme, CSS custom properties, no preprocessor

### Data Flow

1. User configures server options via dynamically generated form → saved to `localStorage`
2. **Manual mode**: Start server → poll `/status` + `/logs` → see live output → stop
3. **Benchmark mode**: POST `/benchmark` → backend spawns llama-server → waits for ready → sends inference request → parses logs for metrics → reads GPU stats → saves result → kills server → returns result
4. Results persisted to `data/history.json` (JSON array, max 200 entries)
5. Frontend polls `/status` (1.5s), `/logs` (1s), `/gpu` (4s)

---

## Port Convention

**Backend runs on port 8765, NOT 8080.** This is intentional — `llama-server` defaults to port 8080. Using 8765 avoids conflicts when both processes run simultaneously.

Override with `PORT` env var.

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8765` | Backend HTTP port |
| `LLAMA_SERVER_PATH` | `./llama-server` | Path to llama-server binary |
| `DATA_DIR` | `./data` | Directory for history.json |

---

## Process Management

`llama-server` is managed as a child process via `Bun.spawn()`:

- **Detached process groups**: `detached: true` + `setpgid: true` so the child gets its own process group
- **Graceful shutdown**: `stopServer()` sends `SIGTERM` to the process group (`kill(-pid)`), waits 2s, then `SIGKILL`
- **Ready detection**: polls stdout for `server is listening` or `llama server listening` (configurable timeout)
- **Working directory**: set to the binary's directory so relative `.so` files resolve correctly
- **LD_LIBRARY_PATH**: prepended with the binary's directory for the same reason

When killing the process group with `kill(-pid)`, the negative PID targets the entire group, not just the leader. This prevents orphaned child processes.

---

## GPU Metrics

Two collection paths, both Linux-only:

1. **NVIDIA**: Runs `nvidia-smi --query-gpu=index,utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits` and parses CSV output. Vendor label: `nvidia`.
2. **AMD**: Reads sysfs files at `/sys/class/drm/card*/device/mem_info_vram_total` and `mem_info_vram_used`. Also attempts `gpu_busy_percent` for utilization (may not be available on all kernels/drivers). Vendor label: `amd`.

GPU index prefixes in history data preserve the vendor tag (e.g., `nvidia0`, `amdgpu-card0`) for disambiguation. The frontend strips these prefixes for display.

---

## Log Parsing

Regex-based extraction from llama-server stdout. Fragile — depends on exact output format of the llama-server build. Key patterns:

- `Prompt eval speed`: prompt tokens/second
- `Eval speed`: generation tokens/second
- `draft acceptance`: speculative decoding efficiency (fraction 0-1)
- `model loaded in` with a time suffix: total load time in seconds

Time suffix parsing handles `ms`, `s`, and bare numbers (assumed seconds). If regex doesn't match, metric is `null`.

Errors from llama-server logs are captured via `error` or `ERR` patterns (case-insensitive).

---

## Benchmark Lifecycle

`runBenchmark()` orchestrates the full cycle:

1. Create result object with UUID
2. Start llama-server with provided config
3. Wait for ready signal (with timeout)
4. Capture initial GPU stats
5. Send POST to `http://localhost:8080/v1/chat/completions` (streaming=false)
6. Measure request latency
7. Parse logs for timing metrics
8. Capture final GPU stats
9. Stop server
10. Persist result to history
11. Return result

The benchmark endpoint (`POST /benchmark`) guards against concurrent runs with a `benchmarkRunning` flag. Returns 409 if another benchmark is in progress or if manual server is still running.

---

## Frontend Patterns

### Config Persistence

- Config stored in `localStorage` under key `llama-bench-config`
- On init: `localStorage` takes priority over backend defaults (`/config`)
- Form fields have per-field enable/disable toggles — disabled fields are excluded from the config sent to backend
- "Reset" button clears localStorage; "Restaurar default" fetches backend defaults

### Dynamic Form Generation

`CONFIG_FIELDS` array defines all form fields. `buildForm()` creates the DOM. Each field has:
- `name`, `label`, `type` (text/number/select/checkbox/textarea)
- `default` value, `options` (for selects), `enabled` (default toggle state)
- `flag` — the CLI flag name shown for reference (e.g., `--model`, `-c`)

### Polling

Three independent intervals after `init()`:
- `/status` every 1500ms — updates status dot and text
- `/logs` every 1000ms — cursor-based incremental log fetching
- `/gpu` every 4000ms — GPU stats refresh

### History Comparison

Multi-select via checkboxes → "Comparar" button opens modal with side-by-side metric table. Best values in history are highlighted with a `best` CSS class (green text).

---

## Gotchas

1. **Port 8765, not 8080**: The backend deliberately avoids llama-server's default port. Don't "fix" this to 8080.
2. **llama-server binary required**: The project won't work without `llama-server` on disk. It's not in the repo and not installed by any script.
3. **Linux-only GPU metrics**: NVIDIA uses `nvidia-smi`, AMD uses sysfs paths. Neither works on macOS/Windows.
4. **Log parsing is brittle**: Regex patterns match specific llama-server output formats. Binary updates may break parsing silently (metrics become `null`).
5. **Process group kill**: `kill(-pid)` uses negative PID for group kill. On Windows this won't work (but the project is Linux-targeted anyway).
6. **Relative .so files**: The binary's directory is added to `LD_LIBRARY_PATH` and set as CWD because llama-server ships with relative library paths.
7. **History cap**: `data/history.json` is trimmed to 200 entries on each write. No pagination or lazy loading.
8. **`.gitignore` ignores `data/*`**: History.json is not tracked in git. Each developer has their own local history.
9. **No CORS issues in dev**: Backend sets `Access-Control-Allow-Origin: *` on all responses.
10. **Static file serving is manual**: Only `index.html`, `app.js`, and `style.css` are whitelisted. Adding new static files requires updating the `if/else` chain in `handleRequest()`. Path traversal protection checks `filePath.startsWith(staticRoot)`.
11. **Spanish UI**: All user-facing text is in Spanish. Code comments are also in Spanish.
12. **`types.ts` is imported by backend only**: `server.ts` imports all shared types from `types.ts`. The frontend (`app.js`) is plain JS and doesn't use it. Keep `types.ts` in sync if types change.
