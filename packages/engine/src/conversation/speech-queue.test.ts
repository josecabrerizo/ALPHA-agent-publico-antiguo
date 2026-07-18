import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSentences } from './speech-queue.js';

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
