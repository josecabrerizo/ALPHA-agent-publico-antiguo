import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { AvatarBridge, bridgeTokenPathFor } from './avatar-bridge.js';

// Puerto propio de los tests, para no chocar con un motor real en marcha. El
// fichero de token va atado al puerto, asi que los tests tampoco le pisan el
// token a un motor que este corriendo de verdad.
const TEST_PORT = 43219;
const TEST_TOKEN_PATH = bridgeTokenPathFor(TEST_PORT);
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function client(): net.Socket {
  return net.connect(TEST_PORT, '127.0.0.1');
}

async function withBridge(fn: (bridge: AvatarBridge, token: string) => Promise<void>): Promise<void> {
  const bridge = new AvatarBridge(TEST_PORT);
  await bridge.start();
  const token = readFileSync(TEST_TOKEN_PATH, 'utf8').trim();
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

test('el interruptor de microfono llega validado y descarta la basura', async () => {
  await withBridge(async (bridge, token) => {
    const recibidos: unknown[] = [];
    bridge.onConfigMessage((m) => recibidos.push(m.settings));

    const c = client();
    await new Promise((r) => c.on('connect', r));
    c.write(JSON.stringify({ type: 'auth', token }) + '\n');
    await tick();
    c.write(JSON.stringify({ type: 'config', settings: { micEnabled: false } }) + '\n');
    // "false" en texto no es un booleano: se descarta, y con el objeto vacio no
    // se emite nada. Silenciar el micro no puede depender de un cast.
    c.write(JSON.stringify({ type: 'config', settings: { micEnabled: 'false' } }) + '\n');
    await tick();
    c.destroy();

    assert.deepEqual(recibidos, [{ micEnabled: false }]);
  });
});

test('un segundo puente en el mismo puerto avisa en vez de fingir que escucha', async () => {
  await withBridge(async (bridge, token) => {
    const segundo = new AvatarBridge(TEST_PORT);
    const escuchando = await segundo.start();
    segundo.stop();
    assert.equal(escuchando, false, 'el puerto esta ocupado y hay que decirlo');

    // Y sobre todo: no puede haber tocado el token del que SI escucha. Antes se
    // escribia antes de intentar el listen, asi que el avatar releia el token
    // del motor mudo y el bueno dejaba de autenticarlo.
    assert.equal(
      readFileSync(TEST_TOKEN_PATH, 'utf8').trim(),
      token,
      'el motor que no pudo abrir el puerto no debe pisar el token del que si',
    );

    // El token que quedo en disco sigue valiendo para el puente vivo.
    const c = client();
    await new Promise((r) => c.on('connect', r));
    const lineas: string[] = [];
    c.on('data', (d: Buffer) => lineas.push(d.toString()));
    c.write(JSON.stringify({ type: 'auth', token }) + '\n');
    await tick();
    bridge.broadcast({ type: 'state', state: 'hablando' });
    await tick();
    c.destroy();
    assert.ok(lineas.join('').includes('hablando'), 'el avatar sigue autenticandose');
  });
});

test('al parar, el token de sesion no se queda en disco', async () => {
  const bridge = new AvatarBridge(TEST_PORT);
  await bridge.start();
  assert.equal(existsSync(TEST_TOKEN_PATH), true);
  bridge.stop();
  await tick(50);
  assert.equal(existsSync(TEST_TOKEN_PATH), false, 'un token sin motor detras no pinta nada ahi');
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
