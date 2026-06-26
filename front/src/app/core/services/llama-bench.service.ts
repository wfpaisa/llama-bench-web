// LlamaBenchService: un método Observable por cada endpoint del backend.
// Centraliza el contrato HTTP para que los componentes/store no conozcan rutas.
// Los endpoints de defaults (script/prompt) devuelven texto plano.

import { HttpParams } from '@angular/common/http'
import { Injectable, inject } from '@angular/core'
import { Observable } from 'rxjs'
import { ApiService } from './api.service'
import type {
  BenchmarkResponse,
  BenchmarkResult,
  GpuInfo,
  LogsResponse,
  OkResponse,
  StartResponse,
  StatusResponse,
} from '../models/types'

/** Parámetros del POST /benchmark. */
export interface BenchmarkRequest {
  script: string
  prompt: string
  maxTokens: number
}

@Injectable({ providedIn: 'root' })
export class LlamaBenchService {
  private readonly api = inject(ApiService)

  // ── Estado del servidor ──
  getStatus(): Observable<StatusResponse> {
    return this.api.get<StatusResponse>('/status')
  }

  startServer(script: string): Observable<StartResponse> {
    return this.api.post<StartResponse>('/start', { script })
  }

  stopServer(): Observable<OkResponse> {
    return this.api.post<OkResponse>('/stop')
  }

  // ── Logs (polling incremental vía cursor) ──
  getLogs(since: number): Observable<LogsResponse> {
    const params = new HttpParams().set('since', String(since))
    return this.api.get<LogsResponse>('/logs', params)
  }

  clearLogs(): Observable<OkResponse> {
    return this.api.post<OkResponse>('/logs/clear')
  }

  // ── GPU ──
  getGpus(): Observable<{ gpus: GpuInfo[] }> {
    return this.api.get<{ gpus: GpuInfo[] }>('/gpu')
  }

  // ── Benchmark ──
  runBenchmark(req: BenchmarkRequest): Observable<BenchmarkResponse> {
    // El backend lee `max_tokens` (snake_case).
    return this.api.post<BenchmarkResponse>('/benchmark', {
      script: req.script,
      prompt: req.prompt,
      max_tokens: req.maxTokens,
    })
  }

  stopBenchmark(): Observable<OkResponse> {
    return this.api.post<OkResponse>('/benchmark/stop')
  }

  // ── Historial ──
  getHistory(): Observable<{ results: BenchmarkResult[] }> {
    return this.api.get<{ results: BenchmarkResult[] }>('/history')
  }

  deleteResult(id: string): Observable<OkResponse> {
    return this.api.delete<OkResponse>(`/history/${encodeURIComponent(id)}`)
  }

  clearHistory(): Observable<OkResponse> {
    return this.api.delete<OkResponse>('/history')
  }

  // ── Defaults (texto plano) ──
  getScriptDefault(): Observable<string> {
    return this.api.getText('/script-default')
  }

  saveScriptDefault(script: string): Observable<OkResponse> {
    return this.api.post<OkResponse>('/script-default', { script })
  }

  getPromptDefault(): Observable<string> {
    return this.api.getText('/prompt-default')
  }

  savePromptDefault(prompt: string): Observable<OkResponse> {
    return this.api.post<OkResponse>('/prompt-default', { prompt })
  }
}
