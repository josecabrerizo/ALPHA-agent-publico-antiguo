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
      return await tool.run(args, ctx);
    } catch (error) {
      return `Error al ejecutar "${name}": ${(error as Error).message}`;
    }
  }
}
