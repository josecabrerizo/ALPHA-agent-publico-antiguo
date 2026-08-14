import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { AGENT_ORDER, DEFAULT_AGENT, type AgentId } from './agents.js';

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
  /** Escucha activa. false = el motor cierra la captura y suelta el micro. */
  micEnabled: boolean;
  /** Voz actual del avatar: "sapi:..." o "edge:..." según getAvailableVoices. */
  voiceId: string;
}

export const DEFAULT_SETTINGS: Settings = {
  agent: DEFAULT_AGENT,
  model: 'ollama/gemma4:12b',
  confidential: false,
  audioDevice: '',
  micEnabled: true,
  voiceId: '', // vacío = usar la predeterminada del avatar
};

// dist/settings.js -> repoRoot: packages/ui-avatar/dist -> tres niveles arriba.
const repoRoot = path.resolve(__dirname, '..', '..', '..');
const settingsPath = path.join(repoRoot, 'config', 'alpha.settings.json');

/**
 * Fusiona lo leido del disco con los defaults, CAMPO A CAMPO y comprobando el
 * tipo de cada uno.
 *
 * El `{ ...DEFAULTS, ...JSON.parse(raw) }` de antes se fiaba del fichero: un
 * `{"agent": 42}` (o un agente que ya no existe) entraba tal cual, y la ventana
 * reventaba al buscar su color en AGENTS. El fichero lo escribe el avatar, pero
 * tambien puede editarlo una persona o quedarse a medias en un apagon.
 *
 * Es una funcion aparte, sin disco, para poder probarla sin pisar la
 * configuracion de verdad de quien ejecute los tests.
 */
export function mergeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const v = raw as Record<string, unknown>;
  const str = (key: keyof Settings, fallback: string): string =>
    typeof v[key] === 'string' ? v[key] : fallback;
  const bool = (key: keyof Settings, fallback: boolean): boolean =>
    typeof v[key] === 'boolean' ? v[key] : fallback;
  return {
    agent: AGENT_ORDER.includes(v['agent'] as AgentId)
      ? (v['agent'] as AgentId)
      : DEFAULT_SETTINGS.agent,
    model: str('model', DEFAULT_SETTINGS.model),
    confidential: bool('confidential', DEFAULT_SETTINGS.confidential),
    audioDevice: str('audioDevice', DEFAULT_SETTINGS.audioDevice),
    micEnabled: bool('micEnabled', DEFAULT_SETTINGS.micEnabled),
    voiceId: str('voiceId', DEFAULT_SETTINGS.voiceId),
  };
}

export function loadSettings(): Settings {
  try {
    return mergeSettings(JSON.parse(readFileSync(settingsPath, 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
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
  { ref: 'ollama/ornith:9b', label: 'Ornith 9B (local)', local: true },
  // Corre en la nube de Ollama pese a acceder por el endpoint local: no es
  // local a efectos de privacidad, el modo confidencial lo bloquea.
  { ref: 'ollama/gemma4:31b-cloud', label: 'Gemma 4 31B (Ollama cloud)', local: false },
  { ref: 'anthropic/claude-sonnet-5', label: 'Claude Sonnet 5 (nube)', local: false },
  { ref: 'openai/gpt-5.1', label: 'GPT-5.1 (nube)', local: false },
  { ref: 'gemini/gemini-2.5-flash', label: 'Gemini 2.5 Flash (nube)', local: false },
];
