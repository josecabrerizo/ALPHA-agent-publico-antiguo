import type { BrainConfig } from './types.js';

/**
 * Configuracion por defecto del cerebro. Refleja el `cerebro:` de
 * config/default.yaml; cuando exista el cargador de YAML, este objeto sera el
 * fallback y los ficheros lo sobreescribiran.
 *
 * Por defecto, local: Ollama con el unico modelo presente en la maquina
 * (gemma4:12b). La nube queda declarada pero solo se usa fuera del modo
 * confidencial y si hay clave en el entorno.
 */
export const DEFAULT_BRAIN_CONFIG: BrainConfig = {
  model: 'ollama/gemma4:12b',
  systemPrompt:
    'Eres A.L.P.H.A. (Asistente Local Proactivo Hibrido Abierto), un asistente ' +
    'de escritorio en espanol. Respondes de forma breve, clara y natural, como ' +
    'en una conversacion hablada. Si no sabes algo, lo dices.',
  confidential: false,
  providers: {
    ollama: {
      baseUrl: 'http://127.0.0.1:11434/v1',
      apiKey: 'ollama', // Ollama ignora la clave pero el cliente OpenAI la exige
      local: true,
      models: ['gemma4:12b', 'ornith:9b', 'gemma4:31b-cloud'],
      // gemma4:31b-cloud corre en la nube de Ollama aunque se acceda por el
      // endpoint local: el modo confidencial lo bloquea (resolveModel), no solo
      // el menu del avatar.
      cloudModels: ['gemma4:31b-cloud'],
    },
    anthropic: {
      baseUrl: 'https://api.anthropic.com/v1',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
      local: false,
      models: ['claude-sonnet-5', 'claude-opus-4-8'],
    },
    openai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKeyEnv: 'OPENAI_API_KEY',
      local: false,
      models: ['gpt-5.1', 'gpt-5.1-mini'],
    },
    gemini: {
      // Google expone un endpoint compatible con OpenAI.
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      apiKeyEnv: 'GEMINI_API_KEY',
      local: false,
      models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    },
  },
};
