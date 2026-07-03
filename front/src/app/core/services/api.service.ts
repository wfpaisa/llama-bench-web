// ApiService: wrapper sobre HttpClient que añade la base de la API y unifica el
// manejo de errores. Lanza Error(data.error || `HTTP {status}`) para que los
// componentes lo muestren vía toast. Todas las rutas son relativas (sin prefijo)
// porque el backend las sirve en la raíz.

import { HttpClient, HttpErrorResponse, HttpParams, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, throwError } from 'rxjs';
import { catchError, map } from 'rxjs/operators';

/** Token de inyección con la URL base del backend (configurable por entorno). */
export const API_BASE_URL = 'http://localhost:3000';

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
      .pipe(catchError(this.mapTextError()));
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

  /** Mapea un HttpErrorResponse a Error con el mensaje del backend. */
  private mapError<T>() {
    return (err: unknown): Observable<T> => {
      const msg = this.extractError(err);
      return throwError(() => new Error(msg));
    };
  }

  private mapTextError() {
    return (err: unknown): Observable<string> => {
      const msg = this.extractError(err);
      return throwError(() => new Error(msg));
    };
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

/** Helper de tipos: convierte un HttpResponse<T> en su body. */
export function bodyOf<T>(): (src: Observable<HttpResponse<T>>) => Observable<T> {
  return map((r) => r.body as T);
}
