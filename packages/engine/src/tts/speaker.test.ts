import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSpeaker, hasLocalVoice } from './speaker.js';

/**
 * Lo que se prueba aqui es el CONTRATO DE PRIVACIDAD de la voz: en modo
 * confidencial no puede salir audio a la nube, diga lo que diga `engine`. Y que
 * "local" se resuelva al motor de ESTE sistema, no siempre a SAPI — forzar SAPI
 * hacia que en Linux el confidencial arrancara y luego fallara frase a frase.
 */

const soportado = process.platform === 'win32' || process.platform === 'linux';

test('el modo confidencial nunca devuelve una voz de nube', { skip: !hasLocalVoice() }, () => {
  const speaker = createSpeaker({ engine: 'edge', edgeVoice: 'es-ES-AlvaroNeural', confidential: true });
  assert.equal(speaker.describe().local, true, 'confidencial con engine=edge debe caer al motor local');
});

test('sin confidencial se respeta el motor pedido', () => {
  assert.equal(createSpeaker({ engine: 'edge' }).describe().engine, 'edge');
});

test('el backend local es el de esta plataforma', { skip: !hasLocalVoice() }, () => {
  const info = createSpeaker({ engine: 'sapi' }).describe();
  assert.equal(info.local, true);
  assert.equal(info.engine, process.platform === 'win32' ? 'sapi' : 'espeak');
});

test('sin motor local, pedirlo falla al construir y no al hablar', { skip: hasLocalVoice() }, () => {
  // El fallo tiene que salir AQUI: descubrirlo a la primera frase deja la
  // conversacion arrancada y muda, con un error por cada cosa que diga.
  assert.throws(() => createSpeaker({ engine: 'sapi' }), /voz local/i);
});

test('hasLocalVoice solo promete voz local donde la hay', () => {
  if (!soportado) assert.equal(hasLocalVoice(), false, 'no hay motor local fuera de Windows y Linux');
  if (process.platform === 'win32') assert.equal(hasLocalVoice(), true, 'Windows siempre trae SAPI');
});
