import { DEFAULT_AVATAR_ID, FOUNDER_AVATARS, type OrbColor } from '@alpha/protocol';

/**
 * Catalogo de RESPALDO para antes de conectar con el motor: los cuatro agentes
 * fundadores, con nombre, rol y color, para que el menu y el orbe no arranquen
 * vacios. La fuente de verdad son los perfiles que manda el motor (salen de
 * config/avatars.yaml, con su color incluido): un avatar nuevo alli funciona
 * de punta a punta sin tocar este fichero. Este respaldo se DERIVA del
 * catalogo compartido de @alpha/protocol (FOUNDER_AVATARS) — antes era una
 * copia a mano que podia desviarse.
 *
 * El estado (reposo/escuchando/...) es un eje aparte: da el ritmo de la
 * respiracion, no el color. Ver states.ts.
 */
export interface Agent {
  id: string;
  /** Nombre mostrado en el menu. */
  label: string;
  /** Una linea de personalidad, para el tooltip/menu. */
  tagline: string;
  /** Color de identidad del orbe (RGB). */
  color: OrbColor;
}

export const FALLBACK_AGENTS: Record<string, Agent> = Object.fromEntries(
  FOUNDER_AVATARS.map((a) => [a.id, { id: a.id, label: a.name, tagline: a.role, color: a.color }]),
);

export const AGENT_ORDER: string[] = FOUNDER_AVATARS.map((a) => a.id);

export const DEFAULT_AGENT: string = DEFAULT_AVATAR_ID;
