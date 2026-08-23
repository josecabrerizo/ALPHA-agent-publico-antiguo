import type { OrbColor } from '@alpha/protocol';

/**
 * Catalogo de RESPALDO para antes de conectar con el motor: los cuatro agentes
 * fundadores, con nombre, rol y color, para que el menu y el orbe no arranquen
 * vacios. La fuente de verdad son los perfiles que manda el motor (salen de
 * config/avatars.yaml, con su color incluido): un avatar nuevo alli funciona
 * de punta a punta sin tocar este fichero, que solo cubre el hueco hasta que
 * llega el primer mensaje `avatars`.
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

export const FALLBACK_AGENTS: Record<string, Agent> = {
  vulpis: {
    id: 'vulpis',
    label: 'Vulpis.AI',
    tagline: 'El explorador proactivo',
    color: [235, 150, 70], // naranja zorro
  },
  'unit-a': {
    id: 'unit-a',
    label: 'Unit-A',
    tagline: 'El asistente cibernetico',
    color: [95, 155, 210], // azul acero
  },
  nexus: {
    id: 'nexus',
    label: 'Nexus',
    tagline: 'El guardian de datos',
    color: [70, 210, 200], // cian cristal
  },
  synapse: {
    id: 'synapse',
    label: 'Synapse',
    tagline: 'La guia neural',
    color: [175, 110, 235], // violeta etereo
  },
};

export const AGENT_ORDER: string[] = ['vulpis', 'unit-a', 'nexus', 'synapse'];

export const DEFAULT_AGENT = 'unit-a';
