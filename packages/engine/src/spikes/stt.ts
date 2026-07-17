/**
 * Spike 1 del MVP: hablar al microfono y ver la transcripcion en consola.
 *
 * Valida la capa mas arriesgada del motor de punta a punta —captura, VAD y
 * STT— sin UI, sin LLM y sin un solo modulo nativo.
 */
import { captureMicrophone } from '../audio/capture.js';
import { captureOptionsFromEnv } from '../audio/options.js';
import { detectUtterances, type Utterance } from '../audio/vad.js';
import { WhisperTranscriber } from '../stt/whisper.js';

const capture_opts = await captureOptionsFromEnv();
const transcriber = new WhisperTranscriber({ language: process.env['ALPHA_LANG'] ?? 'es' });

console.log(`\n  A.L.P.H.A. — spike audio→texto`);
console.log(`  Microfono: ${capture_opts.device}`);
if (capture_opts.gainDb) console.log(`  Ganancia:  +${capture_opts.gainDb} dB`);
if (capture_opts.normalize) console.log(`  Normalizacion dinamica: activada`);
console.log(`  Habla normalmente. Ctrl+C para salir.\n`);

const capture = captureMicrophone(capture_opts);

// Sin esto, ffmpeg se bloquea en cuanto una transcripcion tarda mas que el
// buffer por defecto del pipe (64 KB = 2 s de audio) y se pierde habla.
capture.pcm.setMaxListeners(0);

const stop = () => {
  capture.stop();
  process.stdout.write('\n\n  Fin.\n');
  process.exit(0);
};
process.on('SIGINT', stop);

function drawLevel(level: number, speaking: boolean): void {
  const width = 24;
  const filled = Math.min(width, Math.round(level * width * 8));
  const bar = '█'.repeat(filled).padEnd(width, '·');
  const state = speaking ? 'escuchando' : '  silencio';
  process.stdout.write(`\r  ${state} [${bar}]`);
}

async function transcribeAndPrint(utterance: Utterance): Promise<void> {
  const started = performance.now();
  try {
    const text = await transcriber.transcribe(utterance.pcm);
    const elapsed = Math.round(performance.now() - started);
    if (!text) return;
    const secs = (utterance.durationMs / 1000).toFixed(1);
    process.stdout.write(`\r${' '.repeat(40)}\r`);
    console.log(`  › ${text}`);
    console.log(`    (${secs}s de audio, transcrito en ${elapsed} ms)\n`);
  } catch (error) {
    process.stdout.write(`\r${' '.repeat(40)}\r`);
    console.error(`  ✗ ${(error as Error).message}\n`);
  }
}

// Las transcripciones se encadenan en segundo plano en vez de esperarse aqui:
// awaitear dentro del bucle dejaria de leer el PCM y ffmpeg perderia audio.
let chain: Promise<void> = Promise.resolve();

try {
  for await (const utterance of detectUtterances(capture.pcm, { onLevel: drawLevel })) {
    chain = chain.then(() => transcribeAndPrint(utterance));
  }
  await chain;
} catch (error) {
  console.error(`\n  ✗ ${(error as Error).message}\n`);
  capture.stop();
  process.exit(1);
}
