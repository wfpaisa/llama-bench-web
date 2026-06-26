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

// ── Bootstrap ─────────────────────────────────────────────────────────────────
await ensureDataDir()
if (existsSync(HISTORY_FILE) === false) await writeFile(HISTORY_FILE, '[]')

const server = Bun.serve({
  port: PORT,
  hostname: '0.0.0.0',
  fetch: handleRequest,
})

systemLog(`backend escuchando en http://localhost:${server.port}`)
console.log(`→ http://localhost:${server.port}`)
