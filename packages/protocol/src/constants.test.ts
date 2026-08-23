import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { alphaHomeDir, bridgeTokenPathFor } from './constants.js';

/**
 * Un fichero de token por puerto: si dos instancias lo compartieran, la segunda
 * invalidaria la autenticacion de la primera. Servidor y cliente calculan la
 * ruta con ESTA funcion, asi que el nombre ya no puede desalinearse.
 */
test('el puerto por defecto conserva el nombre de siempre', () => {
  assert.equal(path.basename(bridgeTokenPathFor(43117)), 'alpha.bridge-token');
});

test('otro puerto, otro fichero', () => {
  assert.equal(path.basename(bridgeTokenPathFor(43118)), 'alpha.bridge-token.43118');
  assert.notEqual(bridgeTokenPathFor(43118), bridgeTokenPathFor(43117));
});

test('el token vive en la carpeta de datos, no en el repo', () => {
  assert.equal(path.dirname(bridgeTokenPathFor()), alphaHomeDir());
});

test('ALPHA_HOME mueve la carpeta de datos (y se lee en cada llamada)', () => {
  const previo = process.env['ALPHA_HOME'];
  try {
    process.env['ALPHA_HOME'] = path.join('C:', 'otra', 'carpeta');
    assert.equal(path.dirname(bridgeTokenPathFor()), process.env['ALPHA_HOME']);
  } finally {
    if (previo === undefined) delete process.env['ALPHA_HOME'];
    else process.env['ALPHA_HOME'] = previo;
  }
});
