import { spawn, type ChildProcess } from 'node:child_process';
import type { Speaker } from './types.js';

/**
 * Voz local con las voces del sistema Windows (SAPI / System.Speech). Sin red
 * ni descargas: es el motor del modo confidencial, y el fallback cuando no hay
 * conexion. Calidad inferior a las neuronales de Edge, pero siempre disponible.
 *
 * Se invoca PowerShell pasandole el texto por stdin (asi no hay que escapar
 * comillas ni acentos) y la voz por variable de entorno (evita inyeccion en el
 * script). Reproduce por el altavoz predeterminado del sistema.
 */
export class SapiSpeaker implements Speaker {
  private proc: ChildProcess | undefined;

  /** `rate` en el rango de SAPI (-10..10); 0 es el ritmo normal. */
  constructor(
    private readonly voice: string,
    private readonly rate = 0,
  ) {}

  describe(): ReturnType<Speaker['describe']> {
    return { engine: 'sapi', voice: this.voice, local: true };
  }

  async speak(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    if (process.platform !== 'win32') {
      throw new Error('El motor de voz SAPI solo esta disponible en Windows.');
    }

    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      // La voz viene por entorno; si no existe, SelectVoice lanza y usamos la de por defecto.
      'try { $s.SelectVoice($env:ALPHA_SAPI_VOICE) } catch {}',
      // El ritmo da caracter cuando todos los avatares locales comparten voz.
      'try { $s.Rate = [int]$env:ALPHA_SAPI_RATE } catch {}',
      '$text = [Console]::In.ReadToEnd()',
      '$s.Speak($text)',
      '$s.Dispose()',
    ].join('; ');

    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['pipe', 'ignore', 'ignore'],
      env: {
        ...process.env,
        ALPHA_SAPI_VOICE: this.voice,
        ALPHA_SAPI_RATE: String(Math.max(-10, Math.min(10, Math.round(this.rate)))),
      },
    });
    this.proc = ps;

    ps.stdin?.end(clean, 'utf8');

    await new Promise<void>((resolve, reject) => {
      ps.on('error', (err: NodeJS.ErrnoException) => {
        reject(
          err.code === 'ENOENT' ? new Error('No se encontro PowerShell para la voz SAPI.') : err,
        );
      });
      ps.on('close', () => {
        if (this.proc === ps) this.proc = undefined;
        resolve();
      });
    });
  }

  stop(): void {
    if (this.proc && !this.proc.killed) this.proc.kill();
    this.proc = undefined;
  }
}
