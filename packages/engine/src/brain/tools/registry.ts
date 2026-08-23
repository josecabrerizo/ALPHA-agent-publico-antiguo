import type { Tool, ToolContext } from './types.js';

/**
 * Registro de herramientas: colecciona las disponibles y despacha las llamadas
 * del modelo. Es el punto de extension del sistema agentico — anadir una
 * capacidad es registrar una Tool, sin tocar el bucle.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    this.tools.set(tool.name, tool);
    return this;
  }

  registerAll(tools: Tool[]): this {
    for (const tool of tools) this.register(tool);
    return this;
  }

  /** Quita una herramienta (p. ej. al cerrar su servidor MCP en caliente). */
  unregister(name: string): void {
    this.tools.delete(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  /**
   * Ejecuta una llamada del modelo. Nunca lanza: un fallo se devuelve como
   * texto para que el modelo lo lea y reaccione, en vez de tumbar el turno.
   */
  async dispatch(name: string, rawArgs: string, ctx: ToolContext): Promise<string> {
    const tool = this.tools.get(name);
    if (!tool) return `Error: la herramienta "${name}" no existe.`;

    let args: Record<string, unknown>;
    try {
      args = rawArgs.trim() ? (JSON.parse(rawArgs) as Record<string, unknown>) : {};
    } catch {
      return `Error: los argumentos de "${name}" no son JSON valido: ${rawArgs}`;
    }

    try {
      return await withTimeout(tool.run(args, ctx), TOOL_TIMEOUT_MS, name);
    } catch (error) {
      return `Error al ejecutar "${name}": ${(error as Error).message}`;
    }
  }
}

/** Limite para una herramienta: si su run() se cuelga, no bloquea el turno. */
const TOOL_TIMEOUT_MS = 30_000;

/** Texto legible de algo lanzado que no es un Error, sin "[object Object]". */
function describeUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return 'error desconocido';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, name: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`la herramienta "${name}" tardo mas de ${ms / 1000}s`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        // Una herramienta puede rechazar con lo que sea (un string, un objeto);
        // quien lo recoge espera un Error y leeria .message como undefined.
        reject(error instanceof Error ? error : new Error(describeUnknown(error)));
      },
    );
  });
}
