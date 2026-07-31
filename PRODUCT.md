# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Felipe, el propio autor del repo — un desarrollador que corre modelos LLM
locales con `llama.cpp` en su máquina Linux (GPU NVIDIA o AMD) y necesita
comparar configuraciones (`--ctx-size`, `--n-gpu-layers`, `--batch-size`,
speculative decoding, etc.) antes de fijar los parámetros de producción.
Herramienta de uso personal, no pensada para terceros ni para distribución
abierta a una comunidad.

## Product Purpose

Hacer benchmark **real** de inferencia local: arranca `llama-server` con el
script de flags configurado, espera a que esté listo, lanza una inferencia
de prueba, parsea los timings de los logs, captura métricas de hardware
(GPU/RAM) y guarda el resultado en un historial para comparar configuraciones
entre sí.

## Positioning

A diferencia de `llama-bench` (que no soporta muchos flags de
`llama-server` y por eso no refleja bien MTP, speculative decoding, cache ni
comportamiento multi-GPU), esta herramienta orquesta el binario real que el
usuario va a usar en producción, así que el benchmark refleja el
comportamiento real del server, no una aproximación sintética.

## Operating Context

- Linux es requisito para las métricas de hardware (`nvidia-smi`, sysfs de
  AMD, `/proc/meminfo`).
- El binario `llama-server` no se bundlea; debe existir en el `PATH` o en el
  repo.
- Dev: `bun run dev` levanta backend (`:3000`) y frontend Angular (`:4242`)
  en paralelo.
- Empaquetado desktop vía Electron → `.AppImage` (mismo origen, sin CORS en
  producción empaquetada). El shell de Electron es un wrapper del mismo
  frontend web, no cambia el lenguaje de diseño a nativo.
- Usuario único local, sin auth ni multi-tenant.
- Cambios de diseño/UI van en `front/` (Angular 22 standalone + PrimeNG 21,
  signals, zoneless); el backend (`src/`) es API JSON pura sin UI.

## Capabilities and Constraints

- Editor de script con catálogo de ~270 flags de `llama-server` (búsqueda,
  filtros, descripciones, inserción directa).
- Benchmark de un click: parseo del script → arranque del server →
  health-check → inferencia (`POST /v1/chat/completions`) → parseo de
  métricas → guardado en historial.
- Control manual del servidor (play/stop) con status bar en vivo.
- Métricas en tiempo real de GPU (NVIDIA + AMD) y RAM, con polling.
- Visor de logs incremental con auto-scroll.
- Historial en tabla (máx. 200 resultados, `data/history.json`, gitignored)
  con selección múltiple, orden, filtros, columnas conmutables y highlights
  de mejores valores.
- Comparación lado a lado y gráfico de barras de resultados seleccionados.
- Optimizador de parámetros: heurística client-side de VRAM (pesos + KV
  cache + overhead) que lee el header GGUF real y recomienda `--ctx-size`,
  `--n-gpu-layers`, `--batch-size`, etc. sin arrancar el binario; calibración
  real opcional vía "dryfit".
- Backend expone solo API JSON (no sirve frontend); frontend es app Angular
  separada que habla con el backend por HTTP.

## Brand Commitments

"plane-llama-bench" es el nombre definitivo del producto (confirmado por el
usuario).

## Evidence on Hand

Screenshots reales de la UI existente en `screen-shot/b1.png` … `b6.png`
(referenciados en el README). No hay testimonios, casos de estudio ni
benchmarks de terceros — no inventar ninguno; solo mostrar datos realmente
medidos por la herramienta.

## Product Principles

1. Comportamiento real sobre aproximación sintética: siempre orquestar el
   binario real de `llama-server`, nunca simular.
2. Herramienta técnica de uso solitario: optimizar para el flujo de un único
   power user iterando rápido, no para onboarding ni multi-usuario.
3. Fidelidad de datos: nunca fabricar números de benchmark ni stats de
   hardware; mostrar solo lo efectivamente medido.
4. Loop de iteración rápido: editar script, benchmarkear y comparar debe
   minimizar fricción para tuning rápido de parámetros.
5. Local-first, sin nube: todo corre y persiste en la máquina Linux del
   usuario.
