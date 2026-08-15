import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './loader.js';
import { STT_MODELS } from './schema.js';

// Estos campos vienen de config/default.yaml (comprometido) y no los pisan los
// ajustes en vivo del avatar, asi que la prueba es determinista.

test('el cargador consume config/default.yaml', () => {
  const config = loadConfig();
  // Si el YAML no se leyera, cloudModels vendria solo del default TS; se
  // comprueba que el proveedor y su marca de nube estan.
  assert.equal(config.version, 1);
  assert.ok(config.brain.providers['ollama'], 'ollama debe estar en los proveedores');
  assert.ok(
    config.brain.providers['ollama']?.cloudModels?.includes('gemma4:31b-cloud'),
    'gemma4:31b-cloud debe estar marcado como modelo de nube',
  );
  assert.equal(config.tts.sapiVoice, 'Microsoft Helena Desktop');
});

test('el modo confidencial se propaga al cerebro y a la voz', () => {
  const config = loadConfig();
  assert.equal(config.brain.confidential, config.confidential);
  assert.equal(config.tts.confidential, config.confidential);
});

test('la config tiene una forma valida', () => {
  const config = loadConfig();
  assert.equal(typeof config.confidential, 'boolean');
  assert.equal(typeof config.brain.model, 'string');
  assert.ok(config.tts.engine === 'edge' || config.tts.engine === 'sapi');
  assert.ok(Number.isFinite(config.audio.gainDb));
});

/**
 * Todo lo que el menu del avatar guarda tiene que tener sitio en la config, o
 * se escribe en disco y no lo lee nadie: era el caso del mute del microfono y
 * de la voz elegida, que se perdian en cada reinicio.
 */
test('los ajustes globales que guarda la UI tienen su hueco en la config', () => {
  const config = loadConfig();
  assert.equal(typeof config.audio.micEnabled, 'boolean', 'falta audio.micEnabled');
});

test('stt.model es uno de los tamanos que el proyecto sabe descargar', () => {
  const config = loadConfig();
  assert.ok(
    STT_MODELS.includes(config.stt.model),
    `stt.model "${config.stt.model}" no es ${STT_MODELS.join(' | ')}`,
  );
});
