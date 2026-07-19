import type { BrainConfig, ResolvedModel } from './types.js';

/**
 * Resuelve una referencia `proveedor/modelo` contra el registro de la config:
 * localiza el proveedor, saca la clave (literal o de entorno) y aplica las
 * reglas del modo confidencial.
 *
 * Separa por la PRIMERA barra: el id del modelo puede llevar mas (`gemma4:12b`
 * no, pero `ollama/library/foo` si).
 */
export function resolveModel(ref: string, config: BrainConfig): ResolvedModel {
  const slash = ref.indexOf('/');
  if (slash === -1) {
    throw new Error(
      `Referencia de modelo invalida: "${ref}". Usa el formato proveedor/modelo, p. ej. ollama/gemma4:12b.`,
    );
  }
  const providerName = ref.slice(0, slash);
  const model = ref.slice(slash + 1);

  const provider = config.providers[providerName];
  if (!provider) {
    const disponibles = Object.keys(config.providers).join(', ');
    throw new Error(`Proveedor desconocido: "${providerName}". Configurados: ${disponibles}.`);
  }

  // Privacidad POR MODELO: el proveedor da el valor base, pero un modelo puede
  // ser de nube aunque el proveedor sea local (gemma4:31b-cloud). Esta es la
  // unica comprobacion del contrato confidencial: da igual el canal por el que
  // se pida el modelo (menu, entorno, TCP), aqui se bloquea siempre.
  const local = provider.local && !(provider.cloudModels ?? []).includes(model);
  if (config.confidential && !local) {
    throw new Error(
      `Modo confidencial activo: el modelo "${ref}" usa la nube y esta bloqueado. ` +
        `Usa un modelo local (p. ej. ollama/gemma4:12b).`,
    );
  }

  const apiKey = provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(
      `Falta la clave del proveedor "${providerName}". ` +
        `Define ${provider.apiKeyEnv ?? 'apiKey'} en el entorno o en la configuracion.`,
    );
  }

  return { provider: providerName, model, baseUrl: provider.baseUrl, apiKey, local };
}
