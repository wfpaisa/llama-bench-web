// ApiService: wrapper sobre HttpClient que añade la base de la API y unifica el
// manejo de errores. Lanza Error(data.error || `HTTP {status}`) para que los
// componentes lo muestren vía toast. Todas las rutas son relativas (sin prefijo)
// porque el backend las sirve en la raíz.

import { HttpClient, HttpErrorResponse, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * URL base del backend. En dev (ng serve en :4242 → backend en :3000) apunta al
 * backend absoluto. En modo empaquetado (Electron) el backend sirve el frontend
 * en el mismo origen e inyecta `window.__API_BASE_URL = ''` en index.html, así
 * las rutas son relativas (same-origin). Ver `src/router.ts` (serveStatic).
 */
export const API_BASE_URL: string = resolveApiBaseUrl();

function resolveApiBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:3000';
  const injected = (window as unknown as { __API_BASE_URL?: string }).__API_BASE_URL;
  // OJO: la base del modo empaquetado es la cadena VACÍA (rutas relativas al
  // mismo origen). Hay que comprobar la presencia, no la verdad: un `||` la
  // descartaría por falsy y mandaría la app al :3000 absoluto, que en el
  // AppImage puede ni siquiera ser el puerto del backend (electron/main.ts
  // elige el primer puerto libre a partir del 3000).
  return typeof injected === 'string' ? injected : 'http://localhost:3000';
}

/** Respuesta exitosa con cuerpo JSON { ok, error?, ... }. */
type JsonBody = object;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = API_BASE_URL;

  /** GET JSON; lanza Error(body.error || status) si no es 2xx. */
  get<T extends JsonBody = JsonBody>(path: string, params?: HttpParams): Observable<T> {
    return this.http.get<T>(this.url(path), { params }).pipe(catchError(this.mapError<T>()));
  }

  /** GET texto plano (para /script-default y /prompt-default). */
  getText(path: string): Observable<string> {
    return this.http
      .get(this.url(path), { responseType: 'text' })
      .pipe(catchError(this.mapError<string>()));
  }

  /** POST JSON; lanza Error(body.error || status) si no es 2xx. */
  post<T extends JsonBody = JsonBody>(path: string, body: unknown | null = null): Observable<T> {
    return this.http
      .post<T>(this.url(path), body ?? {}, { headers: { 'Content-Type': 'application/json' } })
      .pipe(catchError(this.mapError<T>()));
  }

  /** DELETE; lanza Error(body.error || status) si no es 2xx. */
  delete<T extends JsonBody = JsonBody>(path: string): Observable<T> {
    return this.http.delete<T>(this.url(path)).pipe(catchError(this.mapError<T>()));
  }

  /** PATCH JSON; lanza Error(body.error || status) si no es 2xx. */
  patch<T extends JsonBody = JsonBody>(path: string, body: unknown | null = null): Observable<T> {
    return this.http
      .patch<T>(this.url(path), body ?? {}, { headers: { 'Content-Type': 'application/json' } })
      .pipe(catchError(this.mapError<T>()));
  }

  private url(path: string): string {
    return `${this.base}${path}`;
  }

  /**
   * Mapea un HttpErrorResponse a Error con el mensaje del backend. Genérico en
   * el tipo del stream, así sirve igual para respuestas JSON y de texto plano.
   */
  private mapError<T>() {
    return (err: unknown): Observable<T> => throwError(() => new Error(this.extractError(err)));
  }

  /**
   * Extrae el mensaje de error de una respuesta fallida.
   * Si el backend devolvió JSON { error } lo usa; si es texto plano (404 de
   * defaults) usa el statusText; si no, `HTTP {status}`.
   */
  private extractError(err: unknown): string {
    if (err instanceof HttpErrorResponse) {
      const body = err.error;
      if (body && typeof body === 'object' && 'error' in body) {
        const e = (body as Record<string, unknown>)['error'];
        if (typeof e === 'string' && e.length) return e;
      }
      if (typeof body === 'string' && body.length && err.status !== 0) return body;
      return `HTTP ${err.status}`;
    }
    return err instanceof Error ? err.message : 'Error desconocido';
  }
}
