import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechQueue, splitSentences } from './speech-queue.js';
import type { Speaker } from '../tts/types.js';

/**
 * Voz de mentira: `speak` no resuelve hasta que se le dice, asi que se puede
 * dejar la cola "sonando" a mitad y comprobar que hace stop() de verdad.
 */
class FakeSpeaker implements Speaker {
  readonly spoken: string[] = [];
  private release: (() => void) | undefined;

  speak(text: string): Promise<void> {
    this.spoken.push(text);
    return new Promise<void>((resolve) => {
      this.release = resolve;
    });
  }

  /** Cortar la reproduccion: la frase en curso termina ya (como matar el proceso). */
  stop(): void {
    this.release?.();
    this.release = undefined;
  }

  describe(): ReturnType<Speaker['describe']> {
    return { engine: 'sapi', voice: 'fake', local: true };
  }
}

/** Deja correr los microtasks pendientes de la cadena de promesas. */
const tick = (): Promise<void> => new Promise((r) => setImmediate(r));

test('extrae frases completas y conserva el resto incompleto', () => {
  const { sentences, rest } = splitSentences('Hola. ¿Qué tal? Estoy bien y ');
  assert.deepEqual(sentences, ['Hola.', '¿Qué tal?']);
  assert.equal(rest, 'Estoy bien y ');
});

test('sin puntuacion final, todo queda como resto', () => {
  const { sentences, rest } = splitSentences('esto aun no termina');
  assert.deepEqual(sentences, []);
  assert.equal(rest, 'esto aun no termina');
});

test('una frase que llena el buffer no deja resto', () => {
  const { sentences, rest } = splitSentences('¡Listo!');
  assert.deepEqual(sentences, ['¡Listo!']);
  assert.equal(rest, '');
});

test('maneja puntos suspensivos y varios signos', () => {
  const { sentences, rest } = splitSentences('Vale... Perfecto!! Y luego');
  assert.deepEqual(sentences, ['Vale...', 'Perfecto!!']);
  assert.equal(rest, 'Y luego');
});

/**
 * El nucleo del barge-in: si te interrumpe a mitad de respuesta, no puede
 * arrancar la siguiente frase de esa misma respuesta. Antes stop() solo soltaba
 * la referencia a la cadena, y la cola seguia desenrollandose por su cuenta.
 */
test('stop() no deja que empiece ninguna frase pendiente', async () => {
  const speaker = new FakeSpeaker();
  const queue = new SpeechQueue(speaker);
  queue.enqueue('Uno.');
  queue.enqueue('Dos.');
  queue.enqueue('Tres.');

  await tick(); // la primera frase ya esta sonando; las otras esperan turno
  assert.deepEqual(speaker.spoken, ['Uno.']);

  queue.stop();
  await queue.drain();
  assert.deepEqual(speaker.spoken, ['Uno.'], 'ninguna frase posterior debe sonar tras stop()');
});

test('drain() espera de verdad a la cola (no vuelve antes de tiempo)', async () => {
  const speaker = new FakeSpeaker();
  const queue = new SpeechQueue(speaker);
  queue.enqueue('Uno.');
  queue.enqueue('Dos.');

  let drained = false;
  const draining = queue.drain().then(() => {
    drained = true;
  });

  await tick();
  assert.equal(drained, false, 'con una frase sonando, drain() no puede haber vuelto');

  speaker.stop(); // termina "Uno."
  await tick();
  speaker.stop(); // termina "Dos."
  await draining;
  assert.deepEqual(speaker.spoken, ['Uno.', 'Dos.']);
});

test('encolar despues de stop() no revive la cola', async () => {
  const speaker = new FakeSpeaker();
  const queue = new SpeechQueue(speaker);
  queue.stop();
  queue.enqueue('Tarde.');
  await queue.drain();
  assert.deepEqual(speaker.spoken, []);
});

test('onFirst avisa una sola vez, al encolar la primera frase', async () => {
  const speaker = new FakeSpeaker();
  let firsts = 0;
  const queue = new SpeechQueue(speaker, () => firsts++);
  queue.enqueue('   '); // en blanco: no cuenta como frase
  assert.equal(firsts, 0);
  queue.enqueue('Uno.');
  queue.enqueue('Dos.');
  assert.equal(firsts, 1);
  queue.stop();
  await queue.drain();
});

test('un fallo al hablar se reporta y no rompe el resto de la cola', async () => {
  const spoken: string[] = [];
  const errors: string[] = [];
  const speaker: Speaker = {
    async speak(text: string) {
      if (text === 'Falla.') throw new Error('sin voz');
      spoken.push(text);
    },
    stop() {},
    describe: () => ({ engine: 'sapi', voice: 'fake', local: true }),
  };
  const queue = new SpeechQueue(speaker, undefined, (e) => errors.push(e.message));
  queue.enqueue('Falla.');
  queue.enqueue('Sigue.');
  await queue.drain();
  assert.deepEqual(errors, ['sin voz']);
  assert.deepEqual(spoken, ['Sigue.']);
});
