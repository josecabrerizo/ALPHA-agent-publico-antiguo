#!/usr/bin/env node
/**
 * Descarga el binario oficial de whisper.cpp y un modelo ggml.
 *
 * Ambos quedan fuera de git (cientos de MB), asi que este script es lo que
 * hace reproducible un clon limpio. Uso:
 *   node tools/fetch-whisper.mjs [--model small|base|medium] [--force]
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createWriteStream } from 'node:fs';
import { access, cp, mkdir, mkdtemp, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const execFileAsync = promisify(execFile);

const WHISPER_VERSION = 'v1.9.1';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(repoRoot, 'vendor', 'whisper');
const modelsDir = path.join(repoRoot, 'models');

const args = process.argv.slice(2);
const force = args.includes('--force');
const modelSize = valueOf('--model') ?? 'small';

function valueOf(flag) {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Assets publicados en la release de whisper.cpp, por plataforma. */
function binaryAsset() {
  const { platform, arch } = process;
  if (platform === 'win32' && arch === 'x64') return 'whisper-bin-x64.zip';
  if (platform === 'linux' && arch === 'x64') return 'whisper-bin-ubuntu-x64.tar.gz';
  if (platform === 'linux' && arch === 'arm64') return 'whisper-bin-ubuntu-arm64.tar.gz';
  throw new Error(
    `No hay binario oficial de whisper.cpp para ${platform}/${arch}. ` +
      'Compilalo a mano y deja whisper-cli en vendor/whisper/.',
  );
}

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

/**
 * HuggingFace devuelve 504 de su gateway de forma esporadica, y perder medio
 * giga por un error transitorio no es aceptable. Reintenta con espera creciente.
 */
async function downloadWithRetry(url, dest, attempts = 4) {
  for (let attempt = 1; ; attempt++) {
    try {
      await download(url, dest);
      return;
    } catch (error) {
      if (attempt >= attempts) throw error;
      const waitMs = 2000 * 2 ** (attempt - 1);
      console.log(`\n  ! ${error.message}`);
      console.log(`  Reintento ${attempt}/${attempts - 1} en ${waitMs / 1000}s...`);
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

async function download(url, dest) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Descarga fallida (${response.status}) de ${url}`);
  }

  const total = Number(response.headers.get('content-length') ?? 0);
  let received = 0;
  const label = path.basename(dest);

  const body = Readable.fromWeb(response.body);
  body.on('data', (chunk) => {
    received += chunk.length;
    const pct = total ? ` ${((received / total) * 100).toFixed(0)}%` : '';
    const mb = (received / 1024 / 1024).toFixed(1);
    process.stdout.write(`\r  ${label}: ${mb} MB${pct}   `);
  });

  await pipeline(body, createWriteStream(dest));
  process.stdout.write('\n');
}

async function extract(archive, destDir) {
  if (archive.endsWith('.zip')) {
    // Expand-Archive en vez de unzip: siempre esta en Windows, unzip no.
    await execFileAsync('powershell', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Expand-Archive -LiteralPath '${archive}' -DestinationPath '${destDir}' -Force`,
    ]);
    return;
  }
  await execFileAsync('tar', ['-xzf', archive, '-C', destDir]);
}

/** Localiza el directorio que contiene whisper-cli; las DLL viajan con el. */
async function findBinaryDir(root) {
  const wanted = process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli';
  const pending = [root];
  while (pending.length > 0) {
    const dir = pending.shift();
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) pending.push(path.join(dir, entry.name));
      else if (entry.name === wanted) return dir;
    }
  }
  throw new Error(`El archivo descargado no contiene ${wanted}.`);
}

async function setupBinary() {
  const marker = path.join(vendorDir, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  if (!force && (await exists(marker))) {
    console.log(`✓ Binario ya presente en ${path.relative(repoRoot, marker)}`);
    return;
  }

  const asset = binaryAsset();
  const url = `https://github.com/ggml-org/whisper.cpp/releases/download/${WHISPER_VERSION}/${asset}`;
  console.log(`\nDescargando whisper.cpp ${WHISPER_VERSION} (${asset})...`);

  const work = await mkdtemp(path.join(tmpdir(), 'alpha-whisper-'));
  try {
    const archive = path.join(work, asset);
    await downloadWithRetry(url, archive);

    const unpacked = path.join(work, 'unpacked');
    await mkdir(unpacked, { recursive: true });
    await extract(archive, unpacked);

    const binDir = await findBinaryDir(unpacked);
    await mkdir(vendorDir, { recursive: true });
    // Se copia el directorio entero: en Windows el .exe no arranca sin sus DLL al lado.
    await cp(binDir, vendorDir, { recursive: true });

    if (process.platform !== 'win32') {
      await execFileAsync('chmod', ['+x', marker]);
    }
    console.log(`✓ Binario en ${path.relative(repoRoot, vendorDir)}`);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

async function setupModel() {
  const dest = path.join(modelsDir, `ggml-${modelSize}.bin`);
  if (!force && (await exists(dest))) {
    const { size } = await stat(dest);
    console.log(`✓ Modelo ya presente (${(size / 1024 / 1024).toFixed(0)} MB)`);
    return;
  }

  const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelSize}.bin?download=true`;
  console.log(`\nDescargando modelo ggml-${modelSize}...`);
  await mkdir(modelsDir, { recursive: true });

  const partial = `${dest}.partial`;
  try {
    await downloadWithRetry(url, partial);
    await cp(partial, dest);
    console.log(`✓ Modelo en ${path.relative(repoRoot, dest)}`);
  } finally {
    // Un .partial superviviente enganaria al chequeo de "ya presente".
    await rm(partial, { force: true });
  }
}

await setupBinary();
await setupModel();
console.log('\nListo. Prueba con: npm run spike:stt\n');
