// Benchmark real contra la API de llama-server.
//
// Orquesta el ciclo completo: parse → spawn → health-check → request →
// parseo de métricas → GPU stats → persist → kill.

import type { BenchmarkResult, ParsedScript } from "./types.ts";
import { parseScript } from "./script-parser.ts";
import { readGpuStats, subtractGpuBaseline } from "./gpu.ts";
import { DEFAULT_PROMPT, parseMetricsFromLogs, sleep, waitForServer } from "./metrics.ts";
import { startServer, stopServer, urlFor } from "./server-manager.ts";
import { saveResult } from "./history.ts";
import { systemLog } from "./logs.ts";
import { getLogBuffer } from "./logs.ts";
import { emptyParsedScript } from "./state.ts";

/**
 * Ejecuta un benchmark completo contra llama-server.
 * Garantiza que el servidor se detenga al final (finally).
 */
export async function runBenchmark(
  script: string,
  prompt: string,
  maxTokens: number = 8192,
): Promise<BenchmarkResult> {
  const errors: string[] = [];

  // 0) Parsear el script. Si falla, no hay nada que ejecutar.
  let parsed: ParsedScript;
  try {
    parsed = parseScript(script);
  } catch (e) {
    return finalize(null, prompt, [
      `Script inválido: ${(e as Error).message}`,
    ]);
  }

  // Marcador: índice del log desde el cual parsear al final.
  const logStartIndex = getLogBuffer().length;

  // 0b) Capturar baseline de GPU antes de iniciar (para restar VRAM ya usada).
  const gpuBaseline = await readGpuStats();

  // 1) Arrancar servidor.
  systemLog("benchmark: iniciando llama-server…");
  try {
    await startServer(parsed);
  } catch (e) {
    errors.push(`No se pudo iniciar el servidor: ${(e as Error).message}`);
    return finalize(parsed, prompt, errors);
  }

  try {
    // 2) Esperar que el servidor acepte conexiones HTTP.
    //    "server is listening" puede aparecer antes de que el socket esté
    //    realmente listo, especialmente con modelos grandes.
    const base = urlFor(parsed);
    await waitForServer(base);
    systemLog("benchmark: servidor responde, ejecutando request…");

    // 3) Request de benchmark. Se omite cualquier parámetro de sampling que
    //    no estuviera en el script (temp/topP/topK = null).
    const body: Record<string, unknown> = {
      messages: [{ role: "user", content: prompt }],
      max_tokens: maxTokens,
      stream: false,
    };
    if (parsed.model) {
      body.model = parsed.model.split(":")[0] ?? parsed.model;
    }
    if (parsed.temp !== null) body.temperature = parsed.temp;
    if (parsed.topP !== null) body.top_p = parsed.topP;
    if (parsed.topK !== null) body.top_k = parsed.topK;

    const t0 = performance.now();
    let responseText = "";
    try {
      const resp = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        errors.push(`HTTP ${resp.status} en /v1/chat/completions`);
      } else {
        const data = await resp.json();
        const msg = data?.choices?.[0]?.message;
        const content = msg?.content ?? "";
        const reasoning = msg?.reasoning_content ?? "";
        responseText = content || reasoning || "";
      }
    } catch (e) {
      errors.push(`Fallo en request: ${(e as Error).message}`);
    }
    const requestLatencyMs = performance.now() - t0;

    // Dar un pequeño margen para que el servidor flushee las líneas de timing.
    await sleep(400);

    // 4) Parsear métricas de logs.
    const relevantLines = getLogBuffer().slice(logStartIndex);
    const parsedMetrics = parseMetricsFromLogs(relevantLines);

    // 5) GPU stats finales y restar baseline.
    const gpusFinal = await readGpuStats();
    const gpus = subtractGpuBaseline(gpusFinal, gpuBaseline);

    const result: BenchmarkResult = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      config: parsed,
      promptTokensPerSecond: parsedMetrics.promptTokensPerSecond,
      generationTokensPerSecond: parsedMetrics.generationTokensPerSecond,
      draftAcceptance: parsedMetrics.draftAcceptance,
      genDrafts: parsedMetrics.genDrafts,
      accDrafts: parsedMetrics.accDrafts,
      genTokens: parsedMetrics.genTokens,
      accTokens: parsedMetrics.accTokens,
      loadTimeSeconds: parsedMetrics.loadTimeSeconds,
      requestLatencyMs,
      prompt,
      response: responseText,
      gpus,
      errors,
    };

    await saveResult(result);
    systemLog("benchmark: finalizado y guardado.");
    return result;
  } finally {
    // 6) Detener el servidor automáticamente.
    await stopServer();
  }
}

/** Construye un resultado "fallido" (sin métricas) para errores tempranos. */
function finalize(
  parsed: ParsedScript | null,
  prompt: string,
  errors: string[],
): BenchmarkResult {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    config: parsed ?? emptyParsedScript(),
    promptTokensPerSecond: null,
    generationTokensPerSecond: null,
    draftAcceptance: null,
    genDrafts: null,
    accDrafts: null,
    genTokens: null,
    accTokens: null,
    loadTimeSeconds: null,
    requestLatencyMs: null,
    prompt,
    response: "",
    gpus: [],
    errors,
  };
}

export { DEFAULT_PROMPT };
