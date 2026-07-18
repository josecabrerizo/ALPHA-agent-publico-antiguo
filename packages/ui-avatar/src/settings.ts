import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_AGENT, type AgentId } from './agents.js';

/**
 * Configuracion en vivo del asistente, editable desde el menu del avatar y
 * persistida en disco para que sobreviva al reinicio. Es tambien el punto donde
 * el motor leera las preferencias cuando exista la IPC (por eso vive en
 * config/, no en el paquete de UI).
 */
export interface Settings {
  agent: AgentId;
  /** Ref proveedor/modelo, como en el cerebro (brain/config.ts). */
  model: string;
  /** Modo confidencial: sin nube. */
  confidential: boolean;
  /** Microfono elegido. Vacio = el predeterminado del sistema. */
  audioDevice: string;
}

const DEFAULTS: Settings = {
  agent: DEFAULT_AGENT,
  model: 'ollama/gemma4:12b',
  confidential: false,
  audioDevice: '',
};

// dist/settings.js -> repoRoot: packages/ui-avatar/dist -> tres niveles arriba.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const settingsPath = path.join(repoRoot, 'config', 'alpha.settings.json');

export function loadSettings(): Settings {
  try {
    const raw = readFileSync(settingsPath, 'utf8');
    // Se fusiona con los defaults: un fichero viejo al que le falten claves
    // nuevas no rompe.
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    // Que no se pueda guardar no debe tumbar el avatar; se avisa y se sigue.
    console.error('No se pudo guardar la configuracion:', (error as Error).message);
  }
}

/** Modelos ofrecidos en el menu. Reflejan los proveedores del cerebro. */
export const MODEL_OPTIONS: { ref: string; label: string; local: boolean }[] = [
  { ref: 'ollama/gemma4:12b', label: 'Gemma 4 12B (local)', local: true },
  { ref: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (nube)', local: false },
  { ref: 'openai/gpt-5.1', label: 'GPT-5.1 (nube)', local: false },
  { ref: 'gemini/gemini-2.5-flash', label: 'Gemini 2.5 Flash (nube)', local: false },
];
