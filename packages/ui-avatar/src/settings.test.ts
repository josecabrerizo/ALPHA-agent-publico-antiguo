import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeSettings, DEFAULT_SETTINGS, MODEL_OPTIONS } from './settings.js';
import { AGENT_ORDER } from './agents.js';

/**
 * El fichero de ajustes lo escribe el avatar, pero tambien puede editarlo una
 * persona o quedarse a medias en un apagon. Lo que se prueba aqui es que un
 * fichero raro no tumbe la ventana: antes se volcaba tal cual sobre los
 * defaults y un `agent` inventado reventaba al buscar su color en AGENTS.
 *
 * Se prueba mergeSettings, no loadSettings: leer de disco tocaria la
 * configuracion de verdad de quien ejecute los tests.
 */

test('un fichero al que le faltan claves se completa con los defaults', () => {
  const s = mergeSettings({ agent: 'nexus' });
  assert.equal(s.agent, 'nexus');
  assert.equal(s.model, DEFAULT_SETTINGS.model);
  assert.equal(s.micEnabled, DEFAULT_SETTINGS.micEnabled);
  assert.equal(s.voiceId, DEFAULT_SETTINGS.voiceId);
});

test('un agente que no existe cae al de por defecto', () => {
  assert.equal(mergeSettings({ agent: 'clippy' }).agent, DEFAULT_SETTINGS.agent);
  assert.equal(mergeSettings({ agent: 42 }).agent, DEFAULT_SETTINGS.agent);
});

test('los tipos equivocados no entran', () => {
  const s = mergeSettings({ micEnabled: 'false', confidential: 1, model: null, audioDevice: [] });
  assert.equal(s.micEnabled, DEFAULT_SETTINGS.micEnabled, '"false" en texto no es un booleano');
  assert.equal(s.confidential, DEFAULT_SETTINGS.confidential);
  assert.equal(s.model, DEFAULT_SETTINGS.model);
  assert.equal(s.audioDevice, DEFAULT_SETTINGS.audioDevice);
});

test('un fichero vacio, nulo o que no es un objeto devuelve los defaults', () => {
  assert.deepEqual(mergeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings('texto suelto'), DEFAULT_SETTINGS);
  assert.deepEqual(mergeSettings({}), DEFAULT_SETTINGS);
});

test('micEnabled false se respeta (no se confunde con "ausente")', () => {
  // El caso que se pierde con un `??`: false es un valor, no una falta.
  assert.equal(mergeSettings({ micEnabled: false }).micEnabled, false);
  assert.equal(mergeSettings({ confidential: false }).confidential, false);
});

test('el agente por defecto es uno de los que hay', () => {
  assert.ok(AGENT_ORDER.includes(DEFAULT_SETTINGS.agent));
});

/**
 * El menu ofrece estos modelos y el modo confidencial se queda solo con los
 * locales: si no hubiera ninguno, activarlo dejaria al asistente sin cerebro.
 */
test('hay al menos un modelo local, o el modo confidencial se queda sin opciones', () => {
  assert.ok(MODEL_OPTIONS.some((m) => m.local));
});

test('el modelo por defecto esta en la lista del menu', () => {
  assert.ok(
    MODEL_OPTIONS.some((m) => m.ref === DEFAULT_SETTINGS.model),
    `${DEFAULT_SETTINGS.model} no aparece en MODEL_OPTIONS: el menu no lo marcaria`,
  );
});

test('no hay refs de modelo repetidas', () => {
  const refs = MODEL_OPTIONS.map((m) => m.ref);
  assert.equal(new Set(refs).size, refs.length);
});
