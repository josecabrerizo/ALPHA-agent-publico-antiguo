import { captureMicrophone, type CaptureHandle, type CaptureOptions } from '../audio/capture.js';
import { defaultInputDevice } from '../audio/devices.js';
import { AudioGate } from '../audio/gate.js';
import { detectUtterances } from '../audio/vad.js';
import { WhisperTranscriber } from '../stt/whisper.js';
import { Brain, type ChatMessage } from '../brain/client.js';
import type { Speaker } from '../tts/types.js';
import { SpeechQueue, splitSentences } from './speech-queue.js';

// Limites por fase para que un proceso o proveedor colgado no deje la sesion en
// "pensando" para siempre. whisper en CPU puede ser lento y un turno con
// herramientas encadena varias llamadas, de ahi que sean generosos.
const STT_TIMEOUT_MS = 120_000;
const LLM_TIMEOUT_MS = 120_000;

// Ventana de historial: se conservan los ultimos N mensajes (unos 12 turnos).
// Evita que la latencia y el gasto crezcan sin fin y desborden el contexto en
// conversaciones largas. Un resumen progresivo del historial viejo queda para
// mas adelante; de momento, ventana deslizante.
const MAX_HISTORY_MESSAGES = 24;

/** Estado del asistente, el mismo eje que las animaciones del avatar. */
export type ConversationState = 'escuchando' | 'pensando' | 'hablando';

export interface ConversationCallbacks {
  onState?(state: ConversationState): void;
  onUserText?(text: string): void;
  onAssistantText?(text: string): void;
  onLevel?(level: number, speaking: boolean): void;
  onError?(where: string, error: Error): void;
  /** Traza con tiempos de cada fase del turno, para depurar y medir latencias. */
  onLog?(message: string): void;
}

export interface ConversationDeps {
  capture?: CaptureOptions;
  whisper: WhisperTranscriber;
  brain: Brain;
  speaker: Speaker;
  callbacks?: ConversationCallbacks;
}

/**
 * El bucle completo escuchar -> pensar -> hablar.
 *
 * Une captura de microfono, VAD, whisper (STT), cerebro y voz (TTS) en una
 * conversacion continua, manteniendo el historial. Emite cambios de estado que
 * mas adelante conduciran al avatar por IPC; de momento el spike los pinta.
 *
 * Nota sobre realimentacion: mientras A.L.P.H.A. habla, si se usa altavoz el
 * microfono podria oirse a si mismo. Con auriculares no pasa. La cancelacion de
 * eco / pausa-al-hablar queda para la capa de reuniones.
 */
export class ConversationSession {
  private readonly whisper: WhisperTranscriber;
  private brain: Brain;
  private speaker: Speaker;
  private readonly cb: ConversationCallbacks;
  private captureOptions: CaptureOptions;
  private readonly history: ChatMessage[] = [];

  private handle: CaptureHandle | undefined;
  private running = false;
  private restartRequested = false;
  private busy = false; // hay un turno (voz o texto) en curso
  private turnController: AbortController | undefined; // cancela el turno actual

  constructor(deps: ConversationDeps) {
    this.whisper = deps.whisper;
    this.brain = deps.brain;
    this.speaker = deps.speaker;
    this.cb = deps.callbacks ?? {};
    this.captureOptions = deps.capture ?? {};
  }

  /**
   * Sustituye el cerebro y/o la voz en caliente (cambio de modelo o de
   * privacidad desde el avatar). Se aplica al siguiente turno; no interrumpe
   * uno en curso. El historial se conserva.
   */
  reconfigure(next: { brain?: Brain; speaker?: Speaker }): void {
    if (next.brain) this.brain = next.brain;
    if (next.speaker) {
      this.speaker.stop();
      this.speaker = next.speaker;
    }
  }

