// Proceso principal de Electron: shell de escritorio para plane-llama-bench.
//
// Responsabilidades:
//   1. Resolver DATA_DIR escribible (~/.config/plane-llama-bench vía userData).
//   2. Buscar un puerto libre (3000 o el siguiente disponible).
//   3. Spawnea el binario del backend (compilado con `bun build --compile`)
//      pasándole PORT y DATA_DIR por entorno.
//   4. Health-check al backend antes de cargar la ventana.
//   5. Carga el frontend (servido por el propio backend en el mismo puerto).
//   6. Al cerrar: SIGTERM al backend (graceful) y SIGKILL de respuesto.
//
// El backend sigue siendo API pura en dev; en producción sirve además los
// estáticos del frontend cuando la env FRONT_DIST está seteada.

import { app, BrowserWindow, dialog } from 'electron'
import { ChildProcess, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { existsSync } from 'node:fs'

// ── Resolución de rutas ───────────────────────────────────────────────────────

/**
 * Ruta al binario del backend.
 * - Empaquetado (AppImage): process.resourcesPath/backend/plane-llama-bench-backend.
 * - Dev: electron/backend/plane-llama-bench-backend (relativo a dist-electron/main.js).
 */
function backendBinaryPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'backend', 'plane-llama-bench-backend')
  }
  // En dev, dist-electron/ está al mismo nivel que electron/ y data/.
  return join(__dirname, '..', 'electron', 'backend', 'plane-llama-bench-backend')
}

/**
 * Ruta al PNG del icono de la ventana (taskbar/dock en runtime).
 * - Empaquetado (AppImage): process.resourcesPath/icons/512x512.png
 *   (extraResources lo copia a resources/icons/).
 * - Dev: electron/icons/512x512.png (relativo a dist-electron/main.js).
 * Devuelve '' si no existe (BrowserWindow ignora icon vacío → no crashea).
 */
function windowIconPath(): string {
  const file = app.isPackaged ? join(process.resourcesPath, 'icons', '512x512.png') : join(__dirname, '..', 'electron', 'icons', '512x512.png')
  return existsSync(file) ? file : ''
}

// ── Puerto libre ──────────────────────────────────────────────────────────────

/**
 * Busca el primer puerto libre empezando en `start`. Evita colisiones cuando
 * ya hay un plane-llama-bench corriendo u otro servicio en el 3000.
 */
function findFreePort(start: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryPort = (port: number): void => {
      const srv = createServer()
      srv.unref()
      srv.on('error', () => {
        if (port > start + 100) return reject(new Error('No hay puerto libre.'))
        tryPort(port + 1)
      })
      srv.listen(port, '127.0.0.1', () => {
        srv.close(() => resolve(port))
      })
    }
    tryPort(start)
  })
}

// ── Gestión del backend ───────────────────────────────────────────────────────

let backendProc: ChildProcess | null = null

/**
 * Arranca el backend como subproceso. El backend (compilado con Bun) expone la
 * API JSON y, en modo empaquetado, sirve los estáticos del frontend.
 */
async function startBackend(port: number, dataDir: string): Promise<void> {
  const bin = backendBinaryPath()
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    DATA_DIR: dataDir,
  }
  // FRONT_DIST le dice al backend que sirva el frontend empaquetado (mismo origen).
  if (app.isPackaged) {
    env.FRONT_DIST = join(process.resourcesPath, 'frontend')
  }

  console.log(`[electron] spawn backend: ${bin}  (PORT=${port}, DATA_DIR=${dataDir})`)
  backendProc = spawn(bin, [], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })

  backendProc.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`))
  backendProc.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`))
  backendProc.on('exit', (code) => {
    console.log(`[electron] backend terminó (exit=${code}).`)
    backendProc = null
  })
}

/** Detiene el backend: SIGTERM, espera 3s, SIGKILL si sigue vivo. */
function stopBackend(): Promise<void> {
  return new Promise((resolve) => {
    if (!backendProc || backendProc.killed) {
      backendProc = null
      return resolve()
    }
    const proc = backendProc
    let done = false
    const finish = (): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      // SIGKILL de respuesto si no muere en 3s (no deja huérfanos en la GPU).
      try {
        proc.kill('SIGKILL')
      } catch {
        /* ya terminó */
      }
      // Dar un instante más para que el exit se dispare.
      setTimeout(finish, 300)
    }, 3000)
    proc.once('exit', finish)
    try {
      proc.kill('SIGTERM')
    } catch {
      finish()
    }
  })
}

// ── Health-check ──────────────────────────────────────────────────────────────

/**
 * Polling al endpoint /status del backend hasta que responda (o timeout).
 * El backend arranca Bun.serve casi al instante, así que esto suele resolver
 * en el primer intento.
 */
async function waitForBackend(port: number, timeoutMs = 15000): Promise<void> {
  const url = `http://127.0.0.1:${port}/status`
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // todavía no escucha
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`El backend no respondió tras ${timeoutMs / 1000}s.`)
}

// ── Ventana ───────────────────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null

function createWindow(port: number): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    backgroundColor: '#0f1115',
    title: 'plane-llama-bench',
    icon: windowIconPath(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// ── Ciclo de vida de la app ───────────────────────────────────────────────────

// Evita el cierre prematuro mientras el backend hace cleanup de la GPU.
let quitting = false

// ── Identidad de la app para el desktop (icono en dock/taskbar) ───────────────
// En Linux/Wayland GNOME resuelve el icono de la ventana corriendo matcheando
// el app-id/WM_CLASS contra el StartupWMClass del .desktop. Desde un AppImage
// el proceso se monta con nombre distinto (/tmp/.mount_plane-XXXX/), así que el
// app-id hay que forzarlo o el dock cae al icono genérico de Electron.
// setName() alimenta el app-id GTK/Wayland; setAppUserModelId() cubre Windows.
const APP_ID = 'plane-llama-bench'
app.setName(APP_ID)
app.setAppUserModelId(APP_ID)
// ozone-platform-hint=auto deja que Electron use Wayland nativo cuando esté
// disponible (ahí el app-id se respeta para el dock); cae a X11 si no lo está.
app.commandLine.appendSwitch('ozone-platform-hint', 'auto')

app.whenReady().then(async () => {
  try {
    const dataDir = app.getPath('userData')
    const port = await findFreePort(3000)
    await startBackend(port, dataDir)
    await waitForBackend(port)
    createWindow(port)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    dialog.showErrorBox('Error al iniciar plane-llama-bench', msg)
    app.quit()
  }
})

app.on('window-all-closed', () => {
  // En desktop no hay "minimizar al tray": cerrar la ventana cierra la app.
  if (!quitting) app.quit()
})

app.on('before-quit', async (e) => {
  if (quitting) return
  // Evitar que la app se cierre antes de matar al backend (GPU cleanup).
  e.preventDefault()
  quitting = true
  await stopBackend()
  app.exit(0)
})

app.on('will-quit', async (e) => {
  // Belt-and-suspenders: si before-quit no alcanzó, intentarlo de nuevo.
  if (backendProc) {
    e.preventDefault()
    await stopBackend()
    app.exit(0)
  }
})
