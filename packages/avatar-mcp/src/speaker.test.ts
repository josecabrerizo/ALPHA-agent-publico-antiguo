import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FOUNDER_AVATARS } from '@alpha/protocol';
import { createFacadeSpeaker, SapiSpeaker } from './speaker.js';

/**
 * Solo la FABRICA (modos y seleccion de voz): SapiSpeaker.speak lanza
 * PowerShell de verdad y eso no se prueba aqui — hablaria por los altavoces
 * de quien ejecute los tests.
 */

const unitA = FOUNDER_AVATARS.find((a) => a.id === 'unit-a')!;
const vulpis = FOUNDER_AVATARS.find((a) => a.id === 'vulpis')!;

test('off y modos invalidos dejan la cara muda (con aviso en el invalido)', () => {
  const avisos: string[] = [];
  assert.equal(createFacadeSpeaker(unitA, { mode: 'off' }), undefined);
  assert.equal(
    createFacadeSpeaker(unitA, { mode: 'piper', log: (m) => avisos.push(m) }),
    undefined,
  );
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /no es sapi \| off/);
});

test('edge ya no existe en la fachada: avisa y cae a sapi', () => {
  const avisos: string[] = [];
  const speaker = createFacadeSpeaker(unitA, { mode: 'edge', log: (m) => avisos.push(m) });
  assert.equal(avisos.length, 1);
  assert.match(avisos[0]!, /motor real/);
  if (process.platform === 'win32') {
    assert.ok(speaker instanceof SapiSpeaker, 'en Windows, cae a la voz local');
  } else {
    assert.equal(speaker, undefined, 'fuera de Windows no hay SAPI');
  }
});

test('la voz del perfil solo vale si es sapi; una edge deja la del sistema', (t) => {
  if (process.platform !== 'win32') return t.skip('SAPI es de Windows');
  assert.ok(createFacadeSpeaker(unitA, { mode: 'sapi' }) instanceof SapiSpeaker);
  // Vulpis tiene voz edge: la fachada no la puede usar, pero habla igual (voz
  // del sistema con el ritmo del perfil), no se queda muda.
  assert.ok(createFacadeSpeaker(vulpis, { mode: 'sapi' }) instanceof SapiSpeaker);
});
