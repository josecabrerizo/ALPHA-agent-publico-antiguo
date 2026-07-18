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
  private readonly brain: Brain;
  private readonly speaker: Speaker;
  private readonly cb: ConversationCallbacks;
  private readonly captureOptions: CaptureOptions;
  private readonly history: ChatMessage[] = [];

  private handle: CaptureHandle | undefined;
  private running = false;

  constructor(deps: ConversationDeps) {
    this.whisper = deps.whisper;
    this.brain = deps.brain;
    this.speaker = deps.speaker;
    this.cb = deps.callbacks ?? {};
    this.captureOptions = deps.capture ?? {};
  }

  async run(): Promise<void> {
    this.running = true;
    const capture = captureMicrophone(this.captureOptions);
    // Sin esto ffmpeg se bloquea cuando un turno tarda mas que el buffer del pipe.
    capture.pcm.setMaxListeners(0);
    this.handle = capture;

    this.cb.onState?.('escuchando');
    for await (const utterance of detectUtterances(capture.pcm, {
      ...(this.cb.onLevel ? { onLevel: this.cb.onLevel } : {}),
    })) {
      if (!this.running) break;
      await this.handleTurn(utterance.pcm);
      if (!this.running) break;
      this.cb.onState?.('escuchando');
    }
  }

  private async handleTurn(pcm: Buffer): Promise<void> {
    // 1) Pensar (transcribir).
    this.cb.onState?.('pensando');
    let text: string;
    try {
      text = await this.whisper.transcribe(pcm);
    } catch (error) {
      this.cb.onError?.('stt', error as Error);
      return;
    }
    if (!text) return; // ruido: nada que decir
    this.cb.onUserText?.(text);
    this.history.push({ role: 'user', content: text });

    // 2) Pensar (LLM) + 3) Hablar, en tuberia: las frases se dicen conforme
    //    el cerebro las termina.
    const queue = new SpeechQueue(this.speaker, () => this.cb.onState?.('hablando'));
    let full = '';
    let buffer = '';
    try {
      for await (const chunk of this.brain.replyStream(this.history)) {
        full += chunk;
        buffer += chunk;
        const { sentences, rest } = splitSentences(buffer);
        for (const sentence of sentences) queue.enqueue(sentence);
        buffer = rest;
      }
      if (buffer.trim()) queue.enqueue(buffer);
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
  }

  stop(): void {
    this.running = false;
    this.speaker.stop();
    this.handle?.stop();
  }
}
