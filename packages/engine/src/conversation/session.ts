import { captureMicrophone, type CaptureHandle, type CaptureOptions } from '../audio/capture.js';
import { defaultInputDevice } from '../audio/devices.js';
import { AudioGate } from '../audio/gate.js';
import { detectUtterances } from '../audio/vad.js';
import { WhisperTranscriber } from '../stt/whisper.js';
import { Brain, type ChatMessage } from '../brain/client.js';
import type { Speaker } from '../tts/types.js';
import { SpeechQueue, splitSentences } from './speech-queue.js';
import { decideBargeIn, mergeUserTurns } from './echo.js';

// Limites por fase para que un proceso o proveedor colgado no deje la sesion en
// "pensando" para siempre. whisper en CPU puede ser lento y un turno con
// herramientas encadena varias llamadas, de ahi que sean generosos.
const STT_TIMEOUT_MS = 120_000;
const LLM_TIMEOUT_MS = 120_000;

// Barge-in: habla minima para molestarse en transcribir. El VAD salta con
// cualquier ruido, y transcribir cuesta CPU mientras el LLM genera; este
// pre-filtro barato descarta chasquidos antes de gastar whisper.
const DEFAULT_BARGE_IN_MIN_MS = 600;

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
  /** El microfono se ha silenciado o reactivado. */
  onMicChange?(enabled: boolean): void;
}

export interface ConversationDeps {
  capture?: CaptureOptions;
  whisper: WhisperTranscriber;
  brain: Brain;
  speaker: Speaker;
  callbacks?: ConversationCallbacks;
  /** Permitir cortar a A.L.P.H.A. hablandole mientras responde. */
  bargeIn?: boolean;
  /** Habla minima (ms) para considerar una interrupcion. */
  bargeInMinMs?: number;
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

  private readonly bargeIn: boolean;
  private readonly bargeInMinMs: number;
  /** Lo que A.L.P.H.A. lleva dicho en el turno actual, para rechazar su eco. */
  private spokenSoFar = '';
  /** Ultimo texto del usuario, para fusionarlo si interrumpe. */
  private lastUserText = '';
  /** Turno en vuelo: hay que esperar a que se desenrolle antes de relanzar. */
  private currentTurn: Promise<void> | undefined;
  /** Cola de voz del turno actual, para cortarla al interrumpir. */
  private activeQueue: SpeechQueue | undefined;
  /** Evita evaluar dos interrupciones a la vez. */
  private evaluatingBargeIn = false;

  /** Microfono activo. Silenciarlo SUELTA el dispositivo, no solo lo ignora. */
  private micEnabled = true;
  /** Despierta al bucle de captura cuando se reactiva el microfono. */
  private micResume: (() => void) | undefined;

