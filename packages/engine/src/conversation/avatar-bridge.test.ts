import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { readFileSync } from 'node:fs';
import { AvatarBridge, bridgeTokenPath } from './avatar-bridge.js';

// Puerto propio de los tests, para no chocar con un motor real en marcha.
const TEST_PORT = 43219;
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function client(): net.Socket {
  return net.connect(TEST_PORT, '127.0.0.1');
}

async function withBridge(fn: (bridge: AvatarBridge, token: string) => Promise<void>): Promise<void> {
  const bridge = new AvatarBridge(TEST_PORT);
  await bridge.start();
  const token = readFileSync(bridgeTokenPath, 'utf8').trim();
  try {
    await fn(bridge, token);
  } finally {
    bridge.stop();
    await tick(50);
  }
}

test('sin token, el motor ignora los comandos', async () => {
  await withBridge(async (bridge) => {
    const recibidos: string[] = [];
    bridge.onTextInput((t) => recibidos.push(t));

    const c = client();
    await new Promise((r) => c.on('connect', r));
    c.write(JSON.stringify({ type: 'text-input', text: 'hola sin token' }) + '\n');
    await tick();
    c.destroy();

    assert.deepEqual(recibidos, [], 'un cliente sin autenticar no debe poder mandar texto');
  });
});

test('con el token correcto, los comandos pasan', async () => {
  await withBridge(async (bridge, token) => {
    const recibidos: string[] = [];
    bridge.onTextInput((t) => recibidos.push(t));

    const c = client();
    await new Promise((r) => c.on('connect', r));
    c.write(JSON.stringify({ type: 'auth', token }) + '\n');
    await tick();
    c.write(JSON.stringify({ type: 'text-input', text: 'hola con token' }) + '\n');
    await tick();
    c.destroy();

    assert.deepEqual(recibidos, ['hola con token']);
  });
});

test('solo los clientes autenticados reciben difusiones', async () => {
  await withBridge(async (bridge, token) => {
    const c = client();
    await new Promise((r) => c.on('connect', r));
    const lineas: string[] = [];
    c.on('data', (d: Buffer) => lineas.push(d.toString()));

    // Antes de autenticar: la difusion NO debe llegar.
    bridge.broadcast({ type: 'state', state: 'pensando' });
    await tick();
    assert.equal(lineas.length, 0, 'sin auth no se recibe nada');

    // Tras autenticar: sí.
    c.write(JSON.stringify({ type: 'auth', token }) + '\n');
    await tick();
    bridge.broadcast({ type: 'state', state: 'hablando' });
    await tick();
    c.destroy();

    assert.ok(lineas.join('').includes('hablando'), 'tras auth se recibe la difusion');
  });
});

test('un token equivocado no autentica', async () => {
  await withBridge(async (bridge) => {
    const recibidos: string[] = [];
    bridge.onConfigMessage((m) => recibidos.push(m.settings.model ?? ''));

    const c = client();
    await new Promise((r) => c.on('connect', r));
    c.write(JSON.stringify({ type: 'auth', token: 'token-falso' }) + '\n');
    await tick();
    c.write(JSON.stringify({ type: 'config', settings: { model: 'anthropic/x' } }) + '\n');
    await tick();
    c.destroy();

    assert.deepEqual(recibidos, []);
  });
});
