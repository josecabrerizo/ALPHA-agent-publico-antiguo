/**
 * Spike: transcribir lo que suena en el PC (audio del sistema) en vivo.
 *
 * Reutiliza VAD y whisper tal cual: captureSystemAudio entrega el mismo PCM
 * 16 kHz mono que el microfono, solo cambia el origen. Pon musica, un video o
 * una reunion y mira como se transcribe.
 */
import { captureSystemAudio, listOutputDevices } from '../audio/loopback.js';
import { detectUtterances, type Utterance } from '../audio/vad.js';
import { WhisperTranscriber } from '../stt/whisper.js';

const gainDb = Number(process.env['ALPHA_LOOPBACK_GAIN'] ?? 0);
const beamSize = Number(process.env['ALPHA_STT_BEAM'] ?? 5);
const transcriber = new WhisperTranscriber({
  language: process.env['ALPHA_LANG'] ?? 'es',
  beamSize: Number.isFinite(beamSize) ? beamSize : 5,
});

console.log(`\n  A.L.P.H.A. — spike audio del sistema (loopback)`);
console.log(`  Salidas disponibles:`);
for (const name of listOutputDevices()) console.log(`    · ${name}`);
console.log(`\n  Capturando la salida predeterminada. Pon algo a sonar. Ctrl+C para salir.\n`);

const capture = captureSystemAudio({
  ...(gainDb ? { gainDb } : {}),
  ...(process.env['ALPHA_OUTPUT_DEVICE'] ? { outputDeviceName: process.env['ALPHA_OUTPUT_DEVICE'] } : {}),
});
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
  process.stdout.write(`\r  ${speaking ? '   sonando' : '  silencio'} [${bar}]`);
}

let chain: Promise<void> = Promise.resolve();

async function transcribeAndPrint(u: Utterance): Promise<void> {
  try {
    const text = await transcriber.transcribe(u.pcm);
    if (!text) return;
    process.stdout.write(`\r${' '.repeat(40)}\r`);
    console.log(`  › ${text}`);
  } catch (error) {
    process.stdout.write(`\r${' '.repeat(40)}\r`);
    console.error(`  ✗ ${(error as Error).message}`);
  }
}

try {
  for await (const u of detectUtterances(capture.pcm, { onLevel: drawLevel })) {
    chain = chain.then(() => transcribeAndPrint(u));
  }
  await chain;
} catch (error) {
  console.error(`\n  ✗ ${(error as Error).message}\n`);
  capture.stop();
  process.exit(1);
}
