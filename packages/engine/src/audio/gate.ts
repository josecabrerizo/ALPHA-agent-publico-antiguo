import type { Readable } from 'node:stream';

/**
 * Compuerta de audio: drena el stream de captura SIEMPRE (para que ffmpeg no se
 * bloquee por backpressure) pero solo entrega audio al VAD cuando esta abierta.
 *
 * Resuelve la acumulacion de audio: mientras A.L.P.H.A. piensa y habla, el
 * bucle de escucha no consume el stream, pero ffmpeg sigue produciendo. Con la
 * compuerta cerrada en esos momentos, ese audio se descarta segun llega, en vez
 * de amontonarse en el pipe y procesarse despues como si fuera nuevo (o peor,
 * recoger la propia voz del asistente por el altavoz).
 */
export class AudioGate implements AsyncIterable<Buffer> {
  private open = true;
  private readonly queue: Buffer[] = [];
  private waiting: ((r: IteratorResult<Buffer>) => void) | undefined;
  private ended = false;

  constructor(source: Readable) {
    // Modo fluido: los 'data' vacian el stream continuamente, haya o no consumidor.
    source.on('data', (chunk: Buffer) => {
      if (this.open) this.push(chunk);
    });
    const finish = () => this.finish();
    source.on('end', finish);
    source.on('close', finish);
    source.on('error', finish);
  }

  /** Abre o cierra la compuerta. Al cerrar, descarta lo pendiente (audio viejo). */
  setOpen(open: boolean): void {
    this.open = open;
    if (!open) this.queue.length = 0;
  }

  private push(chunk: Buffer): void {
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: chunk, done: false });
    } else {
      this.queue.push(chunk);
    }
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    if (this.waiting) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ value: undefined, done: true });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<Buffer> {
    for (;;) {
      const buffered = this.queue.shift();
      if (buffered !== undefined) {
        yield buffered;
        continue;
      }
      if (this.ended) return;
      const result = await new Promise<IteratorResult<Buffer>>((resolve) => {
        this.waiting = resolve;
      });
      if (result.done) return;
      yield result.value;
    }
  }
}
