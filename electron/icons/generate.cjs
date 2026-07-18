// Genera los PNG del icono del AppImage a partir de plane-llama-bench.svg.
//
// electron-builder (Linux/AppImage) requiere PNG de 256x256 y 512x512 como
// mínimo. Los generamos con `rsvg-convert` (de librsvg) leyendo el SVG fuente
// (plane-llama-bench.svg). Los .png son build artifacts y se gitignoran;
// este script los regenera en cada `build:electron`, así nunca quedan
// desactualizados.
//
// Idempotente: se puede correr las veces que haga falta.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const dir = __dirname
const svg = path.join(dir, 'plane-llama-bench.svg')
const sizes = [256, 512]

if (!fs.existsSync(svg)) {
  console.error(`✗ No se encontró ${svg}`)
  process.exit(1)
}

const probe = spawnSync('rsvg-convert', ['--version'], { encoding: 'utf8' })
if (probe.error || probe.status !== 0) {
  console.error('✗ rsvg-convert no está disponible. Instalá librsvg (pacman -S librsvg / apt install librsvg2-bin).')
  process.exit(1)
}

for (const size of sizes) {
  const out = path.join(dir, `${size}x${size}.png`)
  const res = spawnSync('rsvg-convert', ['-w', String(size), '-h', String(size), svg, '-o', out], {
    encoding: 'utf8',
  })
  if (res.status !== 0) {
    console.error(`✗ Falló la generación de ${out}\n${res.stderr}`)
    process.exit(1)
  }
  console.log(`✓ ${path.relative(process.cwd(), out)}`)
}
