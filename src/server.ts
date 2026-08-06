// Entry del backend.
// Arranca Bun.serve con el router. El backend expone solo la API JSON; el
// frontend vive en front/ (Angular) y se sirve aparte (ng serve en dev,
// estáticos en producción).
//
// Con `bun dev --watch`, cualquier edición de backend reinicia el proceso.

import { writeFile } from 'node:fs/promises'
import { PORT, HISTORY_FILE } from './config.ts'
import { handleRequest, existsSync } from './router.ts'
import { ensureDataDir } from './history.ts'
import { systemLog } from './logs.ts'
import { registerShutdownHandlers } from './shutdown.ts'

// ── Bootstrap ─────────────────────────────────────────────────────────────────
await ensureDataDir()
if (existsSync(HISTORY_FILE) === false) await writeFile(HISTORY_FILE, '[]')

// Registrar handlers de cierre antes de arrancar el server, para que cualquier
// signal (Ctrl+C, kill, cierre de terminal) detenga el llama-server gestionado
// y no quede huérfano ocupando GPU.
registerShutdownHandlers()

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  fetch: handleRequest,
  // El default de Bun son 10s de inactividad, que corta tanto el stream SSE de
  // /events en los silencios como un POST /benchmark largo (un run puede tardar
  // minutos sin enviar un solo byte). 255s es el máximo que admite Bun; el
  // heartbeat del stream (5s) mantiene viva la conexión muy por debajo de eso.
  idleTimeout: 255,
})

systemLog(`backend escuchando en http://localhost:${server.port}`)
console.log(`→ http://localhost:${server.port}`)
