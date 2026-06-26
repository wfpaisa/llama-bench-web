# llama-bench-web

Utilidad web para hacer benchmark de modelos locales con **llama.cpp**,
controlando `llama-server` desde el navegador.

- **Backend:** Bun + TypeScript (solo stdlib, sin frameworks). Expone la **API
  JSON** en `:3000` (no sirve frontend).
- **Frontend:** Angular 22 + PrimeNG 21, app aparte en `front/` servida en
  `:4200` (dev). Habla con el backend por HTTP (CORS `*`).
- **Benchmark real** contra `llama-server` (no `llama-bench`), porque refleja
  correctamente MTP, speculative decoding, cache y comportamiento multi-GPU Vulkan.

> El frontend anterior (vanilla TS servido por `Bun.build()` + `public/`) fue
> migrado a Angular. El backend quedó como API pura.

## Por qué no `llama-bench`

`llama-bench` **no acepta** muchos flags de `llama-server`:

`--ctx-size`, `--cache-reuse`, `--jinja`, `--temp`, `--top-p`, `--top-k`,
`--metrics`, `--log-prefix`, `--spec-type`, `--spec-draft-n-max`.

Por eso esta herramienta hace el benchmark real:

1. Inicia `llama-server`.
2. Espera `server is listening`.
3. Ejecuta un prompt vía `POST /v1/chat/completions`.
4. Parsea timings de los logs (`prompt eval time`, `eval time`,
   `draft acceptance`, `model loaded`).
5. Lee métricas de GPU (NVIDIA + AMD).
6. Guarda el resultado.
7. Detiene el servidor automáticamente.

## Requisitos

- [Bun](https://bun.sh) ≥ 1.2
- `llama-server` compilado con backend Vulkan en el `PATH` o en el directorio.
- `nvidia-smi` (para VRAM/util de NVIDIA) — opcional.
- Para AMD, se usa sysfs (`/sys/class/drm/card*/device/mem_info_*`), sin
  depender de `radeontop`.

## Uso

Desde la raíz del repo (orquesta backend + frontend juntos):

```bash
bun install            # deps de la raíz (incl. concurrently)
bun run dev            # dev conjunto: backend (:3000) + frontend (:4200)
```

Abrí **http://localhost:4200**. Ctrl+C detiene ambos procesos a la vez.

Otros scripts:

```bash
bun run dev:back       # solo backend con --watch
bun run dev:front      # solo frontend Angular (ng serve)
bun run start          # producción: solo backend
bun run build:front    # build de producción del frontend → front/dist/
```

Variables de entorno:

| Variable            | Default          | Descripción                                              |
| ------------------- | ---------------- | -------------------------------------------------------- |
| `PORT`              | `3000`           | Puerto del backend (no 8080: es el de llama-server).     |
| `LLAMA_SERVER_PATH` | `./llama-server` | Ruta al binario por defecto en la UI.                    |
| `DATA_DIR`          | `./data`         | Carpeta donde se guarda `history.json` y defaults.       |

## Endpoints (backend `:3000`)

| Método | Ruta                | Descripción                                            |
| ------ | ------------------- | ------------------------------------------------------ |
| GET    | `/status`           | Estado del proceso (`stopped/starting/running/error`). |
| POST   | `/start`            | Inicia `llama-server` con la config del body.          |
| POST   | `/stop`             | SIGTERM (SIGKILL tras 8s si no muere).                 |
| GET    | `/logs?since=T`     | Logs incrementales desde el cursor `T`.                |
| POST   | `/logs/clear`       | Vacía el buffer de logs.                               |
| GET    | `/gpu`              | Métricas en vivo de NVIDIA + AMD.                      |
| POST   | `/benchmark`        | Ejecuta el benchmark completo.                         |
| POST   | `/benchmark/stop`   | Aborta el benchmark en curso.                          |
| GET    | `/script-default`   | Script por defecto (texto plano).                      |
| POST   | `/script-default`   | Guarda el script por defecto.                          |
| GET    | `/prompt-default`   | Prompt por defecto (texto plano).                      |
| POST   | `/prompt-default`   | Guarda el prompt por defecto.                          |
| GET    | `/history`          | Lista de resultados guardados.                         |
| DELETE | `/history`          | Borra todo el historial.                               |
| DELETE | `/history/:id`      | Borra un resultado.                                    |

## Métricas almacenadas

```json
{
  "promptTokensPerSecond": 31.14,
  "generationTokensPerSecond": 50.22,
  "draftAcceptance": 0.867,
  "loadTimeSeconds": 5.44,
  "requestLatencyMs": 4520.0,
  "gpus": [
    {
      "index": "nvidia0",
      "memUsedMiB": 7200,
      "memTotalMiB": 16303,
      "gpuUtilPct": 95
    },
    {
      "index": "amdgpu-card3",
      "memUsedMiB": 14800,
      "memTotalMiB": 8176,
      "gpuUtilPct": 80
    }
  ]
}
```

## UI (Angular + PrimeNG)

- Editor de script (textarea) + **Formatear** + guardar/restablecer default.
- Botones **Play** / **Stop** para control manual del proceso.
- Panel de **Benchmark automático** (prompt + max tokens, timer en vivo).
- Logs en tiempo real (polling cada 1s, auto-scroll, color por stream).
- Panel de GPUs en vivo (NVIDIA + AMD) con barras de VRAM/util.
- Tarjeta de **último resultado** con todas las métricas.
- Tabla de historial con resaltado de mejores valores por columna.
- Comparación lado a lado entre resultados seleccionados (modal).

## Hardware objetivo

- Intel i5-12600K
- RTX 5070 Ti 16 GB (Vulkan0)
- RX 6600 8 GB (Vulkan1)
- CachyOS Linux, backend Vulkan
- Configuración típica multi-GPU: `--device Vulkan0,Vulkan1`

## Auto-tuning (futuro)

El diseño está pensado para iterar sobre combinaciones de:
`tensorSplit`, `ctx`, `cache-type`, `batch` y encontrar automáticamente la
configuración óptima para RTX 5070 Ti + RX 6600.

## Estructura

```
.
├── src/               # Backend (Bun, API pura): spawn, endpoints, benchmark, GPU, historial
│   ├── server.ts      # Entry point
│   ├── router.ts      # Handler HTTP (solo API JSON + CORS)
│   └── …              # config, state, types, gpu, metrics, history, …
├── front/             # Frontend Angular 22 + PrimeNG 21
│   └── src/app/
│       ├── core/      # services, state (signals), models, utils
│       └── features/  # componentes standalone (home, status-bar, …)
└── data/              # Datos locales (gitignored)
    └── history.json   # Resultados de benchmarks
```