  /**
   * Cambia el microfono en caliente. Ademas de matar ffmpeg, destruye el
   * stream a mano: en Windows matar el proceso no siempre cierra el pipe, y sin
   * esto el bucle de escucha se quedaria esperando un stream que ya no llega
   * (era lo que colgaba la captura al cambiar de micro varias veces seguidas).
   */
  setAudioDevice(device: string): void {
    if (device === this.captureOptions.device) return;
    this.captureOptions = { ...this.captureOptions, device };
    this.restartRequested = true;
    this.cb.onLog?.(`cambiando de microfono a: ${device}`);
    const handle = this.handle;
    this.handle = undefined;
    handle?.stop();
    handle?.pcm.destroy(); // fuerza el fin del for-await ya mismo
  }

  async run(): Promise<void> {
    this.running = true;
    // Bucle externo: mientras la sesion este activa, se mantiene la captura. Si
    // el stream termina por lo que sea (cambio de micro, o ffmpeg que muere solo
    // —p. ej. Mezcla estereo sin nada sonando—) se reabre. Solo se sale con
    // stop(). Antes se salia al terminar el stream sin un cambio pedido, y eso
    // mataba la sesion cuando un dispositivo se cerraba por su cuenta.
    let fastFailures = 0;
    while (this.running) {
      this.restartRequested = false;
      const openedAt = performance.now();
      const capture = captureMicrophone(this.captureOptions);
      this.handle = capture;
      // La compuerta drena ffmpeg siempre (sin backpressure) y solo pasa audio
      // al VAD cuando esta abierta. Se cierra mientras se piensa/habla, para no
      // acumular audio viejo ni recoger la voz del propio asistente.
      const gate = new AudioGate(capture.pcm);

      this.cb.onState?.('escuchando');
      try {
        for await (const utterance of detectUtterances(gate, {
          ...(this.cb.onLevel ? { onLevel: this.cb.onLevel } : {}),
        })) {
          if (!this.running || this.restartRequested) break;
          this.cb.onLog?.(`voz recibida: ${(utterance.speechMs / 1000).toFixed(1)}s de habla`);
          gate.setOpen(false); // deja de escuchar mientras responde
          await this.handleTurn(utterance.pcm);
          if (!this.running || this.restartRequested) break;
          this.cb.onState?.('escuchando');
          gate.setOpen(true); // vuelve a escuchar, descartando lo de mientras
        }
      } catch (error) {
        // Al cambiar de micro destruimos el stream a proposito; ese cierre no
        // es un error que reportar, es la senal de reinicio.
        if (!this.restartRequested) this.cb.onError?.('captura', error as Error);
      }
      capture.stop();
      if (!this.running) break;

      // Muerte rapida sin cambio pedido = dispositivo problematico (p. ej. el
      // micro desenchufado). Tras un par de fallos, repliega al predeterminado
      // del sistema para no quedarse reintentando un micro que ya no existe.
      if (!this.restartRequested && performance.now() - openedAt < 1000) {
        fastFailures++;
        if (fastFailures >= 2 && this.captureOptions.device) {
          try {
            const fallback = await defaultInputDevice();
            if (fallback.name !== this.captureOptions.device) {
              this.cb.onLog?.(
                `el microfono no responde; volviendo al predeterminado: ${fallback.name}`,
              );
              this.captureOptions = { ...this.captureOptions, device: fallback.name };
              fastFailures = 0;
            }
          } catch {
            // No hay ningun micro disponible; se seguira reintentando.
          }
        }
        await new Promise((r) => setTimeout(r, 1000));
      } else {
        fastFailures = 0;
      }
    }
  }

