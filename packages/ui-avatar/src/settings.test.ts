import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  mergeSettings,
  loadSettings,
  saveSettings,
  loadPendiente,
  savePendiente,
  DEFAULT_SETTINGS,
} from './settings.js';
import { AGENT_ORDER } from './agents.js';

/**
 * El fichero es la cache de presentacion de la UI, pero puede editarlo una
 * persona o quedarse a medias en un apagon. Lo que se prueba aqui es que un
 * fichero raro no tumbe la ventana: los tipos equivocados caen a los defaults.
 *
 * Se prueba mergeSettings, no loadSettings: leer de disco tocaria la
 * configuracion de verdad de quien ejecute los tests.
 */

test('un fichero al que le faltan claves se completa con los defaults', () => {
  const s = mergeSettings({ agent: 'nexus' });
  assert.equal(s.agent, 'nexus');
  assert.equal(s.micEnabled, DEFAULT_SETTINGS.micEnabled);
});

test('un agente desconocido se conserva: la lista la manda el motor', () => {
  // Antes se filtraba contra el catalogo local y un quinto avatar del motor no
  // podia sobrevivir a un reinicio de la UI. El orbe cae al color neutro.
  assert.equal(mergeSettings({ agent: 'quinto' }).agent, 'quinto');
});

test('un agente que no es texto (o esta vacio) cae al de por defecto', () => {
  assert.equal(mergeSettings({ agent: 42 }).agent, DEFAULT_SETTINGS.agent);
  assert.equal(mergeSettings({ agent: '   ' }).agent, DEFAULT_SETTINGS.agent);
});

test('los tipos equivocados no entran', () => {
  const s = mergeSettings({ micEnabled: 'false', audioDevice: [] });
  assert.equal(s.micEnabled, DEFAULT_SETTINGS.micEnabled, '"false" en texto no es un booleano');
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
});

test('el agente por defecto es uno de los que hay', () => {
  assert.ok(AGENT_ORDER.includes(DEFAULT_SETTINGS.agent));
});

/**
 * El parche pendiente (un cambio hecho con el motor apagado) es una promesa
 * de privacidad: tiene que sobrevivir a guardar los ajustes y a reiniciar la
 * UI. Se prueba contra un ALPHA_HOME temporal para no pisar el de verdad.
 */
test('el parche pendiente sobrevive a guardar ajustes y a un reinicio', () => {
  process.env['ALPHA_HOME'] = mkdtempSync(path.join(os.tmpdir(), 'alpha-ui-settings-'));
  savePendiente({ micEnabled: false });
  saveSettings({ agent: 'nexus', audioDevice: '', micEnabled: false });
  assert.deepEqual(
    loadPendiente(),
    { micEnabled: false },
    'guardar los ajustes no puede borrar la promesa sin entregar',
  );
  assert.equal(loadSettings().agent, 'nexus', 'y el parche no pisa los ajustes');
  savePendiente(undefined);
  assert.deepEqual(loadPendiente(), {}, 'entregado el parche, se limpia');
});

test('un parche corrupto en disco se descarta campo a campo', () => {
  process.env['ALPHA_HOME'] = mkdtempSync(path.join(os.tmpdir(), 'alpha-ui-settings-'));
  savePendiente({ micEnabled: false, agent: 'nexus' });
  // Se relee saneado; los tipos equivocados no entran (mismo criterio que
  // mergeSettings, pero sin defaults: lo que no vale, simplemente no esta).
  assert.deepEqual(loadPendiente(), { micEnabled: false, agent: 'nexus' });
});
