import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpToolProvider } from './provider.js';
import { parseMcpServers, type McpServerConfig } from './types.js';

/**
 * El adaptador se prueba contra un servidor MCP DE VERDAD (el del SDK) unido
 * por un transporte en memoria: sin red, sin procesos, pero con el protocolo
 * completo de por medio — el mismo patron logica-sin-aparato del resto del
 * proyecto.
 */

function cfg(partial: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: 'fake',
    transport: 'stdio',
    command: 'irrelevante-el-transporte-va-inyectado',
    local: false,
    enabled: true,
    ...partial,
  };
}

/** Levanta un servidor de prueba y devuelve el provider conectado a el. */
async function withProvider(
  config: McpServerConfig,
  build: (server: McpServer) => void,
  fn: (provider: McpToolProvider) => Promise<void>,
): Promise<void> {
  const server = new McpServer({ name: 'servidor-fake', version: '1.0.0' });
  build(server);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const provider = await McpToolProvider.connect(config, { transport: clientTransport });
  try {
    await fn(provider);
  } finally {
    await provider.close();
    await server.close();
  }
}

const echoTool = (server: McpServer, calls?: string[]) => {
  server.registerTool(
    'echo',
    {
      description: 'Devuelve lo que recibe.',
      inputSchema: { texto: z.string() },
    },
    async ({ texto }) => {
      calls?.push(texto);
      return { content: [{ type: 'text', text: `eco: ${texto}` }] };
    },
  );
};

test('las tools llegan con nombre espaciado y esquema de objeto', async () => {
  await withProvider(cfg({ id: 'todo' }), echoTool, async (provider) => {
    const [tool] = provider.tools();
    assert.ok(tool);
    assert.equal(tool.name, 'mcp_todo__echo');
    assert.equal(tool.parameters.type, 'object');
    assert.ok('texto' in tool.parameters.properties, 'el esquema tiene que llegar al modelo');
    assert.equal(tool.local, false, 'hereda el contrato local del servidor');
  });
});

test('un id con caracteres raros se sanea (el formato OpenAI no admite puntos)', async () => {
  await withProvider(cfg({ id: 'raro.id!' }), echoTool, async (provider) => {
    assert.equal(provider.tools()[0]?.name, 'mcp_raro_id___echo');
  });
});

test('run() llama al servidor y aplana el contenido a texto', async () => {
  await withProvider(cfg(), echoTool, async (provider) => {
    const result = await provider.tools()[0]!.run({ texto: 'hola' }, { confidential: false });
    assert.equal(result, 'eco: hola');
  });
});

test('un isError del servidor vuelve como texto de error, no como excepcion', async () => {
  await withProvider(
    cfg(),
    (server) => {
      server.registerTool(
        'rompe',
        { description: 'Siempre falla.', inputSchema: {} },
        async () => ({
          content: [{ type: 'text', text: 'se rompio' }],
          isError: true,
        }),
      );
    },
    async (provider) => {
      const result = await provider.tools()[0]!.run({}, { confidential: false });
      assert.match(result, /^Error de la herramienta: se rompio/);
    },
  );
});

test('en confidencial, una tool no local se niega SIN llamar al servidor', async () => {
  const llamadas: string[] = [];
  await withProvider(
    cfg({ local: false }),
    (server) => echoTool(server, llamadas),
    async (provider) => {
      const result = await provider.tools()[0]!.run({ texto: 'secreto' }, { confidential: true });
      assert.match(result, /bloqueada/i);
      assert.deepEqual(llamadas, [], 'el dato confidencial no puede llegar al servidor');
    },
  );
});

test('una tool local si funciona en confidencial', async () => {
  await withProvider(cfg({ local: true }), echoTool, async (provider) => {
    const result = await provider.tools()[0]!.run({ texto: 'ok' }, { confidential: true });
    assert.equal(result, 'eco: ok');
    assert.equal(provider.tools()[0]!.local, true);
  });
});

test('la allowlist filtra lo que no interesa', async () => {
  await withProvider(
    cfg({ tools: ['echo'] }),
    (server) => {
      echoTool(server);
      server.registerTool('ruido', { description: 'No interesa.', inputSchema: {} }, async () => ({
        content: [{ type: 'text', text: 'x' }],
      }));
    },
    async (provider) => {
      assert.deepEqual(
        provider.tools().map((t) => t.name),
        ['mcp_fake__echo'],
      );
    },
  );
});

test('readOnlyHint decide destructive; sin pista, se asume que tiene efectos', async () => {
  await withProvider(
    cfg(),
    (server) => {
      server.registerTool(
        'lee',
        {
          description: 'Solo lee.',
          inputSchema: {},
          annotations: { readOnlyHint: true },
        },
        async () => ({ content: [{ type: 'text', text: 'x' }] }),
      );
      echoTool(server);
    },
    async (provider) => {
      const byName = new Map(provider.tools().map((t) => [t.name, t]));
      assert.equal(byName.get('mcp_fake__lee')?.destructive, false);
      assert.equal(byName.get('mcp_fake__echo')?.destructive, true);
    },
  );
});

/* ── parseMcpServers ─────────────────────────────────────────────────────── */

test('el mapa de la config se normaliza con defaults conservadores', () => {
  const { servers, warnings } = parseMcpServers({
    uno: { transport: 'stdio', command: 'npx', args: ['-y', 'x'] },
    dos: { transport: 'http', url: 'https://ejemplo.com/mcp', local: true, enabled: false },
  });
  assert.equal(warnings.length, 0);
  assert.equal(servers.length, 2);
  assert.equal(servers[0]?.local, false, 'local se DECLARA, no se presume');
  assert.equal(servers[0]?.enabled, true);
  assert.equal(servers[1]?.local, true);
  assert.equal(servers[1]?.enabled, false);
});

test('las entradas invalidas se avisan y se omiten, sin tumbar nada', () => {
  const { servers, warnings } = parseMcpServers({
    sinTransporte: { command: 'npx' },
    stdioSinCommand: { transport: 'stdio' },
    httpSinUrl: { transport: 'http' },
    valido: { transport: 'stdio', command: 'npx' },
  });
  assert.deepEqual(
    servers.map((s) => s.id),
    ['valido'],
  );
  assert.equal(warnings.length, 3);
});

test('un mcp.servers vacio o ausente no produce nada', () => {
  assert.deepEqual(parseMcpServers({}).servers, []);
  assert.deepEqual(parseMcpServers(undefined).servers, []);
  assert.deepEqual(parseMcpServers('basura').servers, []);
});
