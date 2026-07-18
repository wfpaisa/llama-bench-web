// Genera src/version.ts desde el package.json de la raíz del repo.
//
// Single source of truth: la versión vive en package.json (raíz). Este script
// la lee y escribe un TS que el frontend importa. Se ejecuta antes de cada
// build/serve/watch del frontend, así la versión mostrada en la UI siempre
// coincide con la del AppImage que se empaqueta (ambos leen el mismo
// package.json).
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const rootPkg = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8'));
const out = join(here, '..', 'src', 'version.ts');

writeFileSync(
  out,
  `// AUTOGENERADO por scripts/generate-version.mjs. No editar a mano.\nexport const APP_VERSION = '${rootPkg.version}'\n`,
);
console.log(`wrote src/version.ts (v${rootPkg.version})`);
