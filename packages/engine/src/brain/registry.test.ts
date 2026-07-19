import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveModel } from './registry.js';
import type { BrainConfig } from './types.js';

function baseConfig(confidential: boolean): BrainConfig {
  return {
    model: 'ollama/gemma4:12b',
    systemPrompt: 'test',
    confidential,
    providers: {
      ollama: {
        baseUrl: 'http://127.0.0.1:11434/v1',
        apiKey: 'ollama',
        local: true,
        cloudModels: ['gemma4:31b-cloud'],
      },
      anthropic: {
        baseUrl: 'https://api.anthropic.com/v1',
        apiKey: 'test-key',
        local: false,
      },
    },
  };
}

test('modo confidencial permite un modelo local', () => {
  const r = resolveModel('ollama/gemma4:12b', baseConfig(true));
  assert.equal(r.local, true);
  assert.equal(r.model, 'gemma4:12b');
});

test('modo confidencial BLOQUEA un modelo de nube de un proveedor local', () => {
  // gemma4:31b-cloud corre en la nube pese a ser del proveedor "ollama" (local).
  // Debe bloquearse: es el fallo que el diagnostico marco como critico.
  assert.throws(
    () => resolveModel('ollama/gemma4:31b-cloud', baseConfig(true)),
    /confidencial/i,
  );
});

test('modo confidencial bloquea un proveedor de nube', () => {
  assert.throws(() => resolveModel('anthropic/claude-sonnet-5', baseConfig(true)), /confidencial/i);
});

test('fuera de confidencial, el modelo de nube se resuelve como no-local', () => {
  const r = resolveModel('ollama/gemma4:31b-cloud', baseConfig(false));
  assert.equal(r.local, false);
});

test('fuera de confidencial, un proveedor de nube va bien', () => {
  const r = resolveModel('anthropic/claude-sonnet-5', baseConfig(false));
  assert.equal(r.local, false);
  assert.equal(r.provider, 'anthropic');
});

test('referencia sin barra es invalida', () => {
  assert.throws(() => resolveModel('gemma4:12b', baseConfig(false)), /proveedor\/modelo/);
});
