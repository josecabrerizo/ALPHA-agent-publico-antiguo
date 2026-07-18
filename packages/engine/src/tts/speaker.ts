import { DEFAULT_TTS_CONFIG, type Speaker, type TtsConfig } from './types.js';
import { EdgeSpeaker } from './edge-speaker.js';
import { SapiSpeaker } from './sapi-speaker.js';

/**
 * Crea el hablante segun la configuracion. El modo confidencial manda: si esta
 * activo, siempre se usa el motor local (sapi), pase lo que pase en `engine`.
 */
export function createSpeaker(config: Partial<TtsConfig> = {}): Speaker {
  const cfg = { ...DEFAULT_TTS_CONFIG, ...config };
  const engine = cfg.confidential ? 'sapi' : cfg.engine;
  return engine === 'sapi' ? new SapiSpeaker(cfg.sapiVoice) : new EdgeSpeaker(cfg.edgeVoice);
}
