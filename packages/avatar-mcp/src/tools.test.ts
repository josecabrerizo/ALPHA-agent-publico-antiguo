import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { AvatarGesture, AvatarWireState } from '@alpha/protocol';
import { registerFaceTools, type FaceLike } from './tools.js';

/**
 * El mapeo tool -> FaceController se prueba con el protocolo MCP completo de
 * por medio (servidor y cliente reales del SDK sobre un transporte en
 * memoria) y un doble del controlador que apunta lo que le piden.
 */

class StubFace implements FaceLike {
  llamadas: string[] = [];
  mensajes = [{ texto: 'hola desde el chat', ts: 1 }];
  readonly activo = { id: 'vulpis', name: 'Vulpis.AI' };
  async decir(texto: string, opts?: { gesto?: AvatarGesture }): Promise<void> {
    this.llamadas.push(`decir:${texto}:${opts?.gesto ?? '-'}`);
  }
  estado(state: AvatarWireState): void {
    this.llamadas.push(`estado:${state}`);
  }
  async saludar(texto?: string): Promise<void> {
    this.llamadas.push(`saludar:${texto ?? '-'}`);
  }
  cambiarAvatar(id: string): { id: string; name: string } {
    if (id !== 'nexus') throw new Error(`avatar desconocido: "${id}"`);
    this.llamadas.push(`cambiar:${id}`);
    return { id, name: 'Nexus' };
  }
  leerMensajes(): { texto: string; ts: number }[] {
    const out = this.mensajes;
    this.mensajes = [];
    return out;
  }
  avatares(): { id: string; name: string; role: string }[] {
    return [{ id: 'vulpis', name: 'Vulpis.AI', role: 'explorador' }];
  }
}

function textoDe(result: unknown): string {
  const content = (result as { content?: { type: string; text?: string }[] }).content ?? [];
  return content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n');
}

async function withClient(fn: (client: Client, stub: StubFace) => Promise<void>): Promise<void> {
  const server = new McpServer({ name: 'alpha-avatar-test', version: '1.0.0' });
  const stub = new StubFace();
  registerFaceTools(server, stub);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'agente-test', version: '1.0.0' });
  await client.connect(clientTransport);
  try {
    await fn(client, stub);
  } finally {
    await client.close();
    await server.close();
  }
}

test('la fachada expone las cinco tools de la cara', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), [
      'cambiar_avatar',
      'decir',
      'estado',
      'leer_mensajes',
      'saludar',
    ]);
  });
});

test('decir llega al controlador y confirma con el nombre del avatar', async () => {
  await withClient(async (client, stub) => {
    const result = await client.callTool({ name: 'decir', arguments: { texto: 'hola humano' } });
    assert.deepEqual(stub.llamadas, ['decir:hola humano:-']);
    assert.match(textoDe(result), /Vulpis\.AI/);
  });
});

test('decir con gesto lo propaga', async () => {
  await withClient(async (client, stub) => {
    await client.callTool({ name: 'decir', arguments: { texto: 'hola', gesto: 'saludo' } });
    assert.deepEqual(stub.llamadas, ['decir:hola:saludo']);
  });
});

test('un estado fuera del enum se rechaza antes de llegar al controlador', async () => {
  await withClient(async (client, stub) => {
    // El SDK convierte el fallo de validacion en un resultado isError (no en
    // una excepcion del cliente): el agente lo lee y corrige sus argumentos.
    const result = await client.callTool({ name: 'estado', arguments: { estado: 'bailando' } });
    assert.equal((result as { isError?: boolean }).isError, true);
    assert.deepEqual(stub.llamadas, [], 'la validacion es del esquema, no del controlador');
  });
});

test('leer_mensajes entrega lo escrito y luego dice que no hay nada', async () => {
  await withClient(async (client) => {
    const primera = await client.callTool({ name: 'leer_mensajes', arguments: {} });
    assert.match(textoDe(primera), /hola desde el chat/);
    const segunda = await client.callTool({ name: 'leer_mensajes', arguments: {} });
    assert.match(textoDe(segunda), /no hay mensajes nuevos/);
  });
});

test('cambiar_avatar anuncia los ids REALES del catalogo, no una lista escrita a mano', async () => {
  await withClient(async (client) => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === 'cambiar_avatar');
    // El stub solo tiene a vulpis: si apareciera otro id (o el yaml del
    // motor), la descripcion estaria prometiendo avatares que no existen.
    assert.match(tool?.description ?? '', /vulpis/);
    assert.doesNotMatch(tool?.description ?? '', /unit-a/, 'ids del catalogo vivo, no un ejemplo');
    assert.doesNotMatch(tool?.description ?? '', /avatars\.yaml/, 'la fachada no lee ese yaml');
  });
});

test('cambiar_avatar desconocido vuelve como isError con la pista, no como excepcion', async () => {
  await withClient(async (client) => {
    const result = await client.callTool({ name: 'cambiar_avatar', arguments: { avatarId: 'x' } });
    assert.equal((result as { isError?: boolean }).isError, true);
    assert.match(textoDe(result), /desconocido/);
  });
});
