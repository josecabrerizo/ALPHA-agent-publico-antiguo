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
  type AvatarOption,
  type EngineToAvatarMessage,
} from '@alpha/protocol';
import type { Speaker } from './speaker.js';
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

function perfil(id: string, name: string): AvatarOption {
  return {
    id,
    name,
    role: 'rol',
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
  delayMs = 0;
  stops = 0;
  async speak(text: string): Promise<void> {
    if (this.fail) throw new Error('sin voz');
    if (this.delayMs > 0) await new Promise((r) => setTimeout(r, this.delayMs));
    this.spoken.push(text);
  }
  stop(): void {
    this.stops++;
  }
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
  opts: {
    profiles?: AvatarOption[];
    activeId?: string;
    speaker?: Speaker;
    speakerFor?: (p: AvatarOption) => Speaker | undefined;
  },
  fn: (face: FaceController, cliente: FakeClient) => Promise<void>,
): Promise<void> {
  const bridge = new AvatarBridge(TEST_PORT);
  await bridge.start();
  const face = new FaceController(
    bridge,
    opts.profiles ?? [perfil('vulpis', 'Vulpis.AI'), perfil('nexus', 'Nexus')],
    opts.activeId,
    opts.speakerFor ?? (opts.speaker ? () => opts.speaker : undefined),
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
    assert.deepEqual(tipos(cliente), [
      'ready',
      'mic',
      'state',
      'avatars',
      'devices',
      'voices',
      'models',
    ]);
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
    const despues = tipos(cliente).slice(7); // tras la presentacion
    assert.deepEqual(despues, ['state', 'assistant', 'state']);
    const estados = cliente.mensajes.filter((m) => m.type === 'state');
    assert.deepEqual(
      estados.map((m) => (m.type === 'state' ? m.state : '')),
      // El primer reposo es la pose actual del saludo de presentacion.
      ['reposo', 'hablando', 'reposo'],
    );
    assert.deepEqual(speaker.spoken, ['hola humano'], 'la voz dice exactamente el texto');
  });
});

test('un cliente que llega tarde recibe la pose ACTUAL, no la de defecto', async () => {
  await withFace({}, async (face, primero) => {
    face.estado('pensando');
    await tick();
    // Un segundo cliente (o el primero reconectando): las difusiones previas
    // a su conexion no existen para el — el saludo debe traer la pose viva.
    const segundo = await conectarCliente();
    const st = segundo.mensajes.find((m) => m.type === 'state');
    assert.equal(st?.type === 'state' && st.state, 'pensando');
    assert.ok(primero.mensajes.length > 0);
    segundo.cerrar();
  });
});

test('decir con gesto intercala el gesto tras el texto', async () => {
  await withFace({}, async (face, cliente) => {
    await face.decir('hola', { gesto: 'saludo' });
    await tick();
    assert.deepEqual(tipos(cliente).slice(7), ['state', 'assistant', 'gesture', 'state']);
  });
});

test('dos decir concurrentes no se solapan: la cola serializa el habla', async () => {
  const speaker = new FakeSpeaker();
  speaker.delayMs = 60;
  await withFace({ speaker }, async (face, cliente) => {
    await Promise.all([face.decir('primero'), face.decir('segundo')]);
    await tick();
    assert.deepEqual(speaker.spoken, ['primero', 'segundo'], 'en orden, no a la vez');
    assert.deepEqual(
      tipos(cliente).slice(7),
      ['state', 'assistant', 'state', 'state', 'assistant', 'state'],
      'la coreografia ENTERA de uno antes de empezar la del otro',
    );
    const estados = cliente.mensajes
      .filter((m) => m.type === 'state')
      .map((m) => (m.type === 'state' ? m.state : ''));
    assert.deepEqual(
      estados,
      // El primer reposo es el del saludo de presentacion.
      ['reposo', 'hablando', 'reposo', 'hablando', 'reposo'],
      'sin cola, el primero en terminar mandaba reposo con el otro aun hablando',
    );
  });
});

