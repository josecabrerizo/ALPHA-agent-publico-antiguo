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
  /**
   * Cola cortada. Una vez parada no vuelve: cada turno crea la suya, asi que
   * "reanudar" solo podria significar decir frases de una respuesta abortada.
   */
  private stopped = false;

  constructor(
    private readonly speaker: Speaker,
    private readonly onFirst?: () => void,
    private readonly onError?: (error: Error) => void,
  ) {}

  enqueue(text: string): void {
    const clean = text.trim();
    if (!clean) return;
    if (this.stopped) return;
    if (!this.started) {
      this.started = true;
      this.onFirst?.();
    }
    this.chain = this.chain
      // La comprobacion va DENTRO del eslabon, no al encolar: cuando le toque
      // el turno a esta frase puede que ya nos hayan interrumpido.
      .then(() => (this.stopped ? undefined : this.speaker.speak(clean)))
      // Un fallo al decir una frase no debe romper el resto de la cola, pero se
      // reporta (antes se tragaba en silencio y ocultaba fallos de voz).
      .catch((error: Error) => this.onError?.(error));
  }

  /** Espera a que termine de sonar todo lo encolado. */
  async drain(): Promise<void> {
    await this.chain;
  }

  /**
   * Corta lo que suena y descarta lo pendiente.
   *
   * La cadena NO se reasigna: soltar la referencia (`chain = Promise.resolve()`)
   * no cancelaba nada — las frases ya encoladas seguian su curso y, tras una
   * interrupcion, empezaba a sonar la siguiente. Ademas drain() volvia antes de
   * tiempo. Lo que corta de verdad es el flag que mira cada eslabon.
   */
  stop(): void {
    this.stopped = true;
    this.speaker.stop();
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
