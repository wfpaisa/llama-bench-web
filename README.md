# llama-bench-web

Utilidad web **extremadamente liviana** para hacer benchmark de modelos locales con
**llama.cpp**, controlando `llama-server` desde el navegador.

- **Backend:** Bun + TypeScript (solo stdlib, sin frameworks).
- **Frontend:** HTML + CSS + JavaScript puro. Nada de React/Vue/Angular.
- **Benchmark real** contra `llama-server` (no `llama-bench`), porque refleja
  correctamente MTP, speculative decoding, cache y comportamiento multi-GPU Vulkan.

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

```bash
bun install
bun start              # producción (http://localhost:8765)
bun dev                # desarrollo con --watch
```

Variables de entorno:

| Variable           | Default          | Descripción                                  |
|--------------------|------------------|----------------------------------------------|
| `PORT`             | `8765`           | Puerto del backend web (no 8080: es el de llama-server). |
| `LLAMA_SERVER_PATH`| `./llama-server` | Ruta al binario por defecto en la UI.         |
| `DATA_DIR`         | `./data`         | Carpeta donde se guarda `history.json`.       |

Apuntá el campo **Binario llama-server** de la UI a tu `llama-server`
(p. ej. `/home/felipe/llama.cpp/build/bin/llama-server`).

## Endpoints

| Método | Ruta            | Descripción                                  |
|--------|-----------------|----------------------------------------------|
| GET    | `/status`       | Estado del proceso (`stopped/starting/running/error`). |
| POST   | `/start`        | Inicia `llama-server` con la config del body.|
| POST   | `/stop`         | SIGTERM (SIGKUL tras 8s si no muere).        |
| GET    | `/logs?since=T` | Logs incrementales desde el cursor `T`.      |
| POST   | `/logs/clear`   | Vacía el buffer de logs.                     |
| GET    | `/config`       | Configuración por defecto.                    |
| GET    | `/gpu`          | Métricas en vivo de NVIDIA + AMD.            |
| POST   | `/benchmark`    | Ejecuta el benchmark completo.               |
| GET    | `/history`      | Lista de resultados guardados.               |
| DELETE | `/history`      | Borra todo el historial.                     |
| DELETE | `/history/:id`  | Borra un resultado.                          |

## Métricas almacenadas

```json
{
  "promptTokensPerSecond": 31.14,
  "generationTokensPerSecond": 50.22,
  "draftAcceptance": 0.867,
  "loadTimeSeconds": 5.44,
  "requestLatencyMs": 4520.0,
  "gpus": [
    { "index": "nvidia0", "memUsedMiB": 7200, "memTotalMiB": 16303, "gpuUtilPct": 95 },
    { "index": "amdgpu-card3", "memUsedMiB": 14800, "memTotalMiB": 8176, "gpuUtilPct": 80 }
  ]
}
```

## UI

- Formulario con todos los flags relevantes + preview en vivo del comando.
- Botones **Play** / **Stop** para control manual del proceso.
- Logs en tiempo real (polling cada 1s, auto-scroll).
- Panel de GPUs en vivo (NVIDIA + AMD).
- Botón **Benchmark** para el flujo automático completo.
- Tabla de historial con resaltado de mejores valores por columna.
- Comparación lado a lado entre resultados seleccionados.

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
├── server.ts          # Backend: spawn, endpoints, benchmark, GPU, historial
├── types.ts           # Tipos compartidos
├── public/
│   ├── index.html     # UI
│   ├── app.js         # Lógica del frontend
│   └── style.css      # Tema oscuro
└── data/
    └── history.json   # Resultados (gitignored)
```
