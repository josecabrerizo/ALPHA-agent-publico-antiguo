import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_AVATAR_ID, DEFAULT_ORB_COLOR, FOUNDER_AVATARS } from '@alpha/protocol';
import { parseAvatars, loadAvatars, patchAvatarsYaml } from './avatars.js';

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

test('del campo image sale un imageId, no una ruta (el arte es de la UI)', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: unit-a
    name: Unit-A
    image: assets/avatars/unit-a.png
`);
  assert.ok(avatar);
  assert.equal(avatar.imageId, 'unit-a');
});

test('sin campo image, el imageId es el propio id del perfil', () => {
  const [avatar] = parseAvatars('avatars: [{ id: nexus, name: Nexus }]');
  assert.equal(avatar?.imageId, 'nexus');
});

test('una imagen fuera de la convencion se avisa: solo viaja su imageId', () => {
  const avisos: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => avisos.push(args.join(' '));
  try {
    // Antes viajaba la ruta absoluta y esto funcionaba; ahora degradaria al
    // orbe en silencio si nadie lo dijera.
    const [custom] = parseAvatars('avatars: [{ id: c, name: C, image: "C:/fotos/mi-cara.jpg" }]');
    assert.equal(custom?.imageId, 'mi-cara');
    const [convencional] = parseAvatars(
      'avatars: [{ id: v, name: V, image: assets/avatars/v.png }]',
    );
    assert.equal(convencional?.imageId, 'v');
  } finally {
    console.warn = original;
  }
  assert.equal(avisos.length, 1, 'la ruta convencional no avisa; la custom si');
  assert.match(avisos[0]!, /mi-cara/);
});

test('el color se lee del YAML y uno invalido o ausente cae al neutro', () => {
  const [avatar] = parseAvatars(`
avatars:
  - id: x
    name: X
    color: [235, 150, 70]
`);
  assert.deepEqual(avatar?.color, [235, 150, 70]);
  const [malo] = parseAvatars('avatars: [{ id: y, name: Y, color: [999, -1, azul] }]');
  assert.deepEqual(malo?.color, DEFAULT_ORB_COLOR);
  const [sin] = parseAvatars('avatars: [{ id: z, name: Z }]');
  assert.deepEqual(sin?.color, DEFAULT_ORB_COLOR);
});

test('el avatars.yaml del repo trae los cuatro perfiles y respeta el contrato', () => {
  const avatars = loadAvatars();
  assert.deepEqual(
    avatars.map((a) => a.id),
    ['vulpis', 'unit-a', 'nexus', 'synapse'],
  );
  for (const a of avatars) {
    assert.ok(a.personality, `${a.id} necesita personalidad: es lo que lo hace un perfil`);
    assert.ok(a.imageId, `${a.id} necesita juego de arte`);
    assert.notDeepEqual(
      a.color,
      DEFAULT_ORB_COLOR,
      `${a.id} deberia declarar su color de identidad en avatars.yaml`,
    );
    if (a.confidential)
      assert.equal(a.voice.engine, 'sapi', `${a.id} es confidencial y debe usar voz local`);
  }
  assert.ok(
    avatars.some((a) => a.confidential),
    'debe haber al menos un avatar confidencial',
  );
});

/**
 * FOUNDER_AVATARS (en @alpha/protocol) es la copia del catalogo que usan la
 * fachada avatar-mcp y el respaldo de la UI — piezas que viviran en OTRO repo,
 * sin acceso a este yaml. Este espejo es el puente del invariante: si el yaml
 * cambia, falla aqui y se actualiza protocol; si protocol se desvia, tambien.
 */
test('el catalogo compartido FOUNDER_AVATARS es un espejo exacto del yaml', () => {
  const enElCable = loadAvatars().map((a) => ({
    id: a.id,
    name: a.name,
    role: a.role,
    model: a.model,
    confidential: a.confidential,
    voice: a.voice,
    imageId: a.imageId,
    color: a.color,
  }));
  assert.deepEqual(enElCable, [...FOUNDER_AVATARS]);
  assert.ok(
    FOUNDER_AVATARS.some((a) => a.id === DEFAULT_AVATAR_ID),
    'el avatar por defecto del catalogo debe existir en el propio catalogo',
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

// Los tests del ARTE (retratos, carpetas de poses, bordes, juego completo)
// viven ahora en ui-avatar/src/art.test.ts: validan los assets de la UI, no
// el yaml del motor, y alli se apoyan en FOUNDER_AVATARS — el test espejo de
// arriba garantiza que ese catalogo y este yaml son la misma cosa.
