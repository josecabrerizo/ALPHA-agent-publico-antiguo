import { spawn } from 'node:child_process';
import { SAMPLE_RATE, CHANNELS } from './format.js';

/**
 * Decodifica cualquier fichero de audio al PCM canonico del motor
 * (s16le 16 kHz mono), remuestreando si hace falta.
 *
 * ffmpeg se encarga del formato de origen, asi que sirve igual para un WAV de
 * 44 kHz, un MP3 o el audio de un MP4.
 */
export async function decodeToPcm(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-i',
        filePath,
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

    const chunks: Buffer[] = [];
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    ffmpeg.on('error', (error: NodeJS.ErrnoException) => {
      reject(error.code === 'ENOENT' ? new Error('No se encontro ffmpeg en el PATH.') : error);
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg no pudo decodificar ${filePath}: ${stderr.trim()}`));
        return;
      }
      resolve(Buffer.concat(chunks));
    });
  });
}
