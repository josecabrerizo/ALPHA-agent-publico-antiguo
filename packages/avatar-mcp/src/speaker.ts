import { spawn, type ChildProcess } from 'node:child_process';
import type { AvatarOption } from '@alpha/protocol';

/**
 * La voz de la fachada, SIN el motor: un mini-speaker SAPI propio (adaptado
 * del de engine/src/tts/sapi-speaker.ts) para que avatar-mcp no dependa de
 * @alpha/engine — es el desacople que permitira que la fachada viva en el
 * repo del avatar cuando el proyecto se parta.
 *
 * Solo sapi | off: la voz neuronal (edge) es del motor real. Coherente con el
 * contrato confidencial: lo que diga un agente externo no sale a la nube.
 */
export interface Speaker {
  /** Sintetiza el texto y lo reproduce. Resuelve al terminar de sonar. */
  speak(text: string): Promise<void>;
  /** Corta la reproduccion en curso (apagado de la fachada). */
  stop(): void;
}

/**
 * Voz local con las voces del sistema Windows (SAPI / System.Speech). Se
 * invoca PowerShell pasandole el texto por stdin (sin escapar comillas ni
 * acentos) y la voz por variable de entorno (sin inyeccion en el script).
 */
export class SapiSpeaker implements Speaker {
  private proc: ChildProcess | undefined;

  /** `rate` en el rango de SAPI (-10..10); 0 es el ritmo normal. Una voz
   *  vacia deja la voz por defecto del sistema. */
  constructor(
    private readonly voice: string,
    private readonly rate = 0,
  ) {}

  async speak(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    if (process.platform !== 'win32') {
      throw new Error('El motor de voz SAPI solo esta disponible en Windows.');
    }

    const script = [
      'Add-Type -AssemblyName System.Speech',
      '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
      // La voz viene por entorno; si no existe, SelectVoice lanza y queda la de por defecto.
      'try { $s.SelectVoice($env:ALPHA_SAPI_VOICE) } catch {}',
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

/**
 * La fabrica de voz por PERFIL que consume FaceController: cambiar de avatar
 * la vuelve a invocar. Honra ALPHA_MCP_TTS (sapi | off; edge ya no existe en
 * la fachada y cae a sapi con aviso) y devuelve undefined cuando la cara debe
 * funcionar muda (off, modo invalido, o fuera de Windows).
 */
export function createFacadeSpeaker(
  profile: AvatarOption,
  opts: { mode?: string; log?: (message: string) => void } = {},
): Speaker | undefined {
  const log = opts.log ?? (() => {});
  let mode = opts.mode ?? process.env['ALPHA_MCP_TTS'] ?? 'sapi';
  if (mode === 'edge') {
    log(
      'ALPHA_MCP_TTS=edge ya no existe en la fachada (la voz neuronal es del motor real); se usa sapi',
    );
    mode = 'sapi';
  }
  if (mode === 'off') return undefined;
  if (mode !== 'sapi') {
    log(`ALPHA_MCP_TTS="${mode}" no es sapi | off; la cara funciona muda`);
    return undefined;
  }
  if (process.platform !== 'win32') {
    log('sin voz SAPI fuera de Windows; la cara funciona muda');
    return undefined;
  }
  // La voz del perfil solo vale si es SAPI y tiene nombre; si no, la del
  // sistema (voz vacia = por defecto), con el ritmo del perfil de todos modos.
  const voice = profile.voice.engine === 'sapi' && profile.voice.name ? profile.voice.name : '';
  return new SapiSpeaker(voice, profile.voice.rate);
}
