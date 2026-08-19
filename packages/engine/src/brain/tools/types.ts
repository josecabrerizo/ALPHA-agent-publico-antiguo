/**
 * Herramientas que el cerebro puede invocar (tool-calling), al estilo
 * Hermes/OpenClaw. Cada herramienta declara su firma en JSON Schema —lo que ve
 * el modelo— y una funcion que la ejecuta de verdad.
 */

/** Esquema JSON de los parametros, tal como lo espera la API de OpenAI. */
export interface JsonSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolContext {
  /** Si la sesion es confidencial: las herramientas que salen a la red deben abstenerse. */
  confidential: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  /**
   * true si la herramienta hace algo con efectos (abrir apps, escribir,
   * controlar el equipo). El bucle puede exigir confirmacion para estas.
   * Las de solo lectura (hora, leer pantalla) van a false.
   */
  destructive?: boolean;
  /**
   * false si la herramienta manda datos FUERA de la maquina (un servidor MCP
   * remoto). undefined = local: las builtin y las skills no salen a la red.
   * En modo confidencial, las no locales ni se ensenan al modelo.
   */
  local?: boolean;
  /**
   * Ejecuta la herramienta. `args` viene del JSON que produce el MODELO: esta
   * parseado, pero sus valores pueden ser cualquier cosa aunque el esquema pida
   * un string. Para leer texto, `textArg`.
   */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
}

/**
 * Lee un argumento de texto. Sin esto, `String(args['nombre'])` convertia un
 * objeto en "[object Object]" y seguia adelante como si fuera un nombre valido:
 * el modelo alucina formas, no solo contenidos.
 */
export function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** Forma OpenAI de una herramienta, para mandarsela al modelo. */
export interface OpenAITool {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

export function toOpenAITool(tool: Tool): OpenAITool {
  return {
    type: 'function',
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
