/**
 * Comprueba que el microfono emite audio al ritmo correcto, sin necesidad de
 * hablar ni de tener modelo. Es el primer sitio donde mirar cuando el spike
 * conversacional "no oye": separa un problema de captura de uno de VAD o STT.
 */
import { captureMicrophone } from '../audio/capture.js';
import { captureOptionsFromEnv } from '../audio/options.js';
import { BYTES_PER_SAMPLE, SAMPLE_RATE, framePeak, frameRms, toDbfs } from '../audio/format.js';

const SECONDS = Number(process.argv[2] ?? 3);
const opts = await captureOptionsFromEnv();

console.log(`\n  Microfono: ${opts.device}`);
if (opts.gainDb) console.log(`  Ganancia:  +${opts.gainDb} dB`);
if (opts.normalize) console.log(`  Normalizacion dinamica: activada`);
console.log(`  Capturando ${SECONDS}s...\n`);

const spawned = performance.now();
const capture = captureMicrophone(opts);
let firstByteAt = 0;
let bytes = 0;
let peak = 0;
let sumSquares = 0;
let samples = 0;

const timer = setTimeout(() => capture.stop(), spawned + SECONDS * 1000 - performance.now());

for await (const chunk of capture.pcm) {
  // El reloj arranca en el primer byte, no en el spawn: abrir un dispositivo
  // dshow tarda un par de segundos y contarlos falsearia el ritmo a la baja.
  if (firstByteAt === 0) firstByteAt = performance.now();
  bytes += chunk.length;
  peak = Math.max(peak, framePeak(chunk));
  const chunkSamples = Math.floor(chunk.length / BYTES_PER_SAMPLE);
  sumSquares += frameRms(chunk) ** 2 * chunkSamples;
  samples += chunkSamples;
}
clearTimeout(timer);

const latency = (firstByteAt - spawned) / 1000;
const elapsed = (performance.now() - firstByteAt) / 1000;
const expected = SAMPLE_RATE * BYTES_PER_SAMPLE * elapsed;
const ratio = expected > 0 ? bytes / expected : 0;
const rms = samples > 0 ? Math.sqrt(sumSquares / samples) : 0;

console.log(`  Arranque: ${latency.toFixed(1)}s hasta el primer byte`);
console.log(`  Recibido: ${(bytes / 1024).toFixed(0)} KB en ${elapsed.toFixed(1)}s de flujo`);
console.log(`  Ritmo:    ${(ratio * 100).toFixed(0)}% del esperado para 16 kHz mono`);
console.log(`  Nivel:    pico ${toDbfs(peak).toFixed(1)} dBFS / medio ${toDbfs(rms).toFixed(1)} dBFS\n`);

// Un desfase grande delata un formato mal negociado con ffmpeg, no ruido.
if (bytes === 0) {
  console.log('  ✗ El microfono no emitio nada. Revisa permisos o si otra app lo tiene tomado.\n');
  process.exit(1);
}
if (ratio < 0.8 || ratio > 1.2) {
  console.log('  ✗ El ritmo no cuadra: ffmpeg puede estar entregando otro formato.\n');
  process.exit(1);
}

console.log('  ✓ Captura correcta.');
// Referencias: una sala en calma ronda -60 dBFS de media; hablar cerca del
// microfono, entre -30 y -20. El silencio digital da -Infinity.
if (peak === 0) {
  console.log('  ✗ Silencio digital absoluto: el microfono esta silenciado.\n');
  process.exit(1);
} else if (toDbfs(peak) < -50) {
  console.log('  ! Nivel muy bajo. Sube la ganancia o acercate al microfono.\n');
} else {
  console.log('  ✓ Hay senal.\n');
}
