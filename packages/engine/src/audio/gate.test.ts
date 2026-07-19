import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { AudioGate } from './gate.js';

const tick = () => new Promise((r) => setImmediate(r));

test('entrega con la puerta abierta y descarta con la cerrada', async () => {
  const source = new PassThrough();
  const gate = new AudioGate(source);

  const received: string[] = [];
  const consumer = (async () => {
    for await (const chunk of gate) received.push(chunk.toString());
  })();

  source.write('A'); // abierta -> se recibe
  await tick();

  gate.setOpen(false);
  source.write('B'); // cerrada -> se descarta
  await tick();

  gate.setOpen(true);
  source.write('C'); // abierta -> se recibe
  await tick();

  source.end();
  await consumer;

  assert.deepEqual(received, ['A', 'C']);
});

test('cerrar la puerta descarta lo ya encolado sin consumir', async () => {
  const source = new PassThrough();
  const gate = new AudioGate(source);

  // Sin consumidor todavia: los chunks se encolan.
  source.write('X');
  source.write('Y');
  await tick();

  // Cerrar debe vaciar la cola: ese audio es viejo.
  gate.setOpen(false);
  gate.setOpen(true);

  const received: string[] = [];
  const consumer = (async () => {
    for await (const chunk of gate) received.push(chunk.toString());
  })();
  source.write('Z');
  await tick();
  source.end();
  await consumer;

  assert.deepEqual(received, ['Z']);
});