test('cambiar de avatar recrea la voz: la del PERFIL nuevo, no la del viejo', async () => {
  const porPerfil = new Map<string, FakeSpeaker>([
    ['vulpis', new FakeSpeaker()],
    ['nexus', new FakeSpeaker()],
  ]);
  await withFace({ speakerFor: (p) => porPerfil.get(p.id) }, async (face) => {
    await face.decir('uno');
    face.cambiarAvatar('nexus');
    await face.decir('dos');
    assert.deepEqual(porPerfil.get('vulpis')!.spoken, ['uno']);
    assert.deepEqual(
      porPerfil.get('nexus')!.spoken,
      ['dos'],
      'Nexus no puede hablar con la voz (ni el ritmo) de Unit-A',
    );
  });
});

test('detener() alcanza la voz EN VUELO aunque este sustituida, y la suelta al asentarse', async () => {
  const vulpis = new FakeSpeaker();
  vulpis.delayMs = 120;
  const nexus = new FakeSpeaker();
  const porPerfil = new Map<string, FakeSpeaker>([
    ['vulpis', vulpis],
    ['nexus', nexus],
  ]);
  await withFace({ speakerFor: (p) => porPerfil.get(p.id) }, async (face) => {
    const enVuelo = face.decir('frase larga'); // sin esperar: sigue sonando
    // Dejar ARRANCAR la frase (la voz se captura al empezar a sonar); si el
    // cambio llegara antes, lo encolado saldria ya con la voz nueva, que es
    // el comportamiento diseñado para lo aun-no-empezado.
    await new Promise((r) => setImmediate(r));
    face.cambiarAvatar('nexus'); // sustituye la voz en pleno decir
    face.detener();
    assert.equal(vulpis.stops, 1, 'la voz en vuelo se corta aunque ya no sea la vigente');
    assert.equal(nexus.stops, 1);
    await enVuelo;
    // Asentada el habla, la sustituida queda LIBERADA (nada de listas que
    // crecen sin limite): otro apagado ya no la toca.
    face.detener();
    assert.equal(vulpis.stops, 1, 'una voz asentada y sustituida no se retiene');
    assert.equal(nexus.stops, 2);
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
    assert.deepEqual(tipos(cliente).slice(7), ['gesture']);
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
    const errores = cliente.mensajes.filter((m) => m.type === 'config-error');
    assert.equal(errores.length, 2);
    // Y con el eco del campo rechazado: es lo que saca el parche de la cola
    // persistida de la UI en vez de dejarlo reintentandose por siempre.
    const delMicro = errores[1];
    assert.equal(delMicro?.type === 'config-error' && delMicro.settings?.micEnabled, true);
    // Y el estado autoritativo revierte el boton optimista: aqui no hay micro.
    const ultimo = cliente.mensajes.at(-1);
    assert.equal(ultimo?.type === 'mic' && ultimo.enabled, false);
  });
});

test('editar un perfil desde la UI se rechaza y vuelve el estado autoritativo', async () => {
  await withFace({}, async (_face, cliente) => {
    cliente.enviar({
      type: 'avatar-config',
      avatarId: 'vulpis',
      requestId: 'p-77',
      settings: { confidential: true },
    });
    await tick();
    const idx = cliente.mensajes.findIndex((m) => m.type === 'config-error');
    assert.ok(idx >= 0, 'la UI tiene que saber que NO se aplico');
    const rechazo = cliente.mensajes[idx];
    // Con la correlacion completa: sin ella, la UI reenviaria la peticion en
    // cada reconexion y un motor real posterior podria aplicarla inesperada.
    assert.equal(rechazo?.type === 'config-error' && rechazo.avatarId, 'vulpis');
    assert.equal(rechazo?.type === 'config-error' && rechazo.requestId, 'p-77');
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
