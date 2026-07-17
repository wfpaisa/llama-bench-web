// PlaneLlamaBenchService: un método Observable por cada endpoint del backend.
// Centraliza el contrato HTTP para que los componentes/store no conozcan rutas.
// Los endpoints de defaults (script/prompt) devuelven texto plano.

import { HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiService } from './api.service';
import type {
  BenchmarkResponse,
  BenchmarkResult,
  DryfitRequestResponse,
  EstimateRequestResponse,
  GpuInfo,
  LogsResponse,
  OkResponse,
  RamInfo,
  StartResponse,
  StatusResponse,
  TunedParams,
} from '../models/types';

/** Parámetros del POST /benchmark. */
export interface BenchmarkRequest {
  script: string;
  prompt: string;
  /** null = sin límite de tokens (checkbox desactivado). */
  maxTokens: number | null;
}

@Injectable({ providedIn: 'root' })
export class PlaneLlamaBenchService {
  private readonly api = inject(ApiService);

  // ── Estado del servidor ──
  getStatus(): Observable<StatusResponse> {
    return this.api.get<StatusResponse>('/status');
  }

  startServer(script: string): Observable<StartResponse> {
    return this.api.post<StartResponse>('/start', { script });
  }

  stopServer(): Observable<OkResponse> {
    return this.api.post<OkResponse>('/stop');
  }

  // ── Logs (polling incremental vía cursor) ──
  getLogs(since: number): Observable<LogsResponse> {
    const params = new HttpParams().set('since', String(since));
    return this.api.get<LogsResponse>('/logs', params);
  }

  clearLogs(): Observable<OkResponse> {
    return this.api.post<OkResponse>('/logs/clear');
  }

  // ── GPU ── (también trae RAM del sistema)
  getGpus(): Observable<{ gpus: GpuInfo[]; ram: RamInfo }> {
    return this.api.get<{ gpus: GpuInfo[]; ram: RamInfo }>('/gpu');
  }

  // ── Benchmark ──
  runBenchmark(req: BenchmarkRequest): Observable<BenchmarkResponse> {
    // El backend lee `max_tokens` (snake_case). null = sin límite (checkbox
    // "Limitar" desactivado) → el backend lo traduce a -1 hacia llama-server.
    // Se envía el campo siempre (aunque sea null) para que el router distinga
    // "sin límite" (null) de "default 2048" (campo ausente).
    return this.api.post<BenchmarkResponse>('/benchmark', {
      script: req.script,
      prompt: req.prompt,
      max_tokens: req.maxTokens,
    });
  }

  stopBenchmark(): Observable<OkResponse> {
    return this.api.post<OkResponse>('/benchmark/stop');
  }

  // ── Historial ──
  getHistory(): Observable<{ results: BenchmarkResult[] }> {
    return this.api.get<{ results: BenchmarkResult[] }>('/history');
  }

  deleteResult(id: string): Observable<OkResponse> {
    return this.api.delete<OkResponse>(`/history/${encodeURIComponent(id)}`);
  }

  /**
   * Actualiza la calificación (1-5 estrellas) de un resultado.
   * Pasar null limpia la calificación.
   */
  setRating(id: string, rating: number | null): Observable<OkResponse> {
    return this.api.patch<OkResponse>(`/history/${encodeURIComponent(id)}`, { rating });
  }

  /**
   * Alterna la marca de favorito (corazón) de un resultado.
   */
  setFavorite(id: string, favorite: boolean): Observable<OkResponse> {
    return this.api.patch<OkResponse>(`/history/${encodeURIComponent(id)}`, { favorite });
  }

  /** Elimina múltiples resultados por ids. */
  deleteSelected(ids: string[]): Observable<OkResponse> {
    return this.api.post<OkResponse>('/history/delete', { ids });
  }

  // ── Defaults (texto plano) ──
  getScriptDefault(): Observable<string> {
    return this.api.getText('/script-default');
  }

  saveScriptDefault(script: string): Observable<OkResponse> {
    return this.api.post<OkResponse>('/script-default', { script });
  }

  getPromptDefault(): Observable<string> {
    return this.api.getText('/prompt-default');
  }

  savePromptDefault(prompt: string): Observable<OkResponse> {
    return this.api.post<OkResponse>('/prompt-default', { prompt });
  }

  // ── Flags destacadas (favoritos) del editor de script ──
  getFlagsFavorites(): Observable<{ favorites: string[] }> {
    return this.api.get<{ favorites: string[] }>('/flags-favorites');
  }

  saveFlagsFavorites(favorites: string[]): Observable<OkResponse> {
    return this.api.post<OkResponse>('/flags-favorites', { favorites });
  }

  // ── Optimizador ──
  /** Estimación heurística instantánea (no arranca el binario). */
  estimate(
    script: string,
    params: TunedParams,
    priority: 'ctx' | 'quality',
  ): Observable<EstimateRequestResponse> {
    return this.api.post<EstimateRequestResponse>('/estimate', { script, params, priority });
  }

  /**
   * Calibración real (dry-fit): arranca llama-server con el script, espera a
   * que el modelo cargue, mide la VRAM real consumida y detiene el servidor.
   * No envía inferencia. Tarda lo que tarda en cargar el modelo (puede ser 30s+).
   */
  dryfit(script: string): Observable<DryfitRequestResponse> {
    return this.api.post<DryfitRequestResponse>('/dryfit', { script });
  }
}
