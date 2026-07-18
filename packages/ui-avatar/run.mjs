#!/usr/bin/env node
/**
 * Lanza la UI del avatar con qode, resolviendo el PATH de Qt automaticamente.
 *
 * En Windows, el addon nativo de NodeGui (nodegui_core.node) depende de las
 * DLL de Qt, que estan en node_modules/@nodegui/nodegui/miniqt/.../bin pero no
 * junto al .node. El cargador de DLL no las encuentra solo. Este lanzador las
 * mete en el PATH (en formato del SO, no el de bash) antes de arrancar qode,
 * de modo que `npm run dev` funciona sin preparar nada a mano.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../..');
const nodeguiDir = path.join(repoRoot, 'node_modules', '@nodegui', 'nodegui');
const script = path.join(here, 'dist', 'index.js');

/** Localiza miniqt/<version>/<compilador>/bin sin cablear la version. */
function findQtBin() {
  const miniqt = path.join(nodeguiDir, 'miniqt');
  if (!existsSync(miniqt)) return undefined;
  for (const version of readdirSync(miniqt)) {
    const versionDir = path.join(miniqt, version);
    for (const compiler of readdirSync(versionDir)) {
      const bin = path.join(versionDir, compiler, process.platform === 'win32' ? 'bin' : 'lib');
      if (existsSync(bin)) return bin;
    }
  }
  return undefined;
}

function findQode() {
  const name = process.platform === 'win32' ? 'qode.exe' : 'qode';
  const candidate = path.join(repoRoot, 'node_modules', '@nodegui', 'qode', 'binaries', name);
  return existsSync(candidate) ? candidate : name; // si no, confiar en el PATH
}

if (!existsSync(script)) {
  console.error(`No existe ${script}. Compila antes: npm run build`);
  process.exit(1);
}

const qtBin = findQtBin();
if (qtBin) {
  // path.delimiter = ';' en Windows, ':' en Linux. Es lo que evita el fallo
  // que tuvimos al usar el separador de bash con un ejecutable de Windows.
  const varName = process.platform === 'win32' ? 'PATH' : 'LD_LIBRARY_PATH';
  process.env[varName] = qtBin + path.delimiter + (process.env[varName] ?? '');
}

// windowsHide evita que qode (app de consola) abra una ventana de terminal
// propia cuando se lanza sin una consola adjunta. En un terminal normal los
// logs siguen saliendo por stdio heredado; la ventana negra suelta desaparece.
// El "cero consola" definitivo llegara al empaquetar (@nodegui/packer).
const child = spawn(findQode(), [script], {
  stdio: 'inherit',
  env: process.env,
  windowsHide: true,
});
child.on('exit', (code) => process.exit(code ?? 0));
