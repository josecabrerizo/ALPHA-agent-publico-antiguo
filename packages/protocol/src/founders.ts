import type { AvatarOption } from './messages.js';

/**
 * Los cuatro agentes fundadores de A.L.P.H.A., como datos de PRESENTACION
 * (AvatarOption: sin personalidad, que es cosa del motor). Es la UNICA fuente
 * de las tres copias que existian: config/avatars.yaml del motor (un test del
 * engine comprueba que no diverja), el catalogo de respaldo de la UI y el de
 * la fachada avatar-mcp. Cuando el arte y el motor vivan en repos separados,
 * este catalogo es el puente del invariante: el engine comprueba yaml↔aqui,
 * y la UI comprueba aqui↔arte.
 */
export const FOUNDER_AVATARS: readonly AvatarOption[] = [
  {
    id: 'vulpis',
    name: 'Vulpis.AI',
    role: 'El Explorador Proactivo',
    model: 'ollama/gemma4:31b-cloud',
    confidential: false,
    voice: { engine: 'edge', name: 'es-ES-AlvaroNeural', rate: 0 },
    imageId: 'vulpis',
    color: [235, 150, 70], // naranja zorro
  },
  {
    id: 'unit-a',
    name: 'Unit-A',
    role: 'El Asistente Cibernético',
    model: 'ollama/gemma4:12b',
    confidential: true,
    voice: { engine: 'sapi', name: 'Microsoft Zira Desktop', rate: 1 },
    imageId: 'unit-a',
    color: [95, 155, 210], // azul acero
  },
  {
    id: 'nexus',
    name: 'Nexus',
    role: 'El Guardián de Datos',
    model: 'ollama/ornith:9b',
    confidential: true,
    voice: { engine: 'sapi', name: 'Microsoft Helena Desktop', rate: -1 },
    imageId: 'nexus',
    color: [70, 210, 200], // cian cristal
  },
  {
    id: 'synapse',
    name: 'Synapse',
    role: 'La Guía Neural',
    model: 'ollama/gemma4:31b-cloud',
    confidential: false,
    voice: { engine: 'edge', name: 'es-ES-ElviraNeural', rate: 0 },
    imageId: 'synapse',
    color: [175, 110, 235], // violeta etereo
  },
];

/** El fundador que hace de agente por defecto. */
export const DEFAULT_AVATAR_ID = 'unit-a';
