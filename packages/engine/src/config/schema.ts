import { DEFAULT_BRAIN_CONFIG } from '../brain/config.js';
import { DEFAULT_TTS_CONFIG } from '../tts/types.js';
import type { BrainConfig } from '../brain/types.js';
import type { TtsConfig } from '../tts/types.js';

/**
 * Esquema unico de configuracion de A.L.P.H.A. Antes habia tres fuentes
 * sueltas (default.yaml sin consumir, defaults del motor, defaults de la UI);
 * esto las reune en un solo objeto versionado que el cargador produce a partir
 * de: estos defaults ← config/default.yaml ← config/local.yaml ← ajustes en
 * vivo del avatar (config/alpha.settings.json).
 */

/** Sube al cambiar la forma del esquema, para migrar configuraciones viejas. */
export const CONFIG_VERSION = 1;

export interface AudioConfig {
  /** Nombre del microfono. Vacio = el predeterminado del sistema. */
  device: string;
  /** Ganancia fija en dB (micros lejanos flojos). */
  gainDb: number;
  /** Normalizacion dinamica (dynaudnorm). */
  normalize: boolean;
  /**
   * Escucha activa. false = ni siquiera se abre la captura, asi que el
   * indicador de microfono del sistema queda apagado. Se persiste: un mute
   * que se olvidara al reiniciar seria una promesa de privacidad a medias.
   */
  micEnabled: boolean;
}

/** Tamanos de modelo whisper que el proyecto sabe descargar y usar. */
export const STT_MODELS = ['base', 'small', 'medium'] as const;
export type SttModel = (typeof STT_MODELS)[number];

export interface SttConfig {
  /** Tamano del modelo whisper: base | small | medium. */
  model: SttModel;
  /** Idioma ISO ('es') o 'auto'. */
  language: string;
}

export interface ConversationConfig {
  /**
   * Permitir cortar a A.L.P.H.A. hablandole mientras responde. La interrupcion
   * la decide la transcripcion (palabras), no el VAD (ruido), y se descarta si
   * lo oido es su propia voz por el altavoz.
   */
  bargeIn: boolean;
  /** Habla minima (ms) para molestarse en transcribir una posible interrupcion. */
  bargeInMinMs: number;
}

export interface AlphaConfig {
  version: number;
  /** Modo confidencial: nada de nube. Es la fuente de verdad; se propaga a
   *  brain.confidential y tts.confidential. */
  confidential: boolean;
  /** Agente activo (identidad del avatar). */
  agent: string;
  audio: AudioConfig;
  stt: SttConfig;
  conversation: ConversationConfig;
  brain: BrainConfig;
  tts: TtsConfig;
}

/** Defaults: el unico origen de la forma. El resto de fuentes lo sobreescriben. */
export const DEFAULT_CONFIG: AlphaConfig = {
  version: CONFIG_VERSION,
  confidential: false,
  agent: 'unit-a',
  audio: { device: '', gainDb: 0, normalize: false, micEnabled: true },
  stt: { model: 'small', language: 'es' },
  conversation: { bargeIn: true, bargeInMinMs: 600 },
  brain: DEFAULT_BRAIN_CONFIG,
  tts: DEFAULT_TTS_CONFIG,
};
