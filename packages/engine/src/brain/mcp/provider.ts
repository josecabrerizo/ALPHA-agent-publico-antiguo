import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { JsonSchema, Tool } from '../tools/types.js';
import { parseMcpServers, type McpServerConfig } from './types.js';

/**
 * Adaptador MCP -> contrato Tool del cerebro. Un servidor MCP expone sus
 * herramientas por tools/list y tools/call; aqui se traducen a la misma forma
 * que las builtin y las skills, asi que entran al ToolRegistry y al bucle
 * agentico SIN tocar el bucle (el punto de extension previsto).
 */

/** Un servidor muerto no puede colgar el arranque del motor. */
const CONNECT_TIMEOUT_MS = 5_000;

/** El formato de tools de OpenAI corta los nombres largos; mejor cortar aqui. */
const MAX_TOOL_NAME = 64;

/** Un esquema kilometrico marea a los modelos chicos y no cabe en su contexto. */
const MAX_DESCRIPTION = 1_000;

export class McpToolProvider {
  private constructor(
    private readonly client: Client,
    private readonly cfg: McpServerConfig,
    private readonly adapted: Tool[],
  ) {}

  /**
   * Conecta, lista las tools del servidor y las deja adaptadas. `transport`
   * inyectable para los tests (InMemoryTransport); en produccion sale de la
   * config (stdio o http).
   */
  static async connect(
    cfg: McpServerConfig,
    opts: { transport?: Transport } = {},
  ): Promise<McpToolProvider> {
    const client = new Client({ name: 'alpha-engine', version: '0.0.1' });
    const transport = opts.transport ?? makeTransport(cfg);
    await withTimeout(client.connect(transport), CONNECT_TIMEOUT_MS, `conectar con "${cfg.id}"`);
    const listed = await withTimeout(
      client.listTools(),
      CONNECT_TIMEOUT_MS,
      `listar tools de "${cfg.id}"`,
    );

    const tools: Tool[] = [];
    for (const t of listed.tools) {
      // Allowlist opcional: se declara en la config para no ensenar al modelo
      // veinte esquemas cuando solo interesan dos.
      if (cfg.tools && !cfg.tools.includes(t.name)) continue;
      tools.push(adaptTool(client, cfg, t.name, t.description, t.inputSchema, t.annotations));
    }
    return new McpToolProvider(client, cfg, tools);
  }

  get id(): string {
    return this.cfg.id;
  }

