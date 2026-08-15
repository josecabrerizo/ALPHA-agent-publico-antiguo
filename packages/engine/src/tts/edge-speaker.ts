import { spawn, type ChildProcess } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import type { Speaker } from './types.js';

/**
 * Voz online con las voces neuronales de Microsoft Edge (gratis, buena
 * calidad). Sintetiza a MP3 en streaming y lo reproduce con ffplay conforme
 * llega, sin fichero intermedio. Requiere red; en modo confidencial se usa
 * SapiSpeaker en su lugar.
 */
export class EdgeSpeaker implements Speaker {
  private player: ChildProcess | undefined;

  /** `rate` en la misma escala que SAPI (-10..10); se traduce a prosody. */
  constructor(
    private readonly voice: string,
    private readonly rate = 0,
  ) {}

  describe(): ReturnType<Speaker['describe']> {
    return { engine: 'edge', voice: this.voice, local: false };
  }

  async speak(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;

    const tts = new MsEdgeTTS();
    await tts.setMetadata(this.voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);

    const ffplay = spawn('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', '-i', 'pipe:0'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    this.player = ffplay;

    // La escala -10..10 de SAPI se traduce a porcentaje de prosody, para que la
    // configuracion del avatar signifique lo mismo en los dos motores.
    const percent = Math.max(-100, Math.min(100, Math.round(this.rate * 10)));
    const { audioStream } = tts.toStream(clean, {
      rate: `${percent >= 0 ? '+' : ''}${percent}%`,
    });

    await new Promise<void>((resolve, reject) => {
      audioStream.on('data', (chunk: Buffer) => {
        if (ffplay.stdin?.writable) ffplay.stdin.write(chunk);
      });
      audioStream.on('close', () => ffplay.stdin?.end());
      audioStream.on('error', reject);

      ffplay.on('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ENOENT'
            ? new Error('No se encontro ffplay (parte de ffmpeg) para reproducir la voz.')
            : err,
        );
      });
      // ffplay termina (-autoexit) cuando acaba el audio: ahi resolvemos.
      ffplay.on('close', () => {
        if (this.player === ffplay) this.player = undefined;
        resolve();
      });
    });
  }

  stop(): void {
    if (this.player && !this.player.killed) this.player.kill('SIGTERM');
    this.player = undefined;
  }
}
