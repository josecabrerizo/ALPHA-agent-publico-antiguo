import { captureMicrophone, type CaptureHandle, type CaptureOptions } from '../audio/capture.js';
import { detectUtterances } from '../audio/vad.js';
import { WhisperTranscriber } from '../stt/whisper.js';
import { Brain, type ChatMessage } from '../brain/client.js';
import type { Speaker } from '../tts/types.js';
import { SpeechQueue, splitSentences } from './speech-queue.js';

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
    // Bucle externo: cada vuelta abre la captura y escucha hasta que el stream
    // termina. Un cambio de microfono corta la captura y provoca otra vuelta.
    do {
      this.restartRequested = false;
      const capture = captureMicrophone(this.captureOptions);
      // Sin esto ffmpeg se bloquea cuando un turno tarda mas que el buffer del pipe.
      capture.pcm.setMaxListeners(0);
      this.handle = capture;

      this.cb.onState?.('escuchando');
      try {
        for await (const utterance of detectUtterances(capture.pcm, {
          ...(this.cb.onLevel ? { onLevel: this.cb.onLevel } : {}),
        })) {
          if (!this.running || this.restartRequested) break;
          this.cb.onLog?.(`voz recibida: ${(utterance.speechMs / 1000).toFixed(1)}s de habla`);
          await this.handleTurn(utterance.pcm);
          if (!this.running || this.restartRequested) break;
          this.cb.onState?.('escuchando');
        }
      } catch (error) {
        // Al cambiar de micro destruimos el stream a proposito; ese cierre no
        // es un error que reportar, es la senal de reinicio.
        if (!this.restartRequested) this.cb.onError?.('captura', error as Error);
      }
      capture.stop();
    } while (this.running && this.restartRequested);
  }

  private async handleTurn(pcm: Buffer): Promise<void> {
    const t0 = performance.now();
    const ms = (from: number) => Math.round(performance.now() - from);

    // 1) Pensar (transcribir).
    this.cb.onState?.('pensando');
    this.cb.onLog?.('transcribiendo…');
    let text: string;
    try {
      text = await this.whisper.transcribe(pcm);
    } catch (error) {
      this.cb.onError?.('stt', error as Error);
      return;
    }
    if (!text) {
      this.cb.onLog?.(`transcrito en ${ms(t0)}ms: sin habla reconocida (ruido)`);
      return;
    }
    this.cb.onLog?.(`transcrito en ${ms(t0)}ms`);
    this.cb.onUserText?.(text);
    this.history.push({ role: 'user', content: text });

    // 2) Pensar (LLM, con herramientas) + 3) Hablar, en tuberia: las frases se
    //    dicen conforme el cerebro las termina; si pide herramientas, se
    //    ejecutan y sigue.
    this.cb.onLog?.('consultando al cerebro…');
    const tBrain = performance.now();
    const queue = new SpeechQueue(this.speaker, () => this.cb.onState?.('hablando'));
    let full = '';
    let buffer = '';
    let firstToken = false;
    try {
      for await (const ev of this.brain.runAgentic(this.history)) {
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
      this.cb.onError?.('brain', error as Error);
      return;
    }

    if (full.trim()) {
      this.cb.onAssistantText?.(full);
      this.history.push({ role: 'assistant', content: full });
    }
    this.cb.onLog?.(`turno completo en ${ms(t0)}ms`);
  }

  stop(): void {
    this.running = false;
    this.speaker.stop();
    this.handle?.stop();
  }
}
