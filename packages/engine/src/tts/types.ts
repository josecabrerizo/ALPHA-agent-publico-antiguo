/**
 * Sintesis de voz. Dos motores tras una misma interfaz, como el cerebro con
 * sus proveedores:
 *   - edge: voces neuronales de Microsoft Edge (online, mejor calidad).
 *   - sapi: voces del sistema Windows (local, sin red ni descargas).
 * El modo confidencial fuerza el motor local.
 */
export type VoiceEngine = 'edge' | 'sapi';

export interface Speaker {
  /** Sintetiza el texto y lo reproduce. Resuelve al terminar de sonar. */
  speak(text: string): Promise<void>;
  /** Corta la reproduccion en curso (para barge-in: interrumpir hablando). */
  stop(): void;
  /** Motor y voz activos, para mostrarlos. */
  describe(): { engine: VoiceEngine; voice: string; local: boolean };
}

export interface TtsConfig {
  engine: VoiceEngine;
  /** Voz del motor edge (p. ej. es-ES-AlvaroNeural). */
  edgeVoice: string;
  /** Voz del motor sapi (nombre SAPI, p. ej. "Microsoft Helena Desktop"). */
  sapiVoice: string;
  /**
   * Ajuste de ritmo, -10..10 (0 = normal). Es lo que distingue a los avatares
   * locales entre si: en esta maquina solo hay UNA voz SAPI en espanol, asi que
   * el caracter se da con el ritmo, no con la voz.
   */
  rate: number;
  /** Si true, se ignora `engine` y se usa siempre el local (sapi). */
  confidential: boolean;
}

export const DEFAULT_TTS_CONFIG: TtsConfig = {
  engine: 'edge',
  edgeVoice: 'es-ES-AlvaroNeural',
  sapiVoice: 'Microsoft Helena Desktop',
  rate: 0,
  confidential: false,
};
