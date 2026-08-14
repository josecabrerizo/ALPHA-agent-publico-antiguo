import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { repoRoot } from '../paths.js';
import { DEFAULT_CONFIG } from './schema.js';

/**
 * Perfiles de avatar. Un avatar no es solo una imagen: es un perfil que
 * reconfigura al asistente (nombre, personalidad, modelo, voz e imagen).
 *
 * La privacidad es del avatar: `local: true` significa que solo usa recursos de
 * la maquina. En modo confidencial solo se ofrecen esos.
 */

export interface AvatarVoice {
  engine: 'edge' | 'sapi';
  name: string;
  /** Ajuste de ritmo. Con una sola voz local, es lo que distingue avatares. */
  rate: number;
}

export interface AvatarProfile {
  id: string;
  name: string;
  role: string;
  /** Como se comporta: se inyecta en el prompt del sistema. */
  personality: string;
  /** Privacidad: true = solo recursos locales (modelo y voz de la maquina). */
  local: boolean;
  model: string;
  /** Ruta absoluta ya resuelta, para que la UI pueda cargarla directamente. */
  image: string;
  voice: AvatarVoice;
}

const avatarsPath = path.join(repoRoot, 'config', 'avatars.yaml');

/**
 * Carga los perfiles. Descarta los mal formados en vez de tumbar el arranque, y
 * corrige la incoherencia mas peligrosa: un avatar declarado local no puede
 * hablar con una voz de nube.
 */
export function loadAvatars(): AvatarProfile[] {
  let raw: string;
  try {
    raw = readFileSync(avatarsPath, 'utf8');
  } catch {
    return [];
  }
  return parseAvatars(raw);
}

/** El parseo, separado de la lectura, para poder probarlo sin tocar disco. */
export function parseAvatars(raw: string): AvatarProfile[] {
  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch {
    console.error('avatars.yaml tiene YAML invalido; se ignora.');
    return [];
  }

  const list = (parsed as { avatars?: unknown[] })?.avatars;
  if (!Array.isArray(list)) return [];

  const avatars: AvatarProfile[] = [];
  for (const entry of list) {
    const profile = normalize(entry);
    if (profile) avatars.push(profile);
  }
  return avatars;
}

function normalize(entry: unknown): AvatarProfile | undefined {
  if (!entry || typeof entry !== 'object') return undefined;
  const e = entry as Record<string, unknown>;

  const id = str(e['id']);
  const name = str(e['name']);
  if (!id || !name) return undefined;

  const local = e['local'] === true;
  const voiceRaw = (e['voice'] ?? {}) as Record<string, unknown>;
  let engine = voiceRaw['engine'] === 'sapi' ? 'sapi' : 'edge';
  // Contrato de privacidad: un avatar local no puede usar una voz de nube.
  if (local && engine !== 'sapi') engine = 'sapi';

  const voice: AvatarVoice = {
    engine: engine as 'edge' | 'sapi',
    name:
      str(voiceRaw['name']) ??
      (engine === 'sapi' ? DEFAULT_CONFIG.tts.sapiVoice : DEFAULT_CONFIG.tts.edgeVoice),
    rate: typeof voiceRaw['rate'] === 'number' ? voiceRaw['rate'] : 0,
  };

  const image = str(e['image']);
  return {
    id,
    name,
    role: str(e['role']) ?? '',
    personality: str(e['personality']) ?? '',
    local,
    model: str(e['model']) ?? DEFAULT_CONFIG.brain.model,
    // Se resuelve a absoluta: la UI es otro proceso y no comparte cwd.
    image: image ? path.resolve(repoRoot, image) : '',
    voice,
  };
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
