// Genera dist-electron/package.json tras compilar el shell de Electron.
//
// El package.json raíz tiene "type":"module" (backend Bun). El shell compilado
// es CommonJS (Electron/main requiere require/exports). Sin un package.json
// local con "type":"commonjs", Node trataría dist-electron/main.js como ESM y
// Electron fallaría al arrancar dentro del asar. Este archivo se gitignora
// (dist-electron/), por eso se regenera en cada build:electron.
const fs = require('node:fs')
const path = require('node:path')

fs.mkdirSync('dist-electron', { recursive: true })
fs.writeFileSync(path.join('dist-electron', 'package.json'), JSON.stringify({ type: 'commonjs', main: 'main.js' }, null, 2) + '\n')
console.log('wrote dist-electron/package.json')
