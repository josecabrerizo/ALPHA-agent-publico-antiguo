import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  AvatarBridge,
  bridgeTokenPathFor,
  takeLines,
  type EngineToAvatarMessage,
} from '@alpha/protocol';
import type { AvatarProfile, Speaker } from '@alpha/engine';
import { FaceController } from './face.js';

/**
 * El controlador se prueba contra un AvatarBridge REAL y un socket cliente de
 * mentira que hace lo mismo que la app del avatar: autenticarse con el token
 * y escuchar el NDJSON. Sin Qt y sin SDK de MCP, pero con el puente entero de
 * por medio (el patron de server.test.ts en @alpha/protocol).
 */

// Los tests no escriben el token en el ~/.alpha real del usuario.
process.env['ALPHA_HOME'] = mkdtempSync(path.join(os.tmpdir(), 'alpha-face-test-'));

const TEST_PORT = 43231;
const tick = (ms = 150) => new Promise((r) => setTimeout(r, ms));

function perfil(id: string, name: string): AvatarProfile {
  return {
    id,
    name,
    role: 'rol',
    personality: 'p',
    confidential: false,
    model: 'ollama/x',
    imageId: id,
    color: [1, 2, 3],
    voice: { engine: 'sapi', name: 'voz', rate: 0 },
  };
}

class FakeSpeaker implements Speaker {
  spoken: string[] = [];
  fail = false;
  async speak(text: string): Promise<void> {
    if (this.fail) throw new Error('sin voz');
    this.spoken.push(text);
  }
  stop(): void {}
  describe(): { engine: 'sapi'; voice: string; local: boolean } {
    return { engine: 'sapi', voice: 'fake', local: true };
  }
}

interface FakeClient {
  mensajes: EngineToAvatarMessage[];
  enviar(msg: unknown): void;
  cerrar(): void;
}

/** Hace lo que hace la UI: conectar, autenticarse y escuchar. */
async function conectarCliente(): Promise<FakeClient> {
  const socket = net.connect(TEST_PORT, '127.0.0.1');
  await new Promise((r) => socket.on('connect', r));
  const mensajes: EngineToAvatarMessage[] = [];
  let buffer = '';
  socket.on('data', (d: Buffer) => {
    const { lines, rest } = takeLines(buffer + d.toString('utf8'));
    buffer = rest;
    for (const line of lines) mensajes.push(JSON.parse(line) as EngineToAvatarMessage);
  });
  const token = readFileSync(bridgeTokenPathFor(TEST_PORT), 'utf8').trim();
  socket.write(JSON.stringify({ type: 'auth', token }) + '\n');
  await tick();
  return {
    mensajes,
    enviar: (msg) => socket.write(JSON.stringify(msg) + '\n'),
    cerrar: () => socket.destroy(),
  };
}

async function withFace(
  opts: { profiles?: AvatarProfile[]; activeId?: string; speaker?: Speaker },
  fn: (face: FaceController, cliente: FakeClient) => Promise<void>,
): Promise<void> {
  const bridge = new AvatarBridge(TEST_PORT);
  await bridge.start();
  const face = new FaceController(
    bridge,
    opts.profiles ?? [perfil('vulpis', 'Vulpis.AI'), perfil('nexus', 'Nexus')],
    opts.activeId,
    opts.speaker,
  );
  const cliente = await conectarCliente();
  try {
    await fn(face, cliente);
  } finally {
    cliente.cerrar();
    bridge.stop();
    await tick(50);
  }
}

const tipos = (c: FakeClient) => c.mensajes.map((m) => m.type);

test('al autenticarse, la fachada se presenta como lo haria el motor', async () => {
  await withFace({ activeId: 'nexus' }, async (_face, cliente) => {
    assert.deepEqual(tipos(cliente), ['ready', 'mic', 'avatars', 'devices', 'voices', 'models']);
    const mic = cliente.mensajes.find((m) => m.type === 'mic');
    assert.equal(mic?.type === 'mic' && mic.enabled, false, 'la fachada nunca captura');
    const avatars = cliente.mensajes.find((m) => m.type === 'avatars');
    assert.equal(avatars?.type === 'avatars' && avatars.current, 'nexus');
    const primero = avatars?.type === 'avatars' ? avatars.list[0] : undefined;
    assert.equal(primero?.imageId, 'vulpis', 'la UI resuelve el arte por imageId');
    assert.deepEqual(primero?.color, [1, 2, 3]);
    // Las listas del motor van vacias: esta fachada no captura ni reconfigura.
    const devices = cliente.mensajes.find((m) => m.type === 'devices');
    assert.equal(devices?.type === 'devices' && devices.inputs.length, 0);
  });
});