  tools(): Tool[] {
    return this.adapted;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Conecta todos los servidores declarados, en paralelo y tolerante: uno caido
 * se avisa y se omite (el mismo trato que una skill en cuarentena), nunca
 * tumba el arranque del motor.
 */
export async function connectMcpProviders(
  raw: unknown,
  log: (message: string) => void,
): Promise<McpToolProvider[]> {
  const { servers, warnings } = parseMcpServers(raw);
  for (const w of warnings) log(`✗ [mcp] ${w}`);

  const results = await Promise.all(
    servers
      .filter((s) => s.enabled)
      .map(async (s) => {
        try {
          const provider = await McpToolProvider.connect(s);
          log(
            `mcp "${s.id}": ${provider.tools().length} tools${s.local ? ' (local)' : ' (no local: bloqueado en confidencial)'}`,
          );
          return provider;
        } catch (err) {
          log(`✗ [mcp] "${s.id}" no disponible: ${(err as Error).message}`);
          return undefined;
        }
      }),
  );
  return results.filter((p): p is McpToolProvider => p !== undefined);
}

function makeTransport(cfg: McpServerConfig): Transport {
  if (cfg.transport === 'stdio') {
    return new StdioClientTransport({
      command: cfg.command!,
      args: cfg.args ?? [],
      ...(cfg.env ? { env: cfg.env } : {}),
    });
  }
  // Cast: con exactOptionalPropertyTypes, el sessionId opcional del transporte
  // HTTP del SDK no encaja letra a letra con la interfaz Transport del propio
  // SDK. Es un desajuste de sus tipos, no de este codigo.
  return new StreamableHTTPClientTransport(new URL(cfg.url!), {
    ...(cfg.headers ? { requestInit: { headers: cfg.headers } } : {}),
  }) as Transport;
}

function adaptTool(
  client: Client,
  cfg: McpServerConfig,
  name: string,
  description: string | undefined,
  inputSchema: unknown,
  annotations: { readOnlyHint?: boolean | undefined } | undefined,
): Tool {
  return {
    name: namespacedName(cfg.id, name),
    description: (description ?? `Herramienta "${name}" del servidor MCP "${cfg.id}".`).slice(
      0,
      MAX_DESCRIPTION,
    ),
    parameters: adaptSchema(inputSchema),
    // Sin readOnlyHint explicito se asume que tiene efectos: es una PISTA del
    // servidor, y ante la duda mejor tratarla como destructiva.
    destructive: annotations?.readOnlyHint !== true,
    local: cfg.local,
    async run(args, ctx) {
      // Segunda capa del contrato confidencial (la primera: el cerebro ni
      // ensena estas tools al modelo). Hace falta porque el ToolRegistry
      // sobrevive al cambio de avatar en caliente: al pasar a un perfil
      // confidencial, las tools remotas siguen registradas y un modelo que
      // las alucine no puede colarse.
      if (ctx.confidential && !cfg.local) {
        return 'Herramienta bloqueada: el modo confidencial no permite herramientas que saquen datos de la maquina.';
      }
      const result = await client.callTool({ name, arguments: args });
      const text = flattenContent(result.content);
      return result.isError ? `Error de la herramienta: ${text}` : text;
    },
  };
}

/**
 * mcp_<servidor>__<tool>, saneado a [a-zA-Z0-9_-] y recortado: es lo que
 * acepta el formato de tools de OpenAI, y el prefijo evita choques con las
 * builtin y entre servidores.
 */
function namespacedName(serverId: string, toolName: string): string {
  const clean = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `mcp_${clean(serverId)}__${clean(toolName)}`.slice(0, MAX_TOOL_NAME);
}

/**
 * El inputSchema de MCP ya es JSON Schema de un objeto; se estrecha a la forma
 * que espera el formato OpenAI. Uno raro (sin type object) se envuelve vacio:
 * mejor una tool sin parametros que un arranque caido.
 */
function adaptSchema(inputSchema: unknown): JsonSchema {
  if (inputSchema && typeof inputSchema === 'object') {
    const s = inputSchema as Record<string, unknown>;
    if (s['type'] === 'object') {
      return {
        type: 'object',
        properties: (s['properties'] as Record<string, unknown>) ?? {},
        ...(Array.isArray(s['required']) ? { required: s['required'] as string[] } : {}),
      };
    }
  }
  return { type: 'object', properties: {} };
}

/**
 * Aplana el content de MCP a texto, que es lo unico que el bucle agentico
 * devuelve al modelo. Lo no textual se nombra en vez de perderse en silencio.
 */
function flattenContent(content: unknown): string {
  if (!Array.isArray(content)) return '(sin resultado)';
  const parts: string[] = [];
  for (const item of content) {
    const c = item as Record<string, unknown>;
    if (c['type'] === 'text' && typeof c['text'] === 'string') parts.push(c['text']);
    else if (c['type'] === 'image') parts.push('[imagen]');
    else if (c['type'] === 'audio') parts.push('[audio]');
    else if (c['type'] === 'resource' || c['type'] === 'resource_link') {
      const uri =
        (c['uri'] as string | undefined) ??
        ((c['resource'] as Record<string, unknown> | undefined)?.['uri'] as string | undefined);
      parts.push(uri ? `[recurso: ${uri}]` : '[recurso]');
    }
  }
  return parts.join('\n').trim() || '(sin resultado)';
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} tardo mas de ${ms / 1000}s`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
