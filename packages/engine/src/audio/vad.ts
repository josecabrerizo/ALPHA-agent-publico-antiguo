import { BYTES_PER_SAMPLE, FRAME_BYTES, FRAME_MS, bytesToMs, frameRms } from './format.js';

export interface Utterance {
  /** PCM s16le 16 kHz mono de un unico tramo hablado, pre-roll incluido. */
  pcm: Buffer;
  /** Duracion del buffer completo. */
  durationMs: number;
  /** Habla real, sin pre-roll. Es lo que decide si el tramo merece transcribirse. */
  speechMs: number;
}

export interface VadOptions {
  /** Silencio necesario para dar por cerrado un tramo hablado. */
  hangoverMs?: number;
  /** Habla mas corta que esto se descarta: es un chasquido. No cuenta el pre-roll. */
  minUtteranceMs?: number;
  /** Audio previo al disparo que se conserva, para no comerse la primera silaba. */
  preRollMs?: number;
  /** Cuanto debe superar el ruido de fondo una trama para contar como voz. */
  thresholdFactor?: number;
  /** Suelo absoluto de RMS: por debajo nunca es voz, por silencioso que sea el cuarto. */
  floorRms?: number;
  /** Nivel de cada trama (0..1), para pintar un medidor en la UI. */
  onLevel?: (level: number, speaking: boolean) => void;
}

const DEFAULTS = {
  hangoverMs: 700,
  minUtteranceMs: 300,
  preRollMs: 300,
  thresholdFactor: 3.0,
  floorRms: 0.006,
} as const;

/**
 * VAD por energia: segmenta el PCM en tramos hablados.
 *
 * Deliberadamente simple y sin dependencias. El ruido de fondo se estima en
 * caliente, asi que se adapta al ventilador o al aire acondicionado sin
 * calibracion previa. Si resulta corto (television de fondo, varias voces),
 * el punto de sustitucion es este: cambiar por Silero via onnxruntime-node
 * sin tocar quien lo consume.
 */
export async function* detectUtterances(
  source: AsyncIterable<Buffer>,
  options: VadOptions = {},
): AsyncGenerator<Utterance> {
  const hangoverMs = options.hangoverMs ?? DEFAULTS.hangoverMs;
  const minUtteranceMs = options.minUtteranceMs ?? DEFAULTS.minUtteranceMs;
  const preRollMs = options.preRollMs ?? DEFAULTS.preRollMs;
  const thresholdFactor = options.thresholdFactor ?? DEFAULTS.thresholdFactor;
  const floorRms = options.floorRms ?? DEFAULTS.floorRms;
  const onLevel = options.onLevel;

  const hangoverFrames = Math.ceil(hangoverMs / FRAME_MS);
  const preRollFrames = Math.ceil(preRollMs / FRAME_MS);

  let leftover = Buffer.alloc(0);
  let noiseFloor = floorRms;
  let speaking = false;
  let silentFrames = 0;
  const preRoll: Buffer[] = [];
  let current: Buffer[] = [];
  let preRollFramesInCurrent = 0;

  for await (const chunk of source) {
    const data = leftover.length > 0 ? Buffer.concat([leftover, chunk]) : chunk;

    let offset = 0;
    while (offset + FRAME_BYTES <= data.length) {
      const frame = data.subarray(offset, offset + FRAME_BYTES);
      offset += FRAME_BYTES;

      const rms = frameRms(frame);
      const threshold = Math.max(floorRms, noiseFloor * thresholdFactor);
      const isSpeech = rms > threshold;

      onLevel?.(rms, isSpeech);

      if (!speaking) {
        // El ruido de fondo solo se reestima en silencio; hacerlo mientras
        // alguien habla subiria el umbral hasta dejar de oirle.
        noiseFloor = noiseFloor * 0.95 + rms * 0.05;

        preRoll.push(Buffer.from(frame));
        if (preRoll.length > preRollFrames) preRoll.shift();

        if (isSpeech) {
          speaking = true;
          silentFrames = 0;
          current = [...preRoll];
          preRollFramesInCurrent = preRoll.length;
          preRoll.length = 0;
        }
        continue;
      }

      current.push(Buffer.from(frame));
      if (isSpeech) {
        silentFrames = 0;
        continue;
      }

      silentFrames++;
      if (silentFrames < hangoverFrames) continue;

      // Se cierra el tramo: el hangover final es silencio, sobra.
      const trimmed = current.slice(0, current.length - silentFrames);
      const speechFrames = trimmed.length - preRollFramesInCurrent;
      speaking = false;
      silentFrames = 0;
      current = [];

      const utterance = toUtterance(trimmed, speechFrames);
      if (utterance && utterance.speechMs >= minUtteranceMs) yield utterance;
    }

    leftover = offset < data.length ? Buffer.from(data.subarray(offset)) : Buffer.alloc(0);
  }

  // El stream termino a media frase: no se pierde.
  if (speaking) {
    const utterance = toUtterance(current, current.length - preRollFramesInCurrent);
    if (utterance && utterance.speechMs >= minUtteranceMs) yield utterance;
  }
}

function toUtterance(frames: Buffer[], speechFrames: number): Utterance | undefined {
  if (frames.length === 0 || speechFrames <= 0) return undefined;
  const pcm = Buffer.concat(frames);
  if (pcm.length < BYTES_PER_SAMPLE) return undefined;
  return {
    pcm,
    durationMs: bytesToMs(pcm.length),
    speechMs: speechFrames * FRAME_MS,
  };
}
