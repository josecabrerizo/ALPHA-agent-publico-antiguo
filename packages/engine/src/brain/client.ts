import OpenAI from 'openai';
import { DEFAULT_BRAIN_CONFIG } from './config.js';
import { resolveModel } from './registry.js';
import type { BrainConfig } from './types.js';
import type { ToolRegistry } from './tools/registry.js';
import { toOpenAITool } from './tools/types.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface BrainOptions {
  config?: Partial<BrainConfig>;
  /** Referencia proveedor/modelo; si no, la de la config. */
  model?: string;
  /**
   * Esfuerzo de razonamiento (parametro estandar de OpenAI). Con modelos
   * "thinking" como gemma4:12b, 'none' evita que gasten segundos y tokens
   * razonando antes de responder — clave para un asistente de VOZ. El razonar
   * ademas va a un campo aparte que no queremos ni leer ni hablar.
   */
  reasoningEffort?: 'none' | 'low' | 'medium' | 'high';
  maxTokens?: number;
  temperature?: number;
  /** Herramientas disponibles para el bucle agentico. Si no, no hay tool-calling. */
  tools?: ToolRegistry;
  /**
   * Seccion de skills para el prompt del sistema (nombres y descripciones). Es
   * una funcion porque la lista cambia si el agente crea skills nuevas.
   */
  skillsPrompt?: () => string;
}

/** Eventos del bucle agentico, para trazar el uso de herramientas y la voz. */
export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool-start'; name: string; args: string }
  | { type: 'tool-end'; name: string; result: string };

/** Tope de vueltas herramienta->modelo, para que un bucle no se descontrole. */
const MAX_TOOL_STEPS = 6;

/**
 * Cerebro de A.L.P.H.A.: un cliente compatible con OpenAI que sirve para
 * Ollama (local), OpenAI, Anthropic y Gemini sin cambiar de codigo — solo
 * cambia el proveedor resuelto del registro. Este es el patron Hermes/OpenClaw.
 */
export class Brain {
  private readonly config: BrainConfig;
  private readonly modelRef: string;
  private readonly reasoningEffort: 'none' | 'low' | 'medium' | 'high';
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly tools: ToolRegistry | undefined;
  private readonly skillsPrompt: (() => string) | undefined;

  constructor(options: BrainOptions = {}) {
    this.config = { ...DEFAULT_BRAIN_CONFIG, ...options.config };
    this.modelRef = options.model ?? this.config.model;
    this.reasoningEffort = options.reasoningEffort ?? 'none';
    this.maxTokens = options.maxTokens ?? 512;
    this.temperature = options.temperature ?? 0.6;
    this.tools = options.tools;
    this.skillsPrompt = options.skillsPrompt;
  }

  /** Proveedor y modelo que se usaran, ya resueltos (para mostrarlos). */
  describe(): { provider: string; model: string; local: boolean } {
    const r = resolveModel(this.modelRef, this.config);
    return { provider: r.provider, model: r.model, local: r.local };
  }

  private clientFor(): { client: OpenAI; model: string } {
    const r = resolveModel(this.modelRef, this.config);
    const client = new OpenAI({ baseURL: r.baseUrl, apiKey: r.apiKey });
    return { client, model: r.model };
  }

  private buildMessages(history: ChatMessage[]): ChatMessage[] {
    // El prompt de sistema se antepone salvo que el historial ya traiga uno.
    if (history[0]?.role === 'system') return history;
    return [{ role: 'system', content: this.config.systemPrompt }, ...history];
  }

