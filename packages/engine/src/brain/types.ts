/**
 * Modelo de configuracion del cerebro, al estilo Hermes/OpenClaw: un registro
 * de proveedores compatibles con la API de OpenAI y una referencia por defecto
 * en formato `proveedor/modelo` (p. ej. `ollama/gemma4:12b`).
 *
 * La clave del diseno: Ollama, OpenAI, Anthropic (y casi todos) exponen el
 * mismo dialecto `/v1/chat/completions`, asi que UN cliente sirve para todos;
 * solo cambian base_url, api_key y el id del modelo.
 */
export interface ProviderConfig {
  /** Endpoint compatible con OpenAI, incluido el sufijo /v1. */
  baseUrl: string;
  /**
   * Clave literal (Ollama la ignora pero la API la exige, valor 'ollama').
   * Para la nube, preferir apiKeyEnv y no meter secretos en el fichero.
   */
  apiKey?: string;
  /** Nombre de la variable de entorno de donde leer la clave. */
  apiKeyEnv?: string;
  /**
   * true = por defecto corre en la maquina. Es el valor base de privacidad de
   * los modelos del proveedor; se puede afinar por modelo con `cloudModels`.
   */
  local: boolean;
  /** Modelos conocidos de este proveedor (lista informativa / allowlist). */
  models?: string[];
  /**
   * Modelos que van a la NUBE aunque el proveedor sea local (p. ej. Ollama es
   * local, pero gemma4:31b-cloud corre en la nube de Ollama). El modo
   * confidencial los bloquea. Es lo que hace la privacidad por-modelo y no solo
   * por-proveedor.
   */
  cloudModels?: string[];
}

export interface BrainConfig {
  /** Referencia por defecto en formato `proveedor/modelo`. */
  model: string;
  /** Prompt de sistema base de A.L.P.H.A. */
  systemPrompt: string;
  /** Registro de proveedores por nombre. */
  providers: Record<string, ProviderConfig>;
  /** Si true, solo se permiten proveedores con local=true. */
  confidential: boolean;
}

/** Conexion ya resuelta y lista para instanciar el cliente. */
export interface ResolvedModel {
  provider: string;
  model: string;
  baseUrl: string;
  apiKey: string;
  local: boolean;
}
