import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import { FOUNDER_AVATARS } from '@alpha/protocol';

/**
 * El ARTE es de la UI: estos tests venian de engine/src/config/avatars.test.ts
 * y se mudaron aqui porque validan los assets, no el yaml del motor. El
 * invariante queda repartido a traves del catalogo compartido de
 * @alpha/protocol: el engine comprueba yaml ↔ FOUNDER_AVATARS, y aqui se
 * comprueba FOUNDER_AVATARS ↔ arte — asi sobrevive a la particion en repos.
 */

const ASSETS_DIR = path.resolve(__dirname, '../../../assets/avatars');

/**
 * Lector minimo de PNG, solo para mirar el canal alfa de nuestros propios
 * assets. La UI no necesita una libreria de imagen para un test; con zlib,
 * que viene en Node, basta.
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
 * El contrato solo exigia que hubiera una RUTA de imagen, no que apuntase a
 * algo. Por eso paso desapercibido que el avatar por defecto (unit-a) apuntara
 * a un .svg que no existe: la UI no encontraba el fichero y caia al orbe, con
 * el personaje desaparecido y sin mas rastro que una linea de log.
 */
test('cada fundador tiene su retrato en los assets', () => {
  for (const a of FOUNDER_AVATARS) {
    const png = path.join(ASSETS_DIR, `${a.imageId}.png`);
    const svg = path.join(ASSETS_DIR, `${a.imageId}.svg`);
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
  const enDisco = readdirSync(ASSETS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const carpeta of enDisco) {
    const ids = FOUNDER_AVATARS.map((a) => a.imageId);
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
  for (const a of FOUNDER_AVATARS) {
    const suyo = path.join(ASSETS_DIR, a.imageId);
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
  const poses = ['reposo', 'saludo', 'hablando', 'pensando'];
  for (const a of FOUNDER_AVATARS) {
    const suyo = path.join(ASSETS_DIR, a.imageId);
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
