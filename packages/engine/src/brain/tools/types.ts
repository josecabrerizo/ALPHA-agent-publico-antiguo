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
  /** Ejecuta la herramienta. `args` ya viene parseado y validado por forma. */
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<string>;
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
