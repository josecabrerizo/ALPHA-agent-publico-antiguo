import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { parseAvatars, loadAvatars } from './avatars.js';
import { repoRoot } from '../paths.js';

/**
 * Lo que se prueba aqui es el CONTRATO DE PRIVACIDAD del perfil: un avatar
 * declarado local no puede acabar hablando por la nube, pase lo que pase en el
 * YAML. Es la regla que sostiene el modo confidencial.
 */

test('un avatar local con voz de nube declarada se corrige a la voz del sistema', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: nexus
    name: Nexus
    local: true
    voice: { engine: edge, name: es-ES-AlvaroNeural, rate: 0 }
`);
  assert.ok(avatar);
  assert.equal(avatar.voice.engine, 'sapi', 'un avatar local no puede usar Edge (nube)');
});

test('un avatar de nube conserva su voz de nube', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: vulpis
    name: Vulpis.AI
    local: false
    voice: { engine: edge, name: es-ES-AlvaroNeural, rate: 0 }
`);
  assert.ok(avatar);
  assert.equal(avatar.voice.engine, 'edge');
  assert.equal(avatar.voice.name, 'es-ES-AlvaroNeural');
});

test('local se declara explicitamente: sin el, el avatar no se da por local', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: x
    name: X
`);
  assert.ok(avatar);
  assert.equal(avatar.local, false, 'privacidad por omision NO es "local"; hay que declararla');
});

test('los perfiles sin id o sin nombre se descartan sin tumbar el arranque', () => {
  const avatars = parseAvatars(`
avatars:
  - name: sin id
  - id: sin-nombre
  - id: bueno
    name: Bueno
  - 42
`);
  assert.deepEqual(
    avatars.map((a) => a.id),
    ['bueno'],
  );
});

test('YAML invalido o sin lista devuelve vacio en vez de lanzar', () => {
  assert.deepEqual(parseAvatars('avatars: [ esto: no cierra'), []);
  assert.deepEqual(parseAvatars('otra_cosa: 1'), []);
  assert.deepEqual(parseAvatars(''), []);
});

test('la imagen se resuelve a ruta absoluta (la UI es otro proceso)', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: unit-a
    name: Unit-A
    image: assets/avatars/unit-a.png
`);
  assert.ok(avatar);
  assert.equal(path.isAbsolute(avatar.image), true);
  assert.equal(avatar.image, path.resolve(repoRoot, 'assets/avatars/unit-a.png'));
});

test('el avatars.yaml del repo trae los cuatro perfiles y respeta el contrato', () => {
  const avatars = loadAvatars();
  assert.deepEqual(
    avatars.map((a) => a.id),
    ['vulpis', 'unit-a', 'nexus', 'synapse'],
  );
  for (const a of avatars) {
    assert.ok(a.personality, `${a.id} necesita personalidad: es lo que lo hace un perfil`);
    assert.ok(a.image, `${a.id} necesita imagen`);
    if (a.local) assert.equal(a.voice.engine, 'sapi', `${a.id} es local y debe usar voz del sistema`);
  }
  assert.ok(
    avatars.some((a) => a.local),
    'debe haber al menos un avatar local, o el modo confidencial se queda sin opciones',
  );
});
