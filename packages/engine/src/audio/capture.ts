import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { SAMPLE_RATE, CHANNELS } from './format.js';

export interface CaptureOptions {
  /** Nombre del dispositivo para ffmpeg. Por defecto, el primero del sistema. */
  device?: string;
  /**
   * Ganancia fija en dB. Util para subir un micro constante pero flojo. Con
   * micros lejanos, cuyo nivel varia mucho segun la distancia, es mejor
   * `normalize`: una ganancia fija o se queda corta o satura. 0 = sin tocar.
   */
  gainDb?: number;
  /**
   * Normalizacion dinamica (ffmpeg dynaudnorm): auto-nivela la senal en tiempo
   * real, hable el usuario cerca o lejos, fuerte o flojo. Es lo que necesita un
   * array integrado para entregar a whisper un nivel estable. Una senal
   * inconsistente es la causa numero uno de que whisper "alucine" frases.
   */
  normalize?: boolean;
}

export interface CaptureHandle {
  /** PCM crudo s16le 16 kHz mono. */
  pcm: Readable;
  stop(): void;
}

/**
 * Captura el microfono spawneando ffmpeg y leyendo PCM crudo por stdout.
 *
 * Se usa ffmpeg en vez de bindings nativos (naudiodon y compania) a proposito:
 * evita compilar modulos por plataforma y por version de Node, y ya es una
 * dependencia del proyecto para grabacion de pantalla.
 *
 * OJO: abrir el dispositivo tarda ~1,8 s (medido en Windows/dshow) antes del
 * primer byte. Si el avatar se pone a "escuchando" al pulsar, se comera el
 * principio de la frase. Hay que esperar al primer chunk para dar la senal de
 * grabacion, o mantener ffmpeg caliente entre sesiones.
 */
export function captureMicrophone(options: CaptureOptions = {}): CaptureHandle {
  const input = buildInputArgs(options.device);
  // El filtrado se hace en ffmpeg, antes de cuantizar a s16le: sin escalones
  // ni recorte. dynaudnorm va despues del volume por si se combinan.
  const filters: string[] = [];
  if (options.gainDb) filters.push(`volume=${options.gainDb}dB`);
  // dynaudnorm con ventana corta (f=150ms) y algo de suavizado (g=15) para
  // reaccionar rapido al empezar a hablar sin bombear en cada silaba. m=64 sube
  // el tope de amplificacion (por defecto 10x/+20dB, corto para un array
  // integrado que entrega la voz a -60 dBFS); p=0.9 deja headroom para no tocar
  // techo y provocar el recorte que hace alucinar a whisper.
  if (options.normalize) filters.push('dynaudnorm=f=150:g=15:m=64:p=0.9');
  const filterArgs = filters.length > 0 ? ['-af', filters.join(',')] : [];

  // stdin va a 'ignore': ffmpeg no recibe nada, solo emite PCM por stdout.
  const ffmpeg: ChildProcessByStdio<null, Readable, Readable> = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...input,
      ...filterArgs,
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      String(CHANNELS),
      '-f',
      's16le',
      'pipe:1',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  ffmpeg.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      ffmpeg.stdout.destroy(
        new Error('No se encontro ffmpeg en el PATH. Instalalo para capturar audio.'),
      );
      return;
    }
    ffmpeg.stdout.destroy(error);
  });

  // ffmpeg reporta dispositivo ocupado o inexistente por stderr y luego sale;
  // sin esto el fallo seria un stream que simplemente no emite nada.
  let stderr = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  ffmpeg.on('close', (code) => {
    if (code !== 0 && code !== null && !ffmpeg.stdout.destroyed) {
      ffmpeg.stdout.destroy(new Error(`ffmpeg fallo (codigo ${code}): ${stderr.trim()}`));
    }
  });

  return {
    pcm: ffmpeg.stdout,
    stop: () => {
      if (!ffmpeg.killed) ffmpeg.kill('SIGTERM');
    },
  };
}

function buildInputArgs(device: string | undefined): string[] {
  if (process.platform === 'win32') {
    if (!device) throw new Error('En Windows hay que indicar el dispositivo dshow explicitamente.');
    return ['-f', 'dshow', '-i', `audio=${device}`];
  }
  if (process.platform === 'linux') {
    return ['-f', 'pulse', '-i', device ?? 'default'];
  }
  throw new Error(`Plataforma no soportada para captura de audio: ${process.platform}`);
}
