// Pipes standalone para usar en plantillas: formateo de números, tiempo (ms→MM:SS)
// y nombre corto de modelo. Puros y sin estado, reutilizables en toda la app.

import { Pipe } from '@angular/core'

/**
 * Formatea un número con N decimales (default 2); devuelve '—' si es null.
 * Uso: {{ value | fmtNum:3 }}
 */
@Pipe({ name: 'fmtNum' })
export class FmtNumPipe {
  transform(n: number | null | undefined, decimals = 2): string {
    return n == null ? '—' : Number(n).toFixed(decimals)
  }
}

/**
 * Convierte milisegundos a "MM:SS"; devuelve '—' si es null.
 * Uso: {{ value | fmtMs }}
 */
@Pipe({ name: 'fmtMs' })
export class FmtMsPipe {
  transform(ms: number | null | undefined): string {
    if (ms == null) return '—'
    const totalSec = Math.round(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }
}

/**
 * Nombre corto de modelo (sin org/ ni quant, recortado).
 * Uso: {{ model | shortModel }}
 */
@Pipe({ name: 'shortModel' })
export class ShortModelPipe {
  transform(m: string | null | undefined): string {
    if (!m) return '—'
    const base = m.split(':')[0]
    return base.split('/').pop()?.slice(0, 22) || base
  }
}
