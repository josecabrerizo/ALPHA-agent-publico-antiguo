import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { isMap, isSeq, parse as parseYaml, parseDocument } from 'yaml';
import { DEFAULT_ORB_COLOR, type OrbColor } from '@alpha/protocol';
import { repoRoot } from '../paths.js';
import { DEFAULT_CONFIG } from './schema.js';

/**
 * Perfiles de avatar. Un avatar no es solo una imagen: es un perfil que
 * reconfigura al asistente (nombre, personalidad, modelo, voz e imagen).
 *
 * La privacidad es del avatar: `confidential: true` significa que solo usa
 * recursos de la maquina.
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
  /** Modo confidencial propio del avatar: solo modelo y voz locales. */
  confidential: boolean;
  model: string;
  /**
   * Identificador del juego de arte (basename del campo image, sin extension).
   * El motor no manda rutas: el arte es de la presentacion y cada UI lo
   * resuelve contra su propia carpeta de assets.
   */
  imageId: string;
  /** Color de identidad del orbe. */
  color: OrbColor;
  voice: AvatarVoice;
}

export interface AvatarProfilePatch {
  model?: string;
  confidential?: boolean;
  voice?: AvatarVoice;
}

const avatarsPath = path.join(repoRoot, 'config', 'avatars.yaml');

/**
 * Carga los perfiles. Descarta los mal formados en vez de tumbar el arranque, y
 * corrige la incoherencia mas peligrosa: un avatar confidencial no puede hablar
 * con una voz de nube.
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

  // `local` fue el nombre original. Se sigue leyendo para que una configuracion
  // anterior arranque, pero al guardar se migra a `confidential`, que describe
  // lo que el usuario configura realmente.
  const confidential = e['confidential'] === true || e['local'] === true;
  const voiceRaw = (e['voice'] ?? {}) as Record<string, unknown>;
  const requestedEngine = voiceRaw['engine'] === 'sapi' ? 'sapi' : 'edge';
  let engine = requestedEngine;
  // Contrato de privacidad: un avatar confidencial no puede usar voz de nube.
  if (confidential && engine !== 'sapi') engine = 'sapi';
  const forcedLocalVoice = requestedEngine !== engine;

  const voice: AvatarVoice = {
    engine: engine as 'edge' | 'sapi',
    name:
      (forcedLocalVoice ? undefined : str(voiceRaw['name'])) ??
      (engine === 'sapi' ? DEFAULT_CONFIG.tts.sapiVoice : DEFAULT_CONFIG.tts.edgeVoice),
    rate: typeof voiceRaw['rate'] === 'number' ? voiceRaw['rate'] : 0,
  };

  const image = str(e['image']);
  return {
    id,
    name,
    role: str(e['role']) ?? '',
    personality: str(e['personality']) ?? '',
    confidential,
    model: str(e['model']) ?? DEFAULT_CONFIG.brain.model,
    // Del nombre del fichero sale el id del juego de arte; sin imagen, el
    // propio id del perfil (la UI ya busca assets/avatars/<id>.png de fallback).
    imageId: image ? path.basename(image, path.extname(image)) : id,
    color: parseColor(e['color']) ?? DEFAULT_ORB_COLOR,
    voice,
  };
}

/** [r, g, b] en 0..255, o nada: un color a medias no puede colarse en la UI. */
function parseColor(v: unknown): OrbColor | undefined {
  if (!Array.isArray(v) || v.length !== 3) return undefined;
  const ok = (c: unknown): c is number =>
    typeof c === 'number' && Number.isFinite(c) && c >= 0 && c <= 255;
  const [r, g, b] = v as unknown[];
  return ok(r) && ok(g) && ok(b) ? [Math.round(r), Math.round(g), Math.round(b)] : undefined;
}

/**
 * Modifica un unico perfil conservando comentarios, orden y formato general del
 * YAML. Devuelve el documento nuevo para poder probarlo sin tocar el fichero.
 */
export function patchAvatarsYaml(raw: string, id: string, patch: AvatarProfilePatch): string {
  const doc = parseDocument(raw);
  if (doc.errors.length > 0) throw new Error('avatars.yaml contiene YAML invalido');

  const list = doc.get('avatars', true);
  if (!isSeq(list)) throw new Error('avatars.yaml no contiene una lista "avatars"');

  const index = list.items.findIndex((item) => isMap(item) && item.get('id') === id);
  if (index < 0) throw new Error(`avatar desconocido: "${id}"`);

  if (patch.model !== undefined) doc.setIn(['avatars', index, 'model'], patch.model);
  if (patch.confidential !== undefined) {
    doc.setIn(['avatars', index, 'confidential'], patch.confidential);
    // Migracion del nombre antiguo: una sola clave evita dos fuentes de verdad.
    doc.deleteIn(['avatars', index, 'local']);
  }
  if (patch.voice !== undefined) {
    doc.setIn(['avatars', index, 'voice'], {
      engine: patch.voice.engine,
      name: patch.voice.name,
      rate: patch.voice.rate,
    });
  }
  return String(doc);
}

/** Persiste un cambio de perfil de forma atomica y devuelve los perfiles efectivos. */
export function saveAvatarProfile(id: string, patch: AvatarProfilePatch): AvatarProfile[] {
  const raw = readFileSync(avatarsPath, 'utf8');
  const next = patchAvatarsYaml(raw, id, patch);
  const parsed = parseAvatars(next);
  const profile = parsed.find((candidate) => candidate.id === id);
  if (!profile) throw new Error(`el perfil "${id}" quedaria invalido`);

  const tmp = `${avatarsPath}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, avatarsPath);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
  return parsed;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