test('decir hace la coreografia entera: hablando, texto, voz, reposo', async () => {
  const speaker = new FakeSpeaker();
  await withFace({ speaker }, async (face, cliente) => {
    await face.decir('hola humano');
    await tick();
    const despues = tipos(cliente).slice(6); // tras la presentacion
    assert.deepEqual(despues, ['state', 'assistant', 'state']);
    const estados = cliente.mensajes.filter((m) => m.type === 'state');
    assert.deepEqual(
      estados.map((m) => (m.type === 'state' ? m.state : '')),
      ['hablando', 'reposo'],
    );
    assert.deepEqual(speaker.spoken, ['hola humano'], 'la voz dice exactamente el texto');
  });
});

test('decir con gesto intercala el gesto tras el texto', async () => {
  await withFace({}, async (face, cliente) => {
    await face.decir('hola', { gesto: 'saludo' });
    await tick();
    assert.deepEqual(tipos(cliente).slice(6), ['state', 'assistant', 'gesture', 'state']);
  });
});

test('si la voz falla, el avatar vuelve a reposo igualmente', async () => {
  const speaker = new FakeSpeaker();
  speaker.fail = true;
  await withFace({ speaker }, async (face, cliente) => {
    await assert.rejects(() => face.decir('hola'), /sin voz/);
    await tick();
    const ultimo = cliente.mensajes.at(-1);
    assert.equal(
      ultimo?.type === 'state' && ultimo.state,
      'reposo',
      'una cara colgada en "hablando" seria peor que el fallo de voz',
    );
  });
});

test('saludar sin texto solo agita la mano', async () => {
  await withFace({}, async (face, cliente) => {
    await face.saludar();
    await tick();
    assert.deepEqual(tipos(cliente).slice(6), ['gesture']);
  });
});

test('cambiarAvatar anuncia el nuevo activo; uno desconocido se rechaza con la lista', async () => {
  await withFace({}, async (face, cliente) => {
    face.cambiarAvatar('nexus');
    await tick();
    const ultimo = cliente.mensajes.at(-1);
    assert.equal(ultimo?.type === 'avatars' && ultimo.current, 'nexus');
    assert.throws(() => face.cambiarAvatar('clippy'), /desconocido.*vulpis, nexus/);
  });
});

test('lo escrito en el chat del avatar se recoge una sola vez', async () => {
  await withFace({}, async (face, cliente) => {
    cliente.enviar({ type: 'text-input', text: 'hola agente' });
    await tick();
    const mensajes = face.leerMensajes();
    assert.equal(mensajes.length, 1);
    assert.equal(mensajes[0]?.texto, 'hola agente');
    assert.ok((mensajes[0]?.ts ?? 0) > 0);
    assert.deepEqual(face.leerMensajes(), [], 'un mensaje entregado no reaparece');
  });
});

test('la UI conectada puede cambiar de avatar a traves de la fachada', async () => {
  await withFace({}, async (face, cliente) => {
    cliente.enviar({ type: 'config', settings: { agent: 'nexus' } });
    await tick();
    assert.equal(face.activo.id, 'nexus', 'la fachada tiene que atender el cambio, no ignorarlo');
    const ultimo = cliente.mensajes.at(-1);
    assert.equal(ultimo?.type === 'avatars' && ultimo.current, 'nexus');
  });
});

test('agente desconocido o ajustes de audio: config-error, no silencio', async () => {
  await withFace({}, async (face, cliente) => {
    cliente.enviar({ type: 'config', settings: { agent: 'clippy' } });
    await tick();
    assert.equal(face.activo.id, 'vulpis');
    assert.equal(cliente.mensajes.filter((m) => m.type === 'config-error').length, 1);
    cliente.enviar({ type: 'config', settings: { micEnabled: true } });
    await tick();
    // La UI esta autenticada y su send() devuelve true: sin esta respuesta se
    // quedaria creyendo aplicado un ajuste que nadie gestiona aqui.
    assert.equal(cliente.mensajes.filter((m) => m.type === 'config-error').length, 2);
    // Y el estado autoritativo revierte el boton optimista: aqui no hay micro.
    const ultimo = cliente.mensajes.at(-1);
    assert.equal(ultimo?.type === 'mic' && ultimo.enabled, false);
  });
});

test('editar un perfil desde la UI se rechaza y vuelve el estado autoritativo', async () => {
  await withFace({}, async (_face, cliente) => {
    cliente.enviar({ type: 'avatar-config', avatarId: 'vulpis', settings: { confidential: true } });
    await tick();
    const idx = cliente.mensajes.findIndex((m) => m.type === 'config-error');
    assert.ok(idx >= 0, 'la UI tiene que saber que NO se aplico');
    assert.ok(
      cliente.mensajes.slice(idx).some((m) => m.type === 'avatars'),
      'y recibir el estado real para deshacer su seleccion optimista',
    );
  });
});

test('sin perfiles que cargar, la cara sigue viva con un perfil minimo', async () => {
  await withFace({ profiles: [] }, async (face, cliente) => {
    assert.equal(face.activo.id, 'alpha');
    const avatars = cliente.mensajes.find((m) => m.type === 'avatars');
    assert.equal(avatars?.type === 'avatars' && avatars.list.length, 1);
  });
});
