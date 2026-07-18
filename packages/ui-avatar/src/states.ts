/**
 * Los cuatro estados de animacion del avatar. Son ortogonales a los cuatro
 * AGENTES (Vulpis.AI, Unit-A, Nexus, Synapse): cada agente tendra su propio
 * juego de sprites, y cada sprite un estado. Aqui, con el orbe de marcador de
 * posicion, el estado se expresa como color y ritmo de "respiracion".
 */
export type AvatarState = 'reposo' | 'escuchando' | 'pensando' | 'hablando';

export interface StateStyle {
  /** Color central del orbe, RGB. */
  color: [number, number, number];
  /** Periodo de la respiracion en ms: mas corto = mas nervioso. */
  breatheMs: number;
  /** Amplitud del pulso en px sobre el radio base. */
  pulse: number;
}

export const STATE_STYLES: Record<AvatarState, StateStyle> = {
  reposo: { color: [90, 140, 235], breatheMs: 3400, pulse: 5 }, // azul sereno
  escuchando: { color: [70, 200, 130], breatheMs: 1500, pulse: 9 }, // verde atento
  pensando: { color: [235, 175, 70], breatheMs: 900, pulse: 7 }, // ambar inquieto
  hablando: { color: [170, 110, 235], breatheMs: 650, pulse: 12 }, // violeta activo
};

/** Orden de rotacion al ciclar estados manualmente (clic derecho). */
export const STATE_CYCLE: AvatarState[] = ['reposo', 'escuchando', 'pensando', 'hablando'];
