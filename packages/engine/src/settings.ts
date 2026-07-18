import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Configuracion en vivo del asistente, la MISMA que escribe el menu del avatar
 * (packages/ui-avatar/src/settings.ts) en config/alpha.settings.json. El motor
 * la lee para arrancar sincronizado con lo que el usuario dejo configurado en
 * la cara, que es su panel de control.
 */
export interface AlphaSettings {
  agent: string;
  /** Ref proveedor/modelo, como en brain/config.ts. */
  model: string;
  confidential: boolean;
  /** Nombre del microfono elegido. Vacio = el predeterminado del sistema. */
  audioDevice: string;
}

const DEFAULTS: AlphaSettings = {
  agent: 'unit-a',
  model: 'ollama/gemma4:12b',
  confidential: false,
  audioDevice: '',
};

// src/settings.ts (tsx) o dist/settings.js -> repoRoot: tres niveles arriba.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const alphaSettingsPath = path.join(repoRoot, 'config', 'alpha.settings.json');

export function loadAlphaSettings(): AlphaSettings {
  try {
    const raw = readFileSync(alphaSettingsPath, 'utf8');
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<AlphaSettings>) };
  } catch {
    return { ...DEFAULTS };
  }
}
