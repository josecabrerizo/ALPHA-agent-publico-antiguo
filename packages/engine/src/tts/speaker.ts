import { DEFAULT_TTS_CONFIG, type Speaker, type TtsConfig } from './types.js';
import { EdgeSpeaker } from './edge-speaker.js';
import { SapiSpeaker } from './sapi-speaker.js';
import { EspeakSpeaker, findEspeak } from './espeak-speaker.js';

/**
 * Crea el hablante segun la configuracion. El modo confidencial manda: si esta
 * activo, siempre se usa el motor local, pase lo que pase en `engine`.
 *
 * "Local" no es sinonimo de SAPI: SAPI es de Windows. Cual sea el motor local
 * depende del sistema, y eso lo decide createLocalSpeaker. Antes se forzaba
 * SAPI siempre, asi que en Linux el modo confidencial arrancaba tan campante y
 * luego lanzaba un error por CADA frase.
 */
export function createSpeaker(config: Partial<TtsConfig> = {}): Speaker {
  const cfg = { ...DEFAULT_TTS_CONFIG, ...config };
  const engine = cfg.confidential ? 'sapi' : cfg.engine;
  return engine === 'sapi'
    ? createLocalSpeaker(cfg.sapiVoice, cfg.rate)
    : new EdgeSpeaker(cfg.edgeVoice, cfg.rate);
}

/**
 * El motor de voz local de ESTE sistema. Falla al construirlo, no al hablar:
 * quedarse sin voz es algo que hay que saber al arrancar, no descubrir frase a
 * frase con la conversacion ya en marcha.
 *
 * @param voice nombre de voz del sistema (solo lo usa SAPI; espeak va por idioma)
 */
export function createLocalSpeaker(voice: string, rate = 0): Speaker {
  if (process.platform === 'win32') return new SapiSpeaker(voice, rate);
  if (process.platform === 'linux') {
    const binary = findEspeak();
    if (binary) return new EspeakSpeaker(binary, 'es', rate);
    throw new Error(
      'No hay motor de voz local en este equipo: instala espeak-ng ' +
        '(apt install espeak-ng / dnf install espeak-ng). Sin el, el modo ' +
        'confidencial se queda sin voz, porque las voces de Edge salen a la nube.',
    );
  }
  throw new Error(
    `No hay motor de voz local para ${process.platform}. ` +
      'Soportados: Windows (SAPI) y Linux (espeak-ng).',
  );
}

/** true si este sistema puede hablar sin salir a la red (modo confidencial). */
export function hasLocalVoice(): boolean {
  if (process.platform === 'win32') return true;
  if (process.platform === 'linux') return findEspeak() !== undefined;
  return false;
}
