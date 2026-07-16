/**
 * Formato PCM canonico del motor. Fijado por whisper.cpp, que solo acepta
 * 16 kHz mono; capturar en otro formato obliga a remuestrear despues.
 */
export const SAMPLE_RATE = 16_000;
export const CHANNELS = 1;
export const BYTES_PER_SAMPLE = 2; // s16le

/** Duracion de la trama de analisis del VAD. */
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (SAMPLE_RATE * FRAME_MS) / 1000; // 320
export const FRAME_BYTES = FRAME_SAMPLES * BYTES_PER_SAMPLE; // 640

export function bytesToMs(bytes: number): number {
  return (bytes / (SAMPLE_RATE * BYTES_PER_SAMPLE * CHANNELS)) * 1000;
}

/** Envuelve PCM crudo en un WAV de 44 bytes; whisper-cli exige fichero WAV. */
export function pcmToWav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;

  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16); // tamano del bloque fmt
  header.writeUInt16LE(1, 20); // PCM sin comprimir
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(CHANNELS * BYTES_PER_SAMPLE, 32); // block align
  header.writeUInt16LE(BYTES_PER_SAMPLE * 8, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcm.length, 40);

  return Buffer.concat([header, pcm]);
}

/** RMS normalizado a 0..1 de una trama s16le. */
export function frameRms(frame: Buffer): number {
  const samples = Math.floor(frame.length / BYTES_PER_SAMPLE);
  if (samples === 0) return 0;

  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const sample = frame.readInt16LE(i * BYTES_PER_SAMPLE) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}
