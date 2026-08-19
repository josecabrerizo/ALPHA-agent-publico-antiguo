import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveLiveSettings } from './settings-store.js';

/**
 * El motor es el ESCRITOR UNICO de alpha.settings.json; la UI solo manda el
 * cambio por el puente. Se prueba con un fichero temporal para no pisar la
 * configuracion de verdad de quien ejecute los tests.
 */

const dir = mkdtempSync(path.join(os.tmpdir(), 'alpha-settings-'));
const file = (name: string) => path.join(dir, name);

test('crea el fichero con el parche si no existia', () => {
  const f = file('a.json');
  assert.equal(saveLiveSettings({ agent: 'nexus' }, f), true);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { agent: 'nexus' });
});

test('fusiona sobre lo existente sin perder las demas claves', () => {
  const f = file('b.json');
  writeFileSync(f, JSON.stringify({ agent: 'vulpis', audioDevice: 'mic-1' }), 'utf8');
  assert.equal(saveLiveSettings({ micEnabled: false }, f), true);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), {
    agent: 'vulpis',
    audioDevice: 'mic-1',
    micEnabled: false,
  });
});

test('un fichero corrupto no tumba el guardado: se parte de cero', () => {
  const f = file('c.json');
  writeFileSync(f, '{ esto no es JSON', 'utf8');
  assert.equal(saveLiveSettings({ agent: 'nexus' }, f), true);
  assert.deepEqual(JSON.parse(readFileSync(f, 'utf8')), { agent: 'nexus' });
});

test('micEnabled false se guarda como false, no desaparece', () => {
  const f = file('d.json');
  saveLiveSettings({ micEnabled: false }, f);
  assert.equal((JSON.parse(readFileSync(f, 'utf8')) as { micEnabled: boolean }).micEnabled, false);
});
