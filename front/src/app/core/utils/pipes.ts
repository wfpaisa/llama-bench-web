// Pipes standalone para usar en plantillas: formateo de números (es-CO, con
// separador de miles), tiempo (ms→segundos / MM:SS) y MiB→GB.
// Puros y sin estado, reutilizables en toda la app.
// Delegan en las funciones de format.ts para no duplicar lógica.

import { Pipe } from '@angular/core';
import { fmt, fmtGB, fmtSec } from './format';

/**
 * Formatea un número con N decimales (default 2) y separador de miles es-CO
 * (1.000,00); devuelve '—' si es null.
 * Uso: {{ value | fmtNum:3 }}
 */
@Pipe({ name: 'fmtNum' })
export class FmtNumPipe {
  transform(n: number | null | undefined, decimals = 2): string {
    return fmt(n, decimals);
  }
}

/**
 * Convierte milisegundos a segundos con 2 decimales y separador de miles;
 * devuelve '—' si es null.
 * Uso: {{ value | fmtSec }}
 */
@Pipe({ name: 'fmtSec' })
export class FmtSecPipe {
  transform(ms: number | null | undefined): string {
    return fmtSec(ms);
  }
}

/**
 * Convierte milisegundos a "MM:SS"; devuelve '—' si es null.
 * Uso: {{ value | fmtMs }}
 */
@Pipe({ name: 'fmtMs' })
export class FmtMsPipe {
  transform(ms: number | null | undefined): string {
    if (ms == null) return '—';
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
}

/**
 * Convierte MiB → GB con N decimales (default 2) y separador de miles; '—' si null.
 * Uso: {{ memUsedMiB | fmtGb:1 }}
 */
@Pipe({ name: 'fmtGb' })
export class FmtGbPipe {
  transform(mib: number | null | undefined, decimals = 2): string {
    return fmtGB(mib, decimals);
  }
}
