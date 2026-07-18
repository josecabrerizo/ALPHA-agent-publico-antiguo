import type { Speaker } from '../tts/types.js';

/**
 * Cola de habla: reproduce frases en orden, una tras otra. Permite que el
 * cerebro siga generando mientras A.L.P.H.A. ya dice las frases terminadas, sin
 * solaparlas. `onFirst` se dispara al encolar la primera (para pasar el avatar
 * a "hablando").
 */
export class SpeechQueue {
  private chain: Promise<void> = Promise.resolve();
  private started = false;

  constructor(
    private readonly speaker: Speaker,
    private readonly onFirst?: () => void,
  ) {}

  enqueue(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    if (!this.started) {
      this.started = true;
      this.onFirst?.();
    }
    this.chain = this.chain
      .then(() => this.speaker.speak(clean))
      // Un fallo al decir una frase no debe romper el resto de la cola.
      .catch(() => {});
  }

  /** Espera a que termine de sonar todo lo encolado. */
  async drain(): Promise<void> {
    await this.chain;
  }

  /** Corta lo que suena e ignora lo pendiente. */
  stop(): void {
    this.speaker.stop();
    this.chain = Promise.resolve();
  }
}

/**
 * Extrae frases completas de un buffer que va creciendo (el streaming del
 * cerebro). Devuelve las frases cerradas por . ! ? … y el resto todavia
 * incompleto, que se conserva para la siguiente pasada.
 */
export function splitSentences(buffer: string): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  const re = /[^.!?…]*[.!?…]+(?:\s|$)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(buffer)) !== null) {
    const s = match[0].trim();
    if (s) sentences.push(s);
    lastIndex = re.lastIndex;
  }
  return { sentences, rest: buffer.slice(lastIndex) };
}
