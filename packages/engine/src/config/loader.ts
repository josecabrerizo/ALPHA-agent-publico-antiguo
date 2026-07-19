import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { repoRoot } from '../paths.js';
import { DEFAULT_CONFIG, CONFIG_VERSION, type AlphaConfig } from './schema.js';

const configDir = path.join(repoRoot, 'config');
const defaultYamlPath = path.join(configDir, 'default.yaml');
const localYamlPath = path.join(configDir, 'local.yaml');
const settingsPath = path.join(configDir, 'alpha.settings.json');

/** Ajustes en vivo que escribe el menu del avatar. */
interface RuntimeSettings {
  agent?: string;
  model?: string;
  confidential?: boolean;
  audioDevice?: string;
}

/**
 * Carga la configuracion efectiva fusionando, de menor a mayor prioridad:
 *   defaults (schema.ts) < config/default.yaml < config/local.yaml < ajustes
 *   en vivo del avatar (alpha.settings.json).
 * Valida el resultado y propaga el modo confidencial al cerebro y a la voz.
 */
export function loadConfig(): AlphaConfig {
  let config = structuredClone(DEFAULT_CONFIG);

  config = mergeYaml(config, defaultYamlPath);
  config = mergeYaml(config, localYamlPath);
  config = applyRuntimeSettings(config, readSettings());

  migrate(config);
  validate(config);

  // El modo confidencial es la fuente de verdad; se propaga a los subsistemas
  // que tienen su propio flag para no tener dos verdades.
  config.brain.confidential = config.confidential;
  config.tts.confidential = config.confidential;
  return config;
}

function mergeYaml(base: AlphaConfig, file: string): AlphaConfig {
  let raw: string;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return base; // el fichero no existe: se ignora
  }
  try {
    const parsed = parseYaml(raw);
    if (parsed && typeof parsed === 'object') {
      return deepMerge(base, parsed as Record<string, unknown>) as AlphaConfig;
    }
  } catch {
    // YAML corrupto: se avisa pero no se tumba el arranque
    console.error(`Configuracion: ${path.basename(file)} tiene YAML invalido; se ignora.`);
  }
  return base;
}

function readSettings(): RuntimeSettings {
  try {
    return JSON.parse(readFileSync(settingsPath, 'utf8')) as RuntimeSettings;
  } catch {
    return {};
  }
}

/** Los ajustes del avatar (planos) mapean a rincones concretos del esquema. */
function applyRuntimeSettings(config: AlphaConfig, s: RuntimeSettings): AlphaConfig {
  if (typeof s.agent === 'string') config.agent = s.agent;
  if (typeof s.model === 'string') config.brain.model = s.model;
  if (typeof s.confidential === 'boolean') config.confidential = s.confidential;
  if (typeof s.audioDevice === 'string') config.audio.device = s.audioDevice;
  return config;
}

/** Migra configuraciones de una version anterior del esquema. */
function migrate(config: AlphaConfig): void {
  if (config.version === CONFIG_VERSION) return;
  // Todavia no hay versiones anteriores; cuando las haya, se transforman aqui.
  config.version = CONFIG_VERSION;
}

/** Comprobaciones minimas: si algo critico no cuadra, se avisa y se corrige. */
function validate(config: AlphaConfig): void {
  if (typeof config.confidential !== 'boolean') config.confidential = false;
  if (!config.brain?.model || typeof config.brain.model !== 'string') {
    config.brain.model = DEFAULT_CONFIG.brain.model;
  }
  if (!config.brain.providers || typeof config.brain.providers !== 'object') {
    config.brain.providers = DEFAULT_CONFIG.brain.providers;
  }
  if (config.tts.engine !== 'edge' && config.tts.engine !== 'sapi') {
    config.tts.engine = DEFAULT_CONFIG.tts.engine;
  }
  if (!Number.isFinite(config.audio.gainDb)) config.audio.gainDb = 0;
}

/** Fusion profunda: los objetos planos se mezclan; arrays y primitivos reemplazan. */
function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
