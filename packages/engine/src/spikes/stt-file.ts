/**
 * Transcribe un fichero de audio. Uso:
 *   npm run spike:stt-file -- ruta/al/audio.wav
 *
 * Ejercita la misma cadena que el microfono (ffmpeg -> PCM -> whisper.cpp)
 * pero de forma reproducible, sin depender de que alguien hable. Es la via
 * para depurar el STT cuando la transcripcion en vivo sale rara.
 */
import { decodeToPcm } from '../audio/decode.js';
import { bytesToMs } from '../audio/format.js';
import { WhisperTranscriber } from '../stt/whisper.js';

const file = process.argv[2];
if (!file) {
  console.error('Falta la ruta del fichero.\nUso: npm run spike:stt-file -- audio.wav');
  process.exit(1);
}

const beamSize = Number(process.env['ALPHA_STT_BEAM'] ?? 5);
const transcriber = new WhisperTranscriber({
  language: process.env['ALPHA_LANG'] ?? 'es',
  beamSize: Number.isFinite(beamSize) ? beamSize : 5,
  ...(process.env['ALPHA_STT_PROMPT'] ? { initialPrompt: process.env['ALPHA_STT_PROMPT'] } : {}),
});

console.log(`\n  Fichero: ${file}`);
const pcm = await decodeToPcm(file);
console.log(`  Audio:   ${(bytesToMs(pcm.length) / 1000).toFixed(1)}s`);

const started = performance.now();
const text = await transcriber.transcribe(pcm);
const elapsed = Math.round(performance.now() - started);

console.log(`\n  › ${text || '(sin habla detectada)'}\n`);
console.log(`  Transcrito en ${elapsed} ms\n`);
