import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { DEFAULT_ORB_COLOR } from '@alpha/protocol';
import { parseAvatars, loadAvatars, patchAvatarsYaml } from './avatars.js';
import { repoRoot } from '../paths.js';

/**
 * Lector minimo de PNG, solo para mirar el canal alfa de nuestros propios
 * assets. El motor no tiene libreria de imagen y no merece la pena anadir una
 * dependencia por un test; con zlib, que viene en Node, basta.
 *
 * Asume lo que producimos: 8 bits, RGBA, sin entrelazar. Si algun dia deja de
 * cumplirse, el propio test lo dice en vez de leer basura.
 */
async function leerPng(file: string): Promise<{
  width: number;
  height: number;
  alphaAt: (x: number, y: number) => number;
}> {
  const buf = await readFile(file);
  let pos = 8; // cabecera PNG
  let width = 0;
  let height = 0;
  const trozos: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const tipo = buf.toString('ascii', pos + 4, pos + 8);
    const datos = buf.subarray(pos + 8, pos + 8 + len);
    if (tipo === 'IHDR') {
      width = datos.readUInt32BE(0);
      height = datos.readUInt32BE(4);
      assert.equal(datos[8], 8, `${file}: se esperaban 8 bits por canal`);
      assert.equal(datos[9], 6, `${file}: se esperaba RGBA`);
      assert.equal(datos[12], 0, `${file}: se esperaba sin entrelazar`);
    } else if (tipo === 'IDAT') {
      trozos.push(datos);
    } else if (tipo === 'IEND') {
      break;
    }
    pos += 12 + len; // longitud + tipo + datos + CRC
  }

  const bruto = inflateSync(Buffer.concat(trozos));
  const paso = width * 4;
  const px = Buffer.alloc(paso * height);
  const paeth = (a: number, b: number, c: number): number => {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filtro = bruto[src++]!;
    for (let i = 0; i < paso; i++) {
      const x = bruto[src++]!;
      const a = i >= 4 ? px[y * paso + i - 4]! : 0;
      const b = y > 0 ? px[(y - 1) * paso + i]! : 0;
      const c = i >= 4 && y > 0 ? px[(y - 1) * paso + i - 4]! : 0;
      const v =
        filtro === 0
          ? x
          : filtro === 1
            ? x + a
            : filtro === 2
              ? x + b
              : filtro === 3
                ? x + ((a + b) >> 1)
                : x + paeth(a, b, c);
      px[y * paso + i] = v & 0xff;
    }
  }
  return { width, height, alphaAt: (x, y) => px[y * paso + x * 4 + 3]! };
}

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
  const dir = path.join(repoRoot, 'assets', 'avatars');
  for (const a of loadAvatars()) {
    const png = path.join(dir, `${a.imageId}.png`);
    const svg = path.join(dir, `${a.imageId}.svg`);
    assert.ok(existsSync(png) || existsSync(svg), `${a.id}: no existe la imagen ${png} (ni .svg)`);
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
    const ids = loadAvatars().map((a) => a.imageId);
    assert.ok(
      ids.includes(carpeta),
      `la carpeta "${carpeta}" no corresponde a ningun avatar (¿caja distinta?); ids: ${ids.join(', ')}`,
    );
  }
});

/**
 * Ninguna pose puede tocar el borde de su lienzo.
 *
 * Lo pillo Codex revisando: el alineador desplazaba con ImageChops.offset, que
 * es un desplazamiento CIRCULAR — lo que salia por un lado reaparecia por el
 * otro—, y ademas recortaba usando la caja de la mascara binaria, que amputaba
 * lo tenue. En Synapse dejaba bandas desprendidas de 150 px de ancho. Se veia
 * en la app, pero nada fallaba, asi que hacia falta medirlo.
 *
 * Se mira el PNG en crudo, sin escalar: si hay alfa pegado al borde, es que la
 * figura esta cortada o hay un trozo que no le corresponde.
 */
test('ninguna pose toca el borde de su lienzo', async () => {
  const dir = path.join(repoRoot, 'assets', 'avatars');
  for (const a of loadAvatars()) {
    const suyo = path.join(dir, a.imageId);
    if (!existsSync(suyo)) continue;
    for (const f of readdirSync(suyo).filter((x) => x.endsWith('.png'))) {
      const { width, height, alphaAt } = await leerPng(path.join(suyo, f));
      let tocando = 0;
      for (let x = 0; x < width; x++) {
        if (alphaAt(x, 0) > 16) tocando++;
        if (alphaAt(x, height - 1) > 16) tocando++;
      }
      for (let y = 0; y < height; y++) {
        if (alphaAt(0, y) > 16) tocando++;
        if (alphaAt(width - 1, y) > 16) tocando++;
      }
      assert.equal(tocando, 0, `${a.id}/${f}: ${tocando} pixeles de contenido pegados al borde`);
    }
  }
});

/** Un juego de poses a medias deja una transicion sin uno de sus extremos. */
test('un avatar con poses las tiene TODAS', () => {
  const dir = path.join(repoRoot, 'assets', 'avatars');
  const poses = ['reposo', 'saludo', 'hablando', 'pensando'];
  for (const a of loadAvatars()) {
    const suyo = path.join(dir, a.imageId);
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
