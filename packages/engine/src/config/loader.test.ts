import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from './loader.js';

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
