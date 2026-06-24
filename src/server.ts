// Entry del backend.
// Arranca Bun.serve con el router y transpila el frontend (src/front/app.ts)
// a un bundle JS en memoria con Bun.build(), que el router sirve en /app.js.
//
// Con `bun dev --watch`, cualquier edición rebundlea automáticamente porque
// Bun re-ejecuta este entry al detectar cambios.

import { writeFile } from "node:fs/promises";
import { PORT, HISTORY_FILE } from "./config.ts";
import { handleRequest, setFrontendBundle, existsSync } from "./router.ts";
import { ensureDataDir } from "./history.ts";
import { systemLog } from "./logs.ts";

/** Transpila src/front/app.ts → bundle JS de navegador (en memoria). */
async function buildFrontend(): Promise<string> {
  const result = await Bun.build({
    entrypoints: [import.meta.dir + "/front/app.ts"],
    target: "browser",
    format: "esm",
    // Los imports de CodeMirror vienen de esm.sh: se dejan externos para que el
    // navegador los resuelva tal cual (Bun.build no los debe reesolver).
    external: [
      "https://esm.sh/codemirror*",
      "https://esm.sh/@codemirror/*",
    ],
  });
  if (!result.success) {
    const msgs = result.logs.map((l) => l.message).join("\n");
    throw new Error(`Fallo el build del frontend:\n${msgs}`);
  }
  // Un solo output (un entrypoint → un bundle).
  return await result.outputs[0].text();
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
await ensureDataDir();
if (existsSync(HISTORY_FILE) === false) await writeFile(HISTORY_FILE, "[]");

const appJs = await buildFrontend();
setFrontendBundle(appJs);

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: handleRequest,
});

systemLog(`backend escuchando en http://localhost:${server.port}`);
console.log(`→ http://localhost:${server.port}`);
