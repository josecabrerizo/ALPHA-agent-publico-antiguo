import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants } from 'node:fs';
import path from 'node:path';
import type { Speaker } from './types.js';

/**
 * Voz local en Linux con espeak-ng (o el viejo espeak). Es el equivalente de
 * SapiSpeaker fuera de Windows: sin red, sin descargas y sin cuenta, que es lo
 * que exige el modo confidencial.
 *
 * No es Piper: Piper baja sus modelos de HuggingFace, bloqueado en esta red.
 * espeak-ng suena peor (es un sintetizador formante, no neuronal) pero esta en
 * los repositorios de cualquier distribucion y no sale de la maquina.
 *
 * El texto va por stdin, no por argumentos: asi no hay que escapar comillas,
 * acentos ni textos que empiecen por "-" — el mismo motivo que en SAPI.
 */

/** Binarios que valen, en orden de preferencia. */
const CANDIDATES = ['espeak-ng', 'espeak'];

/** Ritmo de espeak en palabras por minuto; 175 es su velocidad normal. */
const BASE_WPM = 175;
const WPM_PER_STEP = 12;

/**
 * Busca un ejecutable en el PATH. Es sincrono a proposito: se resuelve al
 * construir el hablante, para que la falta de espeak se sepa AL ARRANCAR y no
 * como un error por cada frase.
 */
export function findEspeak(): string | undefined {
  const dirs = (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean);
  for (const name of CANDIDATES) {
    for (const dir of dirs) {
      const file = path.join(dir, name);
      try {
        accessSync(file, constants.X_OK);
        return file;
      } catch {
        // no esta en este directorio; se sigue buscando
      }
    }
  }
  return undefined;
}

export class EspeakSpeaker implements Speaker {
  private proc: ChildProcess | undefined;

  /**
   * @param binary  ruta del ejecutable (la resuelve findEspeak)
   * @param language codigo de idioma de espeak ('es', 'en'…)
   * @param rate    ritmo en la escala comun -10..10; 0 es el normal
   */
  constructor(
    private readonly binary: string,
    private readonly language = 'es',
    private readonly rate = 0,
  ) {}

  describe(): ReturnType<Speaker['describe']> {
    return { engine: 'espeak', voice: `${path.basename(this.binary)} · ${this.language}`, local: true };
  }

  async speak(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;

    const wpm = Math.max(80, Math.min(450, BASE_WPM + Math.round(this.rate) * WPM_PER_STEP));
    const proc = spawn(this.binary, ['-v', this.language, '-s', String(wpm), '--stdin'], {
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    this.proc = proc;
    proc.stdin?.end(clean, 'utf8');

    await new Promise<void>((resolve, reject) => {
      proc.on('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ENOENT'
            ? new Error(`No se encontro ${this.binary} para la voz local.`)
            : err,
        );
      });
      proc.on('close', () => {
        if (this.proc === proc) this.proc = undefined;
        resolve();
      });
    });
  }

  stop(): void {
    if (this.proc && !this.proc.killed) this.proc.kill();
    this.proc = undefined;
  }
}
