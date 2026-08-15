import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseAvatars, loadAvatars, patchAvatarsYaml } from './avatars.js';
import { repoRoot } from '../paths.js';

/**
 * Lo que se prueba aqui es el CONTRATO DE PRIVACIDAD del perfil: un avatar
 * declarado local no puede acabar hablando por la nube, pase lo que pase en el
 * YAML. Es la regla que sostiene el modo confidencial.
 */

test('un avatar confidencial con voz de nube declarada se corrige a la voz del sistema', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: nexus
    name: Nexus
    confidential: true
    voice: { engine: edge, name: es-ES-AlvaroNeural, rate: 0 }
`);
  assert.ok(avatar);
  assert.equal(avatar.voice.engine, 'sapi', 'un avatar local no puede usar Edge (nube)');
  assert.equal(avatar.voice.name, 'Microsoft Helena Desktop');
});

test('un avatar no confidencial conserva su voz de nube', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: vulpis
    name: Vulpis.AI
    confidential: false
    voice: { engine: edge, name: es-ES-AlvaroNeural, rate: 0 }
`);
  assert.ok(avatar);
  assert.equal(avatar.voice.engine, 'edge');
  assert.equal(avatar.voice.name, 'es-ES-AlvaroNeural');
});

test('confidential se declara explicitamente y local se admite como migracion', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: x
    name: X
`);
  assert.ok(avatar);
  assert.equal(avatar.confidential, false);
  const [legacy] = parseAvatars('avatars: [{ id: legacy, name: Legacy, local: true }]');
  assert.equal(legacy?.confidential, true);
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
    if (a.confidential)
      assert.equal(a.voice.engine, 'sapi', `${a.id} es confidencial y debe usar voz local`);
  }
  assert.ok(
    avatars.some((a) => a.confidential),
    'debe haber al menos un avatar confidencial',
  );
});

test('actualiza solo el perfil pedido y conserva comentarios y los demas avatares', () => {
  const raw = `# cabecera\navatars:\n  - id: uno\n    name: Uno\n    local: false # legado\n    model: ollama/a\n    voice: { engine: edge, name: voz-a, rate: 1 }\n  - id: dos\n    name: Dos\n    model: ollama/b\n`;
  const next = patchAvatarsYaml(raw, 'uno', {
    model: 'ollama/nuevo',
    confidential: true,
    voice: { engine: 'sapi', name: 'Helena', rate: -1 },
  });
  assert.match(next, /# cabecera/);
  assert.doesNotMatch(next, /local:/);
  const avatars = parseAvatars(next);
  assert.equal(avatars[0]?.model, 'ollama/nuevo');
  assert.equal(avatars[0]?.confidential, true);
  assert.deepEqual(avatars[0]?.voice, { engine: 'sapi', name: 'Helena', rate: -1 });
  assert.equal(avatars[1]?.model, 'ollama/b');
});

test('rechaza modificar un avatar que no existe', () => {
  assert.throws(
    () => patchAvatarsYaml('avatars: [{ id: uno, name: Uno }]', 'otro', { model: 'x/y' }),
    /desconocido/,
  );
});

/**
 * El contrato solo exigia que hubiera una RUTA de imagen, no que apuntase a
 * algo. Por eso paso desapercibido que el avatar por defecto (unit-a) apuntara
 * a un .svg que no existe: la UI no encontraba el fichero y caia al orbe, con
 * el personaje desaparecido y sin mas rastro que una linea de log.
 */
test('las imagenes de los avatares existen de verdad', () => {
  for (const a of loadAvatars()) {
    assert.ok(existsSync(a.image), `${a.id}: no existe la imagen ${a.image}`);
  }
});

/**
 * La carpeta de poses de un avatar se deduce de la ruta de su retrato
 * (`synapse.png` -> `synapse/`), asi que su nombre tiene que coincidir EXACTO.
 *
 * En Windows da igual la caja y esto no se nota; en Linux, una carpeta
 * "Synapse/" no la encuentra nadie y el personaje se queda quieto sin que nada
 * lo delate. Se compara contra lo que devuelve readdir, que da el nombre real
 * del disco, en vez de contra existsSync, que aqui mentiria.
 */
test('las carpetas de poses se llaman igual que su avatar, con la misma caja', () => {
  const dir = path.join(repoRoot, 'assets', 'avatars');
  const enDisco = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const carpeta of enDisco) {
    const ids = loadAvatars().map((a) => a.id);
    assert.ok(
      ids.includes(carpeta),
      `la carpeta "${carpeta}" no corresponde a ningun avatar (¿caja distinta?); ids: ${ids.join(', ')}`,
    );
  }
});

/** Un juego de poses a medias deja una transicion sin uno de sus extremos. */
test('un avatar con poses las tiene TODAS', () => {
  const dir = path.join(repoRoot, 'assets', 'avatars');
  const poses = ['reposo', 'saludo', 'hablando', 'pensando'];
  for (const a of loadAvatars()) {
    const suyo = path.join(dir, a.id);
    if (!existsSync(suyo)) continue; // sin poses: retrato fijo, es valido
    const hay = readdirSync(suyo);
    for (const p of poses) {
      assert.ok(
        hay.includes(`${p}.png`),
        `${a.id}: falta la pose ${p}.png (hay: ${hay.join(', ')})`,
      );
    }
  }
});
