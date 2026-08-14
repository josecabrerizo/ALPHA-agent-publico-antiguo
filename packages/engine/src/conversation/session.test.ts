import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { ConversationSession } from './session.js';
import type { ConversationDeps } from './session.js';
import type { AgentEvent, ChatMessage } from '../brain/client.js';
import type { Speaker } from '../tts/types.js';
import { SAMPLE_RATE } from '../audio/format.js';

/**
 * Lo que se prueba aqui es la EXCLUSION DE TURNOS: solo puede haber uno en
 * vuelo. Es la regla que sostiene el ciclo conversacional — sin ella se lanzan
 * dos transcripciones a la vez, el controlador del turno bueno lo pisa el del
 * intruso y el historial acaba descuadrado.
 *
 * Se prueba por el canal de TEXTO porque es el unico que no necesita
 * microfono; la exclusion es la misma pieza para voz y texto (claimTurn).
 */

/** Cerebro de mentira: cuenta las llamadas y no responde hasta que se le dice. */
class FakeBrain {
  calls = 0;
  /** Cada llamada en vuelo queda aqui esperando a que la suelten. */
  private pending: (() => void)[] = [];

  async *runAgentic(
    history: ChatMessage[],
    _opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): AsyncGenerator<AgentEvent> {
    this.calls++;
    const last = history.at(-1)?.content ?? '';
    await new Promise<void>((resolve) => this.pending.push(resolve));
    yield { type: 'text', delta: `respuesta a ${last}` };
  }

  /** Deja terminar a todas las respuestas en vuelo. */
  releaseAll(): void {
    const waiting = this.pending;
    this.pending = [];
    for (const resolve of waiting) resolve();
  }

  get inFlight(): number {
    return this.pending.length;
  }
}

const silentSpeaker: Speaker = {
  async speak() {},
  stop() {},
  describe: () => ({ engine: 'sapi', voice: 'fake', local: true }),
};

const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

/** Espera a que se cumpla una condicion, o falla; evita depender de tiempos. */
async function waitFor(what: string, cond: () => boolean, tries = 500): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (cond()) return;
    await tick();
  }
  assert.fail(`nunca ocurrio: ${what}`);
}

/** PCM s16le 16 kHz mono: tono a la amplitud dada (0 = silencio). */
function pcm(ms: number, amplitude: number): Buffer {
  const samples = Math.round((SAMPLE_RATE * ms) / 1000);
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const tone = Math.sin((2 * Math.PI * 200 * i) / SAMPLE_RATE) * amplitude;
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(tone * 32767))), i * 2);
  }
  return buf;
}

/** Transcriptor de mentira: se queda colgado hasta que se le da el texto. */
class FakeWhisper {
  calls = 0;
  private pending: ((text: string) => void)[] = [];

  async transcribe(_pcm: Buffer, _opts: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<string> {
    this.calls++;
    return new Promise<string>((resolve) => this.pending.push(resolve));
  }

  /** Devuelve el texto a todas las transcripciones en vuelo. */
  releaseAll(text: string): void {
    const waiting = this.pending;
    this.pending = [];
    for (const resolve of waiting) resolve(text);
  }

  get inFlight(): number {
    return this.pending.length;
  }
}

function makeSession(brain: FakeBrain): ConversationSession {
  // whisper no se usa en el canal de texto, pero la sesion lo exige.
  const deps = {
    whisper: { transcribe: async () => '' },
    brain,
    speaker: silentSpeaker,
  } as unknown as ConversationDeps;
  return new ConversationSession(deps);
}

test('dos mensajes escritos a la vez: solo uno arranca turno', async () => {
  const brain = new FakeBrain();
  const session = makeSession(brain);

  const first = session.sendText('primero');
  const second = session.sendText('segundo');

  await tick();
  assert.equal(brain.calls, 1, 'el segundo mensaje no puede abrir un turno paralelo');
  assert.equal(brain.inFlight, 1);

  brain.releaseAll();
  await Promise.all([first, second]);
  assert.equal(brain.calls, 1);
});

test('terminado el turno, la sesion vuelve a aceptar mensajes', async () => {
  const brain = new FakeBrain();
  const session = makeSession(brain);

  const first = session.sendText('primero');
  await tick();
  brain.releaseAll();
  await first;

  const second = session.sendText('segundo');
  await tick();
  assert.equal(brain.calls, 2, 'la sesion se queda ocupada para siempre');
  brain.releaseAll();
  await second;
});

test('un mensaje en blanco no consume el turno', async () => {
  const brain = new FakeBrain();
  const session = makeSession(brain);

  await session.sendText('   ');
  assert.equal(brain.calls, 0);

  const real = session.sendText('hola');
  await tick();
  assert.equal(brain.calls, 1, 'el turno seguia reclamado por el mensaje vacio');
  brain.releaseAll();
  await real;
});

/**
 * La carrera de verdad: entre que arranca un turno de voz y que empieza a
 * pensar hay una transcripcion de por medio (segundos con whisper en CPU).
 * Antes la sesion solo se marcaba ocupada al empezar a PENSAR, asi que durante
 * ese hueco un mensaje escrito abria un turno paralelo: dos controladores, dos
 * colas de voz y el turno de voz descartado en silencio al terminar el STT.
 */
test('un mensaje escrito no se cuela mientras se transcribe la voz', async () => {
  const brain = new FakeBrain();
  const whisper = new FakeWhisper();
  const mic = new Readable({ read() {} });
  const deps = {
    whisper,
    brain,
    speaker: silentSpeaker,
    openCapture: () => ({ pcm: mic, stop: () => mic.destroy() }),
  } as unknown as ConversationDeps;
  const session = new ConversationSession(deps);

  const running = session.run();
  // Silencio, un tramo hablado y silencio otra vez: el VAD cierra el tramo y
  // arranca el turno de voz.
  mic.push(pcm(600, 0));
  mic.push(pcm(1000, 0.25));
  mic.push(pcm(900, 0));
  await waitFor('la voz llega a whisper', () => whisper.calls === 1);

  await session.sendText('escrito');
  assert.equal(brain.calls, 0, 'el texto no puede abrir turno mientras se transcribe la voz');
  assert.equal(whisper.inFlight, 1, 'no puede haber dos transcripciones a la vez');

  whisper.releaseAll('hola de viva voz');
  await waitFor('el turno de voz llega al cerebro', () => brain.calls === 1);
  brain.releaseAll();

  session.stop();
  mic.push(null);
  await running;
});

test('el estado no anuncia "escuchando" con la sesion parada', async () => {
  const brain = new FakeBrain();
  const states: string[] = [];
  const deps = {
    whisper: { transcribe: async () => '' },
    brain,
    speaker: silentSpeaker,
    callbacks: { onState: (s: string) => states.push(s) },
  } as unknown as ConversationDeps;
  const session = new ConversationSession(deps);

  const turn = session.sendText('hola');
  await tick();
  brain.releaseAll();
  await turn;

  // Sin run(), no hay captura abierta: decir "escuchando" seria mentira.
  assert.equal(states.includes('escuchando'), false);
  assert.deepEqual(states.slice(0, 2), ['pensando', 'hablando']);
});
