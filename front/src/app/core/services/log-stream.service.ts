// LogStreamService: conexión en vivo con el backend vía SSE (GET /events).
//
// Sustituye a los pollings de /logs y /status: el backend empuja cada línea en
// cuanto la escribe llama-server, así que el visor no espera a ningún tick.
//
// EventSource ya reconecta solo, pero reconecta contra la MISMA URL, y la
// nuestra lleva el cursor (`?since=`). Por eso gestionamos la reconexión a mano:
// al reabrir usamos el cursor actualizado y no se pierden ni se repiten líneas.
// Si tras varios intentos no hay stream, caemos al polling de /logs para no
// dejar el visor mudo.

import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { EMPTY, Subscription, interval } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { API_BASE_URL } from './api.service';
import { PlaneLlamaBenchService } from './plane-llama-bench.service';
import { BenchStore } from '../state/bench.store';
import type { LogsResponse, StatusResponse } from '../models/types';

/** Reintentos de SSE antes de rendirse y pasar a polling. */
const MAX_SSE_RETRIES = 3;
/** Backoff entre reintentos (creciente, tope de 5 s). */
const RETRY_BASE_MS = 500;
/** Cadencia del polling de respaldo (equivalente al comportamiento anterior). */
const FALLBACK_POLL_MS = 1000;
/** Cadencia del status en el respaldo (equivalente al comportamiento anterior). */
const FALLBACK_STATUS_POLL_MS = 1500;

@Injectable({ providedIn: 'root' })
export class LogStreamService {
  private readonly store = inject(BenchStore);
  private readonly api = inject(PlaneLlamaBenchService);
  private readonly destroyRef = inject(DestroyRef);

  /** True cuando el stream está caído y se está usando el polling de respaldo. */
  readonly degraded = signal(false);

  private source: EventSource | null = null;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private fallback: Subscription | null = null;
  private stopped = false;

  constructor() {
    this.destroyRef.onDestroy(() => this.stop());
  }

  /** Abre el stream. Idempotente: si ya hay uno vivo, no hace nada. */
  start(): void {
    if (this.source || this.stopped) return;
    this.open();
  }

  /** Cierra el stream y cualquier respaldo activo. */
  stop(): void {
    this.stopped = true;
    this.closeSource();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.fallback?.unsubscribe();
    this.fallback = null;
  }

  private open(): void {
    const since = this.store.logCursor();
    const source = new EventSource(`${API_BASE_URL}/events?since=${since}`);
    this.source = source;

    source.addEventListener('open', () => {
      // Conexión buena: se reinicia el contador y se abandona el respaldo.
      this.retries = 0;
      this.stopFallback();
    });

    source.addEventListener('log', (e) => {
      const data = this.parse<LogsResponse>(e);
      if (data) this.store.appendLogs(data.entries, data.cursor);
    });

    source.addEventListener('status', (e) => {
      const data = this.parse<StatusResponse>(e);
      if (data) this.store.setStatus(data);
    });

    source.addEventListener('error', () => {
      // El backend puede estar reiniciándose (bun --watch) o la red haber caído.
      this.closeSource();
      if (this.stopped) return;
      this.retries++;
      if (this.retries > MAX_SSE_RETRIES) this.startFallback();
      const delay = Math.min(RETRY_BASE_MS * this.retries, 5000);
      this.retryTimer = setTimeout(() => this.open(), delay);
    });
  }

  private parse<T>(e: Event): T | null {
    try {
      return JSON.parse((e as MessageEvent<string>).data) as T;
    } catch {
      return null;
    }
  }

  private closeSource(): void {
    this.source?.close();
    this.source = null;
  }

  /**
   * Respaldo por polling mientras el stream no se recupere: cubre lo mismo que
   * el stream (logs + status). Mismo patrón de resiliencia que tenía Home: el
   * catchError va DENTRO del switchMap, así un error transitorio no mata el
   * interval y el siguiente tick reintenta.
   */
  private startFallback(): void {
    if (this.fallback) return;
    this.degraded.set(true);
    this.fallback = new Subscription();
    this.fallback.add(
      interval(FALLBACK_POLL_MS)
        .pipe(
          switchMap(() => this.api.getLogs(this.store.logCursor()).pipe(catchError(() => EMPTY))),
        )
        .subscribe((data) => this.store.appendLogs(data.entries, data.cursor)),
    );
    this.fallback.add(
      interval(FALLBACK_STATUS_POLL_MS)
        .pipe(switchMap(() => this.api.getStatus().pipe(catchError(() => EMPTY))))
        .subscribe((s) => this.store.setStatus(s)),
    );
  }

  private stopFallback(): void {
    if (!this.fallback) return;
    this.fallback.unsubscribe();
    this.fallback = null;
    this.degraded.set(false);
  }
}
