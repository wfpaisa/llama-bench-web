// Gestión del proceso llama-server: spawn, detección de ready y shutdown.
//
// El proceso se arranca en su propio grupo (detached/setpgid) para poder matar
// todo el árbol con kill(-pid). El CWD y LD_LIBRARY_PATH apuntan al directorio
// del binario para que resuelva .so relativas (libllama-server-impl.so, etc.).
//
// Nota sobre estado: `managed`/`status`/`statusError` son `let` exportados por
// state.ts. Los imports son live bindings de ESM: cada acceso lee el valor
// actual, así que las closures ven los cambios hechos vía los setters.

import { spawn, type Subprocess } from "bun";
import { dirname, resolve } from "node:path";
import type { ParsedScript, LogEntry } from "./types.ts";
import { managed, setManaged, status, setStatus, setStatusError } from "./state.ts";
import { pushLog, systemLog } from "./logs.ts";

/** Construye la URL base del server gestionado a partir de host/port. */
export function urlFor(c: { host: string; port: number }): string {
  const host = c.host || "127.0.0.1";
  return `http://${host}:${c.port}`;
}

/**
 * Arranca llama-server con el script parseado.
 * Lanza Error si ya hay uno corriendo.
 */
export async function startServer(parsed: ParsedScript): Promise<number> {
  if (managed)
    throw new Error("Ya hay un servidor corriendo. Detenlo primero.");

  const { binary, argv } = parsed;

  // Resolver el directorio del binario para:
  //   1. Ponerlo como cwd (refleja lo que el usuario hace en la terminal).
  //   2. Añadirlo a LD_LIBRARY_PATH para que encuentre .so relativas
  //      (p.ej. libllama-server-impl.so).
  const binAbs = resolve(binary);
  const binDir = dirname(binAbs);
  const env = { ...process.env } as Record<string, string>;
  const existing = env["LD_LIBRARY_PATH"] || "";
  env["LD_LIBRARY_PATH"] = existing ? `${binDir}:${existing}` : binDir;

  systemLog(`spawn: ${binary} ${argv.join(" ")}  (cwd=${binDir})`);

  let resolveReady: (() => void) | undefined;
  let rejectReady: ((e: Error) => void) | undefined;
  const ready = new Promise<void>((res, rej) => {
    resolveReady = res;
    rejectReady = rej;
  });

  const proc = spawn({
    cmd: [binary, ...argv],
    stdout: "pipe",
    stderr: "pipe",
    cwd: binDir,
    env,
    // Nuevo grupo de proceso (setsid): matamos a todo el árbol con kill(-pid).
    detached: true,
  });

  const pid = proc.pid!;
  setManaged({
    proc,
    pid,
    startedAt: new Date().toISOString(),
    parsed,
    ready,
    readyResolve: resolveReady,
    readyReject: rejectReady,
    done: false,
  });

  setStatus("starting");
  setStatusError(null);

  // Consumir stdout/stderr en background.
  streamPipes(proc);

  // Race: o se vuelve ready o el proceso muere antes.
  void ready.then(
    () => {
      setStatus("running");
      systemLog("llama-server listo (server is listening).");
    },
    (e) => {
      if (status !== "error") setStatus("error");
      setStatusError(e.message);
    },
  );

  // Esperar el exit del proceso.
  void proc.exited.then((code) => {
    systemLog(`llama-server terminó (exit=${code}).`);
    const wasStarting = status === "starting";
    setManaged(null);
    if (status !== "error") setStatus("stopped");
    if (wasStarting && rejectReady) {
      rejectReady(
        new Error(`El proceso terminó antes de estar listo (exit=${code}).`),
      );
    }
  });

  // Timeout de arranque: 5 min para modelos grandes con offload.
  setTimeout(
    () => {
      if (managed && status === "starting") {
        // No lo matamos: modelos grandes tardan. Solo lo dejamos intentar.
        systemLog("Aviso: el servidor sigue en 'starting' tras 5 min.");
      }
    },
    5 * 60 * 1000,
  );

  return pid;
}

async function streamPipes(
  proc: Subprocess<"ignore", "pipe", "pipe">,
): Promise<void> {
  const readers: Promise<void>[] = [];
  if (proc.stdout) readers.push(drainStream(proc.stdout.getReader(), "stdout"));
  if (proc.stderr) readers.push(drainStream(proc.stderr.getReader(), "stderr"));
  await Promise.all(readers);
}

async function drainStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  stream: LogEntry["stream"],
): Promise<void> {
  const decoder = new TextDecoder();
  let buf = "";
  const READY =
    /server is listening|llama server is listening|HTTP server listening|all slots are ready/i;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        pushLog(stream, line);
        // managed es live binding: se relee en cada iteración.
        if (READY.test(line) && managed?.readyResolve) {
          managed.readyResolve();
          managed.readyResolve = undefined;
          managed.readyReject = undefined;
        }
      }
    }
    if (buf) pushLog(stream, buf);
  } catch (e) {
    pushLog(
      "system",
      `[backend] error leyendo ${stream}: ${(e as Error).message}`,
    );
  }
}

/** Detiene el servidor gestionado: SIGTERM al grupo, SIGKILL tras 8s si vive. */
export async function stopServer(): Promise<void> {
  if (!managed) {
    setStatus("stopped");
    return;
  }
  const m = managed;
  systemLog(`deteniendo llama-server (pid=${m.pid})…`);
  try {
    // SIGTERM a todo el grupo de proceso.
    process.kill(-m.pid, "SIGTERM");
  } catch {
    try {
      m.proc.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  // Esperar salida ordenada; si no muere en 8s, SIGKILL.
  const exitTimeout = setTimeout(() => {
    try {
      process.kill(-m.pid, "SIGKILL");
    } catch {
      try {
        m.proc.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }, 8000);
  try {
    await m.proc.exited;
  } finally {
    clearTimeout(exitTimeout);
  }
  setManaged(null);
  setStatus("stopped");
}