  /**
   * Turno de voz: transcribe el audio y responde. La transcripcion es lo unico
   * propio del canal de voz; el resto (pensar y hablar) lo comparte con el
   * texto via respondTo.
   */
  private async handleTurn(pcm: Buffer): Promise<void> {
    const t0 = performance.now();
    const controller = new AbortController();
    this.turnController = controller;
    this.cb.onState?.('pensando');
    this.cb.onLog?.('transcribiendo…');
    let text: string;
    try {
      text = await this.whisper.transcribe(pcm, {
        signal: controller.signal,
        timeoutMs: STT_TIMEOUT_MS,
      });
    } catch (error) {
      if (!controller.signal.aborted) this.cb.onError?.('stt', error as Error);
      this.turnController = undefined;
      return;
    }
    if (!text) {
      this.cb.onLog?.(`transcrito en ${Math.round(performance.now() - t0)}ms: sin habla (ruido)`);
      this.turnController = undefined;
      return;
    }
    this.cb.onLog?.(`transcrito en ${Math.round(performance.now() - t0)}ms`);
    this.cb.onUserText?.(text);
    await this.respondTo(text, controller.signal);
  }

  /**
   * Entrada de texto (chat escrito): responde igual que a la voz, compartiendo
   * historial y cerebro. Para aligerar conversaciones sin hablar.
   */
  async sendText(text: string): Promise<void> {
    const clean = text.trim();
    if (!clean) return;
    if (this.busy) {
      this.cb.onLog?.('ocupado; espera a que termine el turno actual');
      return;
    }
    const controller = new AbortController();
    this.turnController = controller;
    this.cb.onLog?.(`texto › ${clean}`);
    this.cb.onUserText?.(clean);
    await this.respondTo(clean, controller.signal);
    this.cb.onState?.('escuchando');
  }

  /**
   * Pensar (LLM con herramientas) + hablar, en tuberia: las frases se dicen
   * conforme el cerebro las termina; si pide herramientas, se ejecutan y sigue.
   * Comun a la voz y al texto. El flag busy evita que un turno pise a otro.
   */
  private async respondTo(text: string, signal?: AbortSignal): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const ms = (from: number) => Math.round(performance.now() - from);
    try {
      this.history.push({ role: 'user', content: text });
      this.cb.onState?.('pensando');
      this.cb.onLog?.('consultando al cerebro…');
      const tBrain = performance.now();
      const queue = new SpeechQueue(this.speaker, () => this.cb.onState?.('hablando'));
      let full = '';
      let buffer = '';
      let firstToken = false;
      try {
        for await (const ev of this.brain.runAgentic(this.history, {
          ...(signal ? { signal } : {}),
          timeoutMs: LLM_TIMEOUT_MS,
        })) {
          if (ev.type === 'tool-start') {
            this.cb.onState?.('pensando');
            this.cb.onLog?.(`herramienta: ${ev.name}(${ev.args || ''})`);
            continue;
          }
          if (ev.type === 'tool-end') {
            this.cb.onLog?.(`  → ${ev.result}`);
            continue;
          }
          // ev.type === 'text'
          if (!firstToken) {
            firstToken = true;
            this.cb.onLog?.(`primer token del cerebro en ${ms(tBrain)}ms`);
          }
          full += ev.delta;
          buffer += ev.delta;
          const { sentences, rest } = splitSentences(buffer);
          for (const sentence of sentences) queue.enqueue(sentence);
          buffer = rest;
        }
        if (buffer.trim()) queue.enqueue(buffer);
        this.cb.onLog?.(`respuesta generada en ${ms(tBrain)}ms; terminando de hablar…`);
        await queue.drain();
      } catch (error) {
        queue.stop();
        // Si el turno se cancelo (stop, timeout), no es un error que reportar.
        if (!signal?.aborted) this.cb.onError?.('brain', error as Error);
        return;
      }

      if (full.trim()) {
        this.cb.onAssistantText?.(full);
        this.history.push({ role: 'assistant', content: full });
      }
      // Ventana deslizante: se descartan los turnos mas viejos por el frente.
      if (this.history.length > MAX_HISTORY_MESSAGES) {
        this.history.splice(0, this.history.length - MAX_HISTORY_MESSAGES);
      }
    } finally {
      this.busy = false;
      this.turnController = undefined;
    }
  }

  stop(): void {
    this.running = false;
    this.turnController?.abort(); // cancela STT/LLM del turno en curso
    this.speaker.stop();
    this.handle?.stop();
  }
}
