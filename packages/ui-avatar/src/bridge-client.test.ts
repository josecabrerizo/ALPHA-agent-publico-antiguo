import { test } from 'node:test';
import assert from 'node:assert/strict';
import { takeLines, tokenFileFor } from './bridge-client.js';

/**
 * El puente manda un JSON por linea sobre TCP, y TCP no respeta los limites de
 * mensaje: un JSON puede llegar partido en dos chunks y dos JSON pueden venir
 * juntos en uno. La lista de voces son ~120 entradas y no cabe en un chunk, asi
 * que este trozeado no es un caso teorico.
 */

/** Reproduce la acumulacion del socket: mete los chunks uno a uno. */
function feed(chunks: string[]): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = '';
  for (const chunk of chunks) {
    const out = takeLines(rest + chunk);
    lines.push(...out.lines);
    rest = out.rest;
  }
  return { lines, rest };
}

test('varios mensajes en un solo chunk salen todos', () => {
  const { lines, rest } = takeLines('{"a":1}\n{"b":2}\n{"c":3}\n');
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}', '{"c":3}']);
  assert.equal(rest, '');
});

test('un mensaje partido en dos chunks se recompone', () => {
  const { lines, rest } = feed(['{"tipo":"vo', 'ces","n":120}\n']);
  assert.deepEqual(lines, ['{"tipo":"voces","n":120}']);
  assert.equal(rest, '');
});

test('lo que llega a medias se conserva para el chunk siguiente', () => {
  const primero = takeLines('{"a":1}\n{"b":');
  assert.deepEqual(primero.lines, ['{"a":1}']);
  assert.equal(primero.rest, '{"b":', 'sin esto el segundo mensaje se pierde');

  const segundo = takeLines(primero.rest + '2}\n');
  assert.deepEqual(segundo.lines, ['{"b":2}']);
  assert.equal(segundo.rest, '');
});

test('partir por cada byte da el mismo resultado que de una vez', () => {
  const flujo = '{"a":1}\n{"b":2}\n{"c":3}\n';
  assert.deepEqual(feed([...flujo]).lines, takeLines(flujo).lines);
});

test('las lineas en blanco se descartan', () => {
  assert.deepEqual(takeLines('\n\n{"a":1}\n   \n').lines, ['{"a":1}']);
});

test('sin salto de linea no sale nada todavia', () => {
  const { lines, rest } = takeLines('{"a":1}');
  assert.deepEqual(lines, []);
  assert.equal(rest, '{"a":1}', 'un mensaje sin cerrar no puede darse por completo');
});

/**
 * Un fichero de token por puerto: si dos instancias lo compartieran, la segunda
 * invalidaria la autenticacion de la primera. El nombre tiene que coincidir con
 * el que escribe el motor (bridgeTokenPathFor).
 */
test('el puerto por defecto conserva el nombre de siempre', () => {
  assert.equal(tokenFileFor(43117), 'alpha.bridge-token');
});

test('otro puerto, otro fichero', () => {
  assert.equal(tokenFileFor(43118), 'alpha.bridge-token.43118');
  assert.notEqual(tokenFileFor(43118), tokenFileFor(43117));
});
