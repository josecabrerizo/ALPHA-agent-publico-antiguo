/**
 * Los cuatro agentes de A.L.P.H.A. Cada uno tiene identidad propia; mientras no
 * existan los sprites del personaje, esa identidad se expresa como color del
 * orbe. El estado (reposo/escuchando/...) es un eje aparte: da el ritmo de la
 * respiracion, no el color. Ver states.ts.
 */
export type AgentId = 'vulpis' | 'unit-a' | 'nexus' | 'synapse';

export interface Agent {
  id: AgentId;
  /** Nombre mostrado en el menu. */
  label: string;
  /** Una linea de personalidad, para el tooltip/menu. */
  tagline: string;
  /** Color de identidad del orbe (RGB). */
  color: [number, number, number];
}

export const AGENTS: Record<AgentId, Agent> = {
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

export const AGENT_ORDER: AgentId[] = ['vulpis', 'unit-a', 'nexus', 'synapse'];

export const DEFAULT_AGENT: AgentId = 'unit-a';
