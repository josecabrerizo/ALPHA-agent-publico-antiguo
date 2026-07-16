import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectUtterances, type Utterance } from './vad.js';
import { SAMPLE_RATE, pcmToWav } from './format.js';

/** Genera PCM: tono a la amplitud dada, sobre un suelo de ruido realista. */
function pcm(ms: number, amplitude: number): Buffer {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const tone = Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) * amplitude;
    const noise = (Math.sin(i * 12.9898) * 43758.5453) % 0.002; // ruido determinista
    const value = Math.round((tone + noise) * 32767);
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, value)), i * 2);
  }
  return buf;
}

/**
 * Trocea a un tamano que NO es multiplo de la trama de 20 ms, como hace ffmpeg.
 * Es el caso que rompe un VAD que asuma chunks alineados.
 */
async function* chunked(data: Buffer, size = 3571): AsyncGenerator<Buffer> {
  for (let i = 0; i < data.length; i += size) {
    yield data.subarray(i, Math.min(i + size, data.length));
  }
}

async function collect(source: AsyncIterable<Buffer>): Promise<Utterance[]> {
  const utterances: Utterance[] = [];
  for await (const utterance of detectUtterances(source)) utterances.push(utterance);
  return utterances;
}

test('segmenta dos tramos hablados separados por silencio', async () => {
  const timeline = Buffer.concat([pcm(600, 0), pcm(1000, 0.25), pcm(900, 0), pcm(600, 0.25), pcm(900, 0)]);
  const found = await collect(chunked(timeline));

  assert.equal(found.length, 2, `esperaba 2 tramos, salieron ${found.length}`);
  assert.ok(Math.abs(found[0]!.speechMs - 1000) <= 120, `habla 1: ${found[0]!.speechMs}ms, esperaba ~1000`);
  assert.ok(Math.abs(found[1]!.speechMs - 600) <= 120, `habla 2: ${found[1]!.speechMs}ms, esperaba ~600`);
  // El buffer emitido lleva ademas el pre-roll, para no comerse la primera silaba.
  assert.ok(found[0]!.durationMs > found[0]!.speechMs, 'falta el pre-roll en el buffer');
});

test('descarta chasquidos mas cortos que minUtteranceMs', async () => {
  const timeline = Buffer.concat([pcm(600, 0), pcm(80, 0.25), pcm(900, 0)]);
  assert.deepEqual(await collect(chunked(timeline)), []);
});

test('no emite nada con solo silencio', async () => {
  assert.deepEqual(await collect(chunked(pcm(3000, 0))), []);
});

test('cierra el tramo si el audio se corta a media frase', async () => {
  // Sin silencio final: el stream muere mientras el hablante sigue.
  const found = await collect(chunked(Buffer.concat([pcm(600, 0), pcm(1000, 0.25)])));
  assert.equal(found.length, 1, 'el tramo en curso no debe perderse al cerrar el stream');
});

test('el WAV generado lleva cabecera valida para whisper.cpp', () => {
  const wav = pcmToWav(pcm(100, 0.2));
  assert.equal(wav.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(wav.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(wav.readUInt32LE(24), SAMPLE_RATE, 'whisper.cpp solo acepta 16 kHz');
  assert.equal(wav.readUInt16LE(22), 1, 'whisper.cpp solo acepta mono');
  assert.equal(wav.readUInt32LE(4), wav.length - 8, 'tamano RIFF incoherente');
});