  constructor(deps: ConversationDeps) {
    this.whisper = deps.whisper;
    this.brain = deps.brain;
    this.speaker = deps.speaker;
    this.cb = deps.callbacks ?? {};
    this.captureOptions = deps.capture ?? {};
    this.bargeIn = deps.bargeIn ?? true;
    this.bargeInMinMs = deps.bargeInMinMs ?? DEFAULT_BARGE_IN_MIN_MS;
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

  /**
   * Silencia o reactiva el microfono.
   *
   * Silenciar CIERRA la captura, no la ignora: ffmpeg muere y el dispositivo
   * queda libre, asi que el indicador de microfono del sistema se apaga. Un
   * "mute" que dejara el micro abierto seria una media verdad, y aqui la
   * privacidad es el producto. El chat escrito sigue funcionando.
   */
  setMicEnabled(enabled: boolean): void {
    if (enabled === this.micEnabled) return;
    this.micEnabled = enabled;
    this.cb.onMicChange?.(enabled);
    if (enabled) {
      this.cb.onLog?.('microfono reactivado');
      this.micResume?.();
      this.micResume = undefined;
      return;
    }
    this.cb.onLog?.('microfono silenciado: se cierra la captura');
    // Mismo cierre deliberado que al cambiar de micro: matar ffmpeg no basta,
    // en Windows el pipe puede quedarse abierto y colgar el for-await.
    this.restartRequested = true;
    const handle = this.handle;
    this.handle = undefined;
    handle?.stop();
    handle?.pcm.destroy();
  }

  isMicEnabled(): boolean {
    return this.micEnabled;
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
      // Con el microfono silenciado no se abre captura ninguna: se espera aqui
      // hasta que lo reactiven (o hasta stop()), sin girar en vacio.
      if (!this.micEnabled) {
        await new Promise<void>((resolve) => {
          this.micResume = resolve;
          if (!this.running || this.micEnabled) resolve(); // carrera: ya cambio
        });
        this.micResume = undefined;
        if (!this.running) break;
      }
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
        // El consumo de audio NO se bloquea en el turno: es lo que permite
        // seguir oyendo mientras responde y poder interrumpirle.
        for await (const utterance of detectUtterances(gate, {
          ...(this.cb.onLevel ? { onLevel: this.cb.onLevel } : {}),
        })) {
          if (!this.running || this.restartRequested) break;

          if (!this.busy) {
            this.cb.onLog?.(`voz recibida: ${(utterance.speechMs / 1000).toFixed(1)}s de habla`);
            // Sin barge-in se vuelve al medio duplex: sordo mientras responde.
            if (!this.bargeIn) gate.setOpen(false);
            this.currentTurn = this.runTurn(utterance.pcm, gate);
          } else if (this.bargeIn && utterance.speechMs >= this.bargeInMinMs) {
            // Puede ser una interrupcion: lo decide la transcripcion, no el VAD.
            void this.considerBargeIn(utterance.pcm);
          }
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
  /**
   * Envuelve un turno de voz: se lanza sin bloquear el consumo de audio, y al
   * acabar devuelve el estado a "escuchando" (salvo que una interrupcion ya
   * haya arrancado otro turno).
   */
  private async runTurn(pcm: Buffer, gate: AudioGate): Promise<void> {
    try {
      await this.handleTurn(pcm);
    } catch (error) {
      this.cb.onError?.('turno', error as Error);
    } finally {
      if (this.running && !this.restartRequested && !this.busy) {
        this.cb.onState?.('escuchando');
        if (!this.bargeIn) gate.setOpen(true);
      }
    }
  }

  /**
   * Decide si un tramo de voz oido MIENTRAS responde es una interrupcion real.
   *
   * La clave: no la decide el VAD (que salta con cualquier ruido) sino la
   * transcripcion. Solo hay interrupcion si whisper devuelve palabras y esas
   * palabras no son el propio asistente oyendose por el altavoz.
   */
  private async considerBargeIn(pcm: Buffer): Promise<void> {
    if (this.evaluatingBargeIn) return; // una evaluacion a la vez
    this.evaluatingBargeIn = true;
    try {
      // Sin la señal del turno: si lo abortamos, no queremos matar esta
      // transcripcion, que es justo la que decide si abortarlo.
      const heard = await this.whisper.transcribe(pcm, { timeoutMs: STT_TIMEOUT_MS });

      const verdict = decideBargeIn(heard, this.spokenSoFar);
      if (verdict === 'ruido') {
        this.cb.onLog?.('interrupcion descartada: ruido sin palabras');
        return;
      }
      if (verdict === 'eco') {
        this.cb.onLog?.(`interrupcion descartada: es su propia voz ("${heard}")`);
        return;
      }
      // El turno pudo terminar solo mientras transcribiamos.
      if (!this.busy || !this.running) return;

      this.cb.onLog?.(`interrumpido por: "${heard}"`);
      this.turnController?.abort();
      this.activeQueue?.stop();
      await this.currentTurn?.catch(() => {});

      // Se fusiona con lo anterior para que responda a todo junto: el caso real
      // es que sigues completando tu idea mientras ya te contesta. La respuesta
      // a medias no llega a guardarse (solo se apila al completarse).
      if (this.history.at(-1)?.role === 'user') this.history.pop();
      const combined = mergeUserTurns(this.lastUserText, heard);
      this.cb.onUserText?.(combined);
      this.currentTurn = this.respondTo(combined).finally(() => {
        if (this.running && !this.busy) this.cb.onState?.('escuchando');
      });
    } catch (error) {
      this.cb.onError?.('barge-in', error as Error);
    } finally {
      this.evaluatingBargeIn = false;
    }
  }

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
      this.lastUserText = text; // por si hay que fusionar una interrupcion
      this.spokenSoFar = ''; // el eco se compara contra ESTE turno
      this.cb.onState?.('pensando');
      this.cb.onLog?.('consultando al cerebro…');
      const tBrain = performance.now();
      const queue = new SpeechQueue(
        this.speaker,
        () => this.cb.onState?.('hablando'),
        (error) => this.cb.onError?.('tts', error),
      );
      this.activeQueue = queue; // para poder cortar la voz al interrumpir
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
          this.spokenSoFar = full; // referencia viva para rechazar su propio eco
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
      this.activeQueue = undefined;
    }
  }

  stop(): void {
    this.running = false;
    this.turnController?.abort(); // cancela STT/LLM del turno en curso
    this.speaker.stop();
    this.handle?.stop();
    this.micResume?.(); // si estaba esperando a que reactiven el micro, que salga
  }
}
