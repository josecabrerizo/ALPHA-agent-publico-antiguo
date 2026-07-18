import OpenAI from 'openai';
import { DEFAULT_BRAIN_CONFIG } from './config.js';
import { resolveModel } from './registry.js';
import type { BrainConfig } from './types.js';

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
}

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

  constructor(options: BrainOptions = {}) {
    this.config = { ...DEFAULT_BRAIN_CONFIG, ...options.config };
    this.modelRef = options.model ?? this.config.model;
    this.reasoningEffort = options.reasoningEffort ?? 'none';
    this.maxTokens = options.maxTokens ?? 512;
    this.temperature = options.temperature ?? 0.6;
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
}
