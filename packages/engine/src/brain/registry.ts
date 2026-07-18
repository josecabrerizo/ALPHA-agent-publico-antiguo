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

  // El modo confidencial es un contrato duro: nada de nube en esa sesion.
  if (config.confidential && !provider.local) {
    throw new Error(
      `Modo confidencial activo: el proveedor "${providerName}" es de nube y esta bloqueado. ` +
        `Usa un proveedor local (p. ej. ollama/...).`,
    );
  }

  const apiKey = provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
  if (!apiKey) {
    throw new Error(
      `Falta la clave del proveedor "${providerName}". ` +
        `Define ${provider.apiKeyEnv ?? 'apiKey'} en el entorno o en la configuracion.`,
    );
  }

  return {
    provider: providerName,
    model,
    baseUrl: provider.baseUrl,
    apiKey,
    local: provider.local,
  };
}
