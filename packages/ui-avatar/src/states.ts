/**
 * Los cuatro estados de animacion del avatar. Ortogonales al AGENTE: el agente
 * (agents.ts) da el COLOR de identidad; el estado da el RITMO de la respiracion
 * (y su amplitud). Asi un mismo agente se ve igual de color pero "respira"
 * distinto segun este en reposo, escuchando, pensando o hablando.
 */
export type AvatarState = 'reposo' | 'escuchando' | 'pensando' | 'hablando';

export interface StateRhythm {
  /** Periodo de la respiracion en ms: mas corto = mas nervioso. */
  breatheMs: number;
  /** Amplitud del pulso en px sobre el radio base. */
  pulse: number;
}

export const STATE_RHYTHMS: Record<AvatarState, StateRhythm> = {
  reposo: { breatheMs: 3400, pulse: 5 },
  escuchando: { breatheMs: 1500, pulse: 9 },
  pensando: { breatheMs: 900, pulse: 7 },
  hablando: { breatheMs: 650, pulse: 12 },
};

/** Orden de rotacion al ciclar estados (doble clic, para pruebas). */
export const STATE_CYCLE: AvatarState[] = ['reposo', 'escuchando', 'pensando', 'hablando'];

/** El pulso mas amplio de todos los estados, para clavar el circulo (ver window). */
export const MAX_PULSE = Math.max(...Object.values(STATE_RHYTHMS).map((s) => s.pulse));
