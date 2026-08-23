import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { connectMcpProviders, McpToolProvider } from './provider.js';
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

test('tools/list paginado: se siguen los nextCursor hasta agotar', async () => {
  // Servidor de bajo nivel: el McpServer de alto nivel no pagina, y lo que se
  // prueba es justo que la segunda pagina no se pierda en silencio.
  const toolDef = (name: string) => ({
    name,
    description: 'x',
    inputSchema: { type: 'object' as const },
  });
  const server = new Server(
    { name: 'paginado', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, (req) => {
    if (!req.params?.cursor) return { tools: [toolDef('uno')], nextCursor: 'pagina-2' };
    return { tools: [toolDef('dos')] };
  });
  server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: 'text', text: 'x' }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const provider = await McpToolProvider.connect(cfg(), { transport: clientTransport });
  try {
    assert.deepEqual(
      provider
        .tools()
        .map((t) => t.name)
        .sort(),
      ['mcp_fake__dos', 'mcp_fake__uno'],
      'las tools de la segunda pagina no pueden desaparecer del registro',
    );
  } finally {
    await provider.close();
    await server.close();
  }
});

test('un esquema con $defs y $ref viaja entero, no reconstruido', async () => {
  // Servidor de bajo nivel para controlar el JSON Schema crudo: el registro
  // de alto nivel lo generaria desde zod y no tendria $defs.
  const schema = {
    type: 'object' as const,
    properties: { destino: { $ref: '#/$defs/ruta' } },
    required: ['destino'],
    $defs: { ruta: { type: 'string', description: 'una ruta' } },
  };
  const server = new Server(
    { name: 'con-defs', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'mueve', description: 'x', inputSchema: schema }],
  }));
  server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [{ type: 'text', text: 'x' }],
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const provider = await McpToolProvider.connect(cfg(), { transport: clientTransport });
  try {
    const params = provider.tools()[0]!.parameters;
    assert.deepEqual(params['$defs'], schema.$defs, 'sin los $defs, el $ref queda colgando');
    assert.deepEqual(params.properties, schema.properties);
    assert.deepEqual(params.required, ['destino']);
  } finally {
    await provider.close();
    await server.close();
  }
});

test('un recurso embebido con texto entrega su texto, no solo la uri', async () => {
  await withProvider(
    cfg(),
    (server) => {
      server.registerTool(
        'lee_fichero',
        { description: 'Devuelve el contenido como recurso embebido.', inputSchema: {} },
        async () => ({
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'file:///notas.txt',
                mimeType: 'text/plain',
                text: 'contenido real',
              },
            },
          ],
        }),
      );
    },
    async (provider) => {
      const result = await provider.tools()[0]!.run({}, { confidential: false });
      assert.equal(result, 'contenido real', 'la uri sola dejaria al modelo sin el resultado');
    },
  );
});

test('un resultado estructurado sin texto llega serializado, no "(sin resultado)"', async () => {
  // Servidor de bajo nivel: el de alto nivel duplica el structuredContent
  // como texto, y lo que se prueba es justo el caso en que NO viene texto.
  const server = new Server(
    { name: 'estructurado', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'mide', description: 'x', inputSchema: { type: 'object' as const } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, () => ({
    content: [],
    structuredContent: { total: 42, unidad: 'ms' },
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const provider = await McpToolProvider.connect(cfg(), { transport: clientTransport });
  try {
    const result = await provider.tools()[0]!.run({}, { confidential: false });
    assert.equal(
      result,
      JSON.stringify({ total: 42, unidad: 'ms' }),
      'el JSON devuelto es el resultado; perderlo deja al modelo a ciegas',
    );
  } finally {
    await provider.close();
    await server.close();
  }
});

test('con solo un marcador ([imagen]) el structuredContent acompana, no se suprime', async () => {
  const server = new Server({ name: 'grafico', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{ name: 'grafica', description: 'x', inputSchema: { type: 'object' as const } }],
  }));
  server.setRequestHandler(CallToolRequestSchema, () => ({
    // El texto de puros espacios NO cuenta como texto real: sin el trim por
    // fragmento, este content volvia a suprimir el structuredContent.
    content: [
      { type: 'text', text: '   ' },
      { type: 'image', data: 'aWJt', mimeType: 'image/png' },
    ],
    structuredContent: { total: 7 },
  }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const provider = await McpToolProvider.connect(cfg(), { transport: clientTransport });
  try {
    const result = await provider.tools()[0]!.run({}, { confidential: false });
    assert.equal(
      result,
      `[imagen]\n${JSON.stringify({ total: 7 })}`,
      'el marcador no es texto real: el JSON estructurado tiene que viajar igual',
    );
  } finally {
    await provider.close();
    await server.close();
  }
});

test('si el arranque falla o expira, el transporte se cierra (sin hijos huerfanos)', async () => {
  // Solo la punta cliente del par: nadie contesta al otro lado y el connect
  // expira. Lo observable es el close del transporte, que es lo que mata al
  // proceso hijo cuando el transporte es stdio de verdad.
  const [clientTransport] = InMemoryTransport.createLinkedPair();
  let cerrado = false;
  const originalClose = clientTransport.close.bind(clientTransport);
  clientTransport.close = async () => {
    cerrado = true;
    await originalClose();
  };
  await assert.rejects(
    () => McpToolProvider.connect(cfg(), { transport: clientTransport, timeoutMs: 100 }),
    /tardo mas de/,
  );
  assert.equal(cerrado, true, 'un arranque fallido no puede dejar el transporte vivo');
});

test('en confidencial, un servidor NO local ni se conecta', async () => {
  const logs: string[] = [];
  const providers = await connectMcpProviders(
    { remoto: { transport: 'stdio', command: 'binario-que-no-existe' } },
    (m) => logs.push(m),
    { confidential: true },
  );
  assert.deepEqual(providers, []);
  assert.ok(
    logs.some((l) => l.includes('omitido')),
    `debe omitirse sin intentar conectar; logs: ${logs.join(' | ')}`,
  );
  assert.ok(
    !logs.some((l) => l.includes('no disponible')),
    'si hubiera intentado conectar, el spawn habria fallado en vez de omitirse',
  );
});

test('un servidor local si se intenta conectar en confidencial', async () => {
  // No se puede inyectar transporte por connectMcpProviders; basta demostrar
  // que el filtro NO lo bloquea: el intento real falla por binario inexistente
  // y se loguea como "no disponible", no como "omitido".
  const logs: string[] = [];
  const providers = await connectMcpProviders(
    { cercano: { transport: 'stdio', command: 'binario-que-no-existe', local: true } },
    (m) => logs.push(m),
    { confidential: true },
  );
  assert.deepEqual(providers, []);
  assert.ok(logs.some((l) => l.includes('no disponible')));
  assert.ok(!logs.some((l) => l.includes('omitido')));
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
