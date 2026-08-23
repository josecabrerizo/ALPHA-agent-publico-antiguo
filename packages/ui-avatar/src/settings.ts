import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { alphaHomeDir } from '@alpha/protocol';
import { DEFAULT_AGENT } from './agents.js';

/**
 * Cache de PRESENTACION de la UI: el ultimo avatar mostrado, el micro elegido
 * y el mute, para pintar algo con sentido antes de conectar con el motor.
 *
 * NO es configuracion del motor: los cambios viajan por el puente y es el
 * MOTOR quien los persiste (config/alpha.settings.json, escritor unico). Por
 * eso este fichero vive en ~/.alpha y no en config/ — y si el motor dice otra
 * cosa al conectar, manda el motor.
 */
export interface Settings {
  agent: string;
  /** Microfono elegido. Vacio = el predeterminado del sistema. */
  audioDevice: string;
  /** Escucha activa. false = el motor cierra la captura y suelta el micro. */
  micEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  agent: DEFAULT_AGENT,
  audioDevice: '',
  micEnabled: true,
};

// Funcion y no constante: alphaHomeDir lee ALPHA_HOME en cada llamada (los
// tests la mueven a un temporal).
function settingsPath(): string {
  return path.join(alphaHomeDir(), 'alpha.ui.json');
}

/**
 * Fusiona lo leido del disco con los defaults, CAMPO A CAMPO y comprobando el
 * tipo de cada uno.
 *
 * Un `{"agent": 42}` o un booleano en texto no entran; un agente DESCONOCIDO
 * si: la lista de avatares la manda el motor, y esta UI ya no revienta con un
 * id que no este en su catalogo de respaldo (el orbe cae al color neutro).
 *
 * Es una funcion aparte, sin disco, para poder probarla sin pisar la
 * configuracion de verdad de quien ejecute los tests.
 */
export function mergeSettings(raw: unknown): Settings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_SETTINGS };
  const v = raw as Record<string, unknown>;
  const str = (key: keyof Settings, fallback: string): string =>
    typeof v[key] === 'string' ? v[key] : fallback;
  const agent = v['agent'];
  return {
    agent: typeof agent === 'string' && agent.trim() ? agent : DEFAULT_SETTINGS.agent,
    audioDevice: str('audioDevice', DEFAULT_SETTINGS.audioDevice),
    micEnabled:
      typeof v['micEnabled'] === 'boolean' ? v['micEnabled'] : DEFAULT_SETTINGS.micEnabled,
  };
}

export function loadSettings(): Settings {
  try {
    return mergeSettings(JSON.parse(readFileSync(settingsPath(), 'utf8')));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    const file = settingsPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    // Que no se pueda guardar no debe tumbar el avatar; se avisa y se sigue.
    console.error('No se pudo guardar la configuracion:', (error as Error).message);
  }
}