  /** Respuesta completa (no streaming). Devuelve solo el texto a decir. */
  async reply(history: ChatMessage[]): Promise<string> {
    const { client, model } = this.clientFor();
    const res = await client.chat.completions.create({
      model,
      messages: this.buildMessages(history),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      reasoning_effort: this.reasoningEffort,
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  }

  /**
   * Respuesta en streaming: emite el texto por fragmentos segun llega, para
   * que el avatar empiece a "hablar" sin esperar a la frase entera.
   */
  async *replyStream(history: ChatMessage[]): AsyncGenerator<string> {
    const { client, model } = this.clientFor();
    const stream = await client.chat.completions.create({
      model,
      messages: this.buildMessages(history),
      max_tokens: this.maxTokens,
      temperature: this.temperature,
      reasoning_effort: this.reasoningEffort,
      stream: true,
    });
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }

  /** ¿Hay herramientas registradas? */
  get hasTools(): boolean {
    return (this.tools?.list().length ?? 0) > 0;
  }

  /**
   * Bucle agentico: el modelo puede pedir herramientas, que se ejecutan y cuyos
   * resultados vuelven al modelo, hasta que produce una respuesta final. Emite
   * el texto en streaming (para la voz) y eventos de cada herramienta usada.
   *
   * La respuesta se transmite conforme llega; si el modelo decide llamar a una
   * herramienta, esos deltas no son texto sino tool_calls que se acumulan por
   * indice, se ejecutan, y se da otra vuelta.
   */
  async *runAgentic(
    history: ChatMessage[],
    opts: { signal?: AbortSignal; timeoutMs?: number } = {},
  ): AsyncGenerator<AgentEvent> {
    const { client, model } = this.clientFor();
    const reqOptions = {
      ...(opts.signal ? { signal: opts.signal } : {}),
      timeout: opts.timeoutMs ?? 120_000,
    };
    // Primera capa del contrato confidencial: las herramientas que sacan datos
    // de la maquina (local === false, p. ej. un servidor MCP remoto) ni se
    // ensenan al modelo. La segunda capa vive en el run() del adaptador,
    // porque el registro sobrevive al cambio de avatar en caliente.
    const tools = this.tools
      ?.list()
      .filter((t) => !this.config.confidential || t.local !== false)
      .map(toOpenAITool);
    // messages lleva el intercambio completo del turno (incluye tool_calls y
    // resultados), que la API tipa de forma farragosa; se maneja como arreglo
    // laxo y se castea en la llamada.
    const messages: unknown[] = this.buildMessages(history);
    // Empujon para que use las herramientas en vez de adivinar: gemma4:12b, si
    // no, a veces se inventa datos reales (nucleos, hora) que deberia consultar.
    if (tools && tools.length > 0) {
      const first = messages[0] as ChatMessage;
      if (first?.role === 'system') {
        first.content +=
          '\n\nTienes herramientas disponibles. Cuando la respuesta dependa de datos ' +
          'reales del momento o del equipo (hora, fecha, estado del ordenador, etc.), ' +
          'USA la herramienta correspondiente en lugar de adivinar o suponer.';
        const skills = this.skillsPrompt?.();
        if (skills) first.content += `\n\n${skills}`;
      }
    }
    const ctx = { confidential: this.config.confidential };

    for (let step = 0; step < MAX_TOOL_STEPS; step++) {
      const stream = await client.chat.completions.create(
        {
          model,
          messages: messages as never,
          // JsonSchema lleva index signature, asi que encaja con el tipo del
          // SDK sin castear (messages si sigue casteado, ver arriba).
          ...(tools && tools.length > 0 ? { tools } : {}),
          max_tokens: this.maxTokens,
          temperature: this.temperature,
          reasoning_effort: this.reasoningEffort,
          stream: true,
        },
        reqOptions,
      );

      let text = '';
      const calls = new Map<number, { id: string; name: string; args: string }>();
      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (delta?.content) {
          text += delta.content;
          yield { type: 'text', delta: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const cur = calls.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name = tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          calls.set(tc.index, cur);
        }
      }

      // Sin herramientas pedidas: el texto ya emitido es la respuesta final.
      if (calls.size === 0 || !this.tools) return;

      const pending = [...calls.values()];
      messages.push({
        role: 'assistant',
        content: text || null,
        tool_calls: pending.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: c.args },
        })),
      });
      for (const call of pending) {
        yield { type: 'tool-start', name: call.name, args: call.args };
        const result = await this.tools.dispatch(call.name, call.args, ctx);
        yield { type: 'tool-end', name: call.name, result };
        messages.push({ role: 'tool', tool_call_id: call.id, content: result });
      }
      // Se da otra vuelta para que el modelo use los resultados.
    }

    yield { type: 'text', delta: ' (He alcanzado el limite de pasos con herramientas.)' };
  }
}
