/**
 * Configuracion de servidores MCP (Model Context Protocol): herramientas
 * externas para el cerebro. En la config viajan como un mapa clave = id
 * (mcp.servers en el YAML); aqui se normalizan y validan.
 */

export interface McpServerConfig {
  /** Identificador: da el prefijo de sus tools (mcp_<id>__<tool>). */
  id: string;
  transport: 'stdio' | 'http';
  /** stdio: ejecutable y argumentos. */
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  /** http: endpoint del servidor (Streamable HTTP). */
  url?: string;
  headers?: Record<string, string>;
  /**
   * Contrato de privacidad, como el `local` del registro de proveedores LLM:
   * true SOLO si el servidor no saca datos de la maquina. El default es false
   * a proposito (un proceso stdio local puede perfectamente llamar a internet:
   * que lo local se declare, no se presuma). En modo confidencial, las tools
   * de un servidor no local ni se ensenan al modelo ni se ejecutan.
   */
  local: boolean;
  /** false = declarado pero apagado. */
  enabled: boolean;
  /** Allowlist opcional: muchos esquemas grandes marean a los modelos chicos. */
  tools?: string[];
}

/**
 * Normaliza el mapa crudo de la config. Las entradas invalidas no tumban el
 * arranque: se devuelven como avisos para que el anfitrion los DIGA (el mismo
 * trato que las skills en cuarentena).
 */
export function parseMcpServers(raw: unknown): { servers: McpServerConfig[]; warnings: string[] } {
  const servers: McpServerConfig[] = [];
  const warnings: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { servers, warnings };

  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') {
      warnings.push(`servidor MCP "${id}": entrada invalida, se omite`);
      continue;
    }
    const v = value as Record<string, unknown>;
    const transport = v['transport'];
    if (transport !== 'stdio' && transport !== 'http') {
      warnings.push(`servidor MCP "${id}": transport debe ser stdio | http, se omite`);
      continue;
    }
    if (transport === 'stdio' && typeof v['command'] !== 'string') {
      warnings.push(`servidor MCP "${id}": un stdio necesita command, se omite`);
      continue;
    }
    if (transport === 'http' && typeof v['url'] !== 'string') {
      warnings.push(`servidor MCP "${id}": un http necesita url, se omite`);
      continue;
    }
    servers.push({
      id,
      transport,
      ...(typeof v['command'] === 'string' ? { command: v['command'] } : {}),
      ...(isStringArray(v['args']) ? { args: v['args'] } : {}),
      ...(isStringRecord(v['env']) ? { env: v['env'] } : {}),
      ...(typeof v['url'] === 'string' ? { url: v['url'] } : {}),
      ...(isStringRecord(v['headers']) ? { headers: v['headers'] } : {}),
      local: v['local'] === true,
      enabled: v['enabled'] !== false,
      ...(isStringArray(v['tools']) ? { tools: v['tools'] } : {}),
    });
  }
  return { servers, warnings };
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    !!v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v).every((x) => typeof x === 'string')
  );
}
