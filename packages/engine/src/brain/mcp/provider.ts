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
    opts: { transport?: Transport; timeoutMs?: number } = {},
  ): Promise<McpToolProvider> {
    const client = new Client({ name: 'alpha-engine', version: '0.0.1' });
    const timeoutMs = opts.timeoutMs ?? CONNECT_TIMEOUT_MS;
    try {
      const transport = opts.transport ?? makeTransport(cfg);
      await withTimeout(client.connect(transport), timeoutMs, `conectar con "${cfg.id}"`);

      // tools/list puede venir paginado: sin seguir nextCursor, todo lo que no
      // cupiera en la primera pagina desapareceria del registro en silencio.
      const discovered: Awaited<ReturnType<Client['listTools']>>['tools'] = [];
      let cursor: string | undefined;
      do {
        const page = await withTimeout(
          client.listTools(cursor ? { cursor } : {}),
          timeoutMs,
          `listar tools de "${cfg.id}"`,
        );
        discovered.push(...page.tools);
        cursor = page.nextCursor;
      } while (cursor);

      const tools: Tool[] = [];
      for (const t of discovered) {
        // Allowlist opcional: se declara en la config para no ensenar al modelo
        // veinte esquemas cuando solo interesan dos.
        if (cfg.tools && !cfg.tools.includes(t.name)) continue;
        tools.push(adaptTool(client, cfg, t.name, t.description, t.inputSchema, t.annotations));
      }
      return new McpToolProvider(client, cfg, tools);
    } catch (err) {
      // El timeout no cancela la operacion de debajo: sin este close, un stdio
      // a medio arrancar dejaba a su proceso hijo vivo para siempre, porque
      // connectMcpProviders omite el provider y stop() nunca llega a conocerlo.
      await client.close().catch(() => {});
      throw err;
    }
  }

  get id(): string {
    return this.cfg.id;
  }

  /** El contrato de privacidad del servidor, para poder reconciliar en caliente. */
  get local(): boolean {
    return this.cfg.local;
  }

  tools(): Tool[] {
    return this.adapted;
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}

/**
 * Conecta UN servidor, tolerante: un fallo se dice y devuelve undefined (el
 * mismo trato que una skill en cuarentena). Lo usa el arranque y tambien la
 * reconciliacion en caliente al salir del modo confidencial.
 */
export async function connectMcpServer(
  s: McpServerConfig,
  log: (message: string) => void,
): Promise<McpToolProvider | undefined> {
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
}

/**
 * Conecta todos los servidores declarados, en paralelo y tolerante: uno caido
 * se avisa y se omite, nunca tumba el arranque del motor.
 */
export async function connectMcpProviders(
  raw: unknown,
  log: (message: string) => void,
  opts: { confidential?: boolean } = {},
): Promise<McpToolProvider[]> {
  const { servers, warnings } = parseMcpServers(raw);
  for (const w of warnings) log(`✗ [mcp] ${w}`);

  const results = await Promise.all(
    servers
      .filter((s) => s.enabled)
      .map(async (s) => {
        // En confidencial, un servidor no local NI SE CONECTA: el propio
        // handshake ya manda cabeceras (http) o arranca un proceso que puede
        // salir a la red (stdio). Filtrar solo las tools no bastaba. Al salir
        // del modo confidencial, la reconciliacion en caliente lo conecta.
        if (opts.confidential && !s.local) {
          log(
            `mcp "${s.id}" omitido: modo confidencial y el servidor no es local; ` +
              `se conectara si sales del modo confidencial`,
          );
          return undefined;
        }
        return connectMcpServer(s, log);
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
      // Un resultado ESTRUCTURADO tambien es resultado. Cuando el content no
      // trae TEXTO real (vacio, o solo marcadores tipo [imagen]), el JSON
      // serializado acompana a los marcadores: sin esto, un "[imagen]" a
      // secas suprimia el structuredContent y dejaba al modelo a ciegas.
      const { texto, conTexto } = flattenContent(result.content);
      const structured = (result as { structuredContent?: unknown }).structuredContent;
      const text = conTexto
        ? texto
        : [texto, structured !== undefined ? JSON.stringify(structured) : '']
            .filter(Boolean)
            .join('\n') || '(sin resultado)';
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
 * El inputSchema de MCP ya es JSON Schema de un objeto y viaja ENTERO:
 * reconstruirlo a mano descartaba los $defs/definitions y dejaba colgando
 * cualquier $ref de properties, y un esquema invalido puede tumbar la
 * peticion completa al proveedor. Uno raro (sin type object) se envuelve
 * vacio: mejor una tool sin parametros que un arranque caido.
 */
function adaptSchema(inputSchema: unknown): JsonSchema {
  if (inputSchema && typeof inputSchema === 'object') {
    const s = inputSchema as Record<string, unknown>;
    if (s['type'] === 'object') {
      return {
        ...s,
        type: 'object',
        properties: (s['properties'] as Record<string, unknown>) ?? {},
      };
    }
  }
  return { type: 'object', properties: {} };
}

/**
 * Aplana el content de MCP a texto, que es lo unico que el bucle agentico
 * devuelve al modelo. Lo no textual se nombra en vez de perderse en silencio,
 * y `conTexto` distingue el texto REAL de los meros marcadores: quien llama
 * decide el fallback ("(sin resultado)" o el structuredContent serializado)
 * viendo el resultado completo.
 */
function flattenContent(content: unknown): { texto: string; conTexto: boolean } {
  if (!Array.isArray(content)) return { texto: '', conTexto: false };
  const parts: string[] = [];
  let conTexto = false;
  for (const item of content) {
    const c = item as Record<string, unknown>;
    if (c['type'] === 'text' && typeof c['text'] === 'string') {
      parts.push(c['text']);
      conTexto = true;
    } else if (c['type'] === 'image') parts.push('[imagen]');
    else if (c['type'] === 'audio') parts.push('[audio]');
    else if (c['type'] === 'resource' || c['type'] === 'resource_link') {
      // Un recurso embebido con texto ES el resultado (asi devuelven su
      // contenido las tools de leer ficheros/documentos): se entrega el
      // texto. La marca con la uri queda solo para lo no textual.
      const resource = c['resource'] as Record<string, unknown> | undefined;
      const text = resource?.['text'];
      if (typeof text === 'string' && text) {
        parts.push(text);
        conTexto = true;
      } else {
        const uri = (c['uri'] as string | undefined) ?? (resource?.['uri'] as string | undefined);
        parts.push(uri ? `[recurso: ${uri}]` : '[recurso]');
      }
    }
  }
  const texto = parts.join('\n').trim();
  return { texto, conTexto: conTexto && texto.length > 0 };
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
