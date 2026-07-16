import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { SAMPLE_RATE, CHANNELS } from './format.js';

export interface CaptureOptions {
  /** Nombre del dispositivo para ffmpeg. Por defecto, el primero del sistema. */
  device?: string;
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
 */
export function captureMicrophone(options: CaptureOptions = {}): CaptureHandle {
  const input = buildInputArgs(options.device);

  // stdin va a 'ignore': ffmpeg no recibe nada, solo emite PCM por stdout.
  const ffmpeg: ChildProcessByStdio<null, Readable, Readable> = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      ...input,
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
