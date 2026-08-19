import path from 'node:path';
import type { AvatarState } from './states.js';

/**
 * Las poses del personaje, y las reglas de cuando se pasa de una a otra.
 *
 * Es un eje con centro: TODO pasa por reposo. Nunca se funde una pose con
 * brazos directamente contra otra pose con brazos, porque los brazos estan en
 * sitios distintos y la mezcla se ve como un borron de cuatro manos. Pasando
 * por reposo, cada fundido tiene un extremo con los brazos bajados y solo se
 * difumina lo que se mueve.
 *
 * Sin Qt a proposito: aqui vive la decision, y la ventana solo la pinta.
 */
export type Pose = 'reposo' | 'hablando' | 'pensando' | 'saludo';

export const POSES: readonly Pose[] = ['reposo', 'hablando', 'pensando', 'saludo'];

/** El centro del eje: la pose por la que pasan todas las transiciones. */
export const POSE_CENTRO: Pose = 'reposo';

/**
 * Que pose corresponde a cada estado del asistente.
 *
 * "escuchando" comparte la pose de reposo a proposito: no hay una pose de
 * escucha, y el halo (que crece y se enciende por estado) ya los distingue.
 * "saludo" no sale de aqui porque no es un estado sino un GESTO: se dispara por
 * lo que dice el asistente, no por en que fase del turno esta.
 */
export function poseForState(state: AvatarState): Pose {
  switch (state) {
    case 'hablando':
      return 'hablando';
    case 'pensando':
      return 'pensando';
    case 'reposo':
    case 'escuchando':
      return 'reposo';
  }
}

/**
 * Los tramos que hay que animar para ir de una pose a otra. Vacio si ya se
 * esta en ella; un tramo si una de las dos es reposo; dos si no, pasando por
 * el centro.
 */
export function transitionPath(from: Pose, to: Pose): Pose[] {
  if (from === to) return [];
  if (from === POSE_CENTRO || to === POSE_CENTRO) return [to];
  return [POSE_CENTRO, to];
}

/**
 * Fase de la respiracion en -1..1 para un instante dado. Es una sinusoide: el
 * periodo lo pone el estado (STATE_RHYTHMS), asi que el personaje respira mas
 * deprisa cuando piensa o habla que cuando esta en reposo.
 */
export function breathAt(nowMs: number, periodMs: number): number {
  if (periodMs <= 0) return 0;
  return Math.sin((2 * Math.PI * nowMs) / periodMs);
}

/**
 * Carpeta con las poses de un avatar, deducida de la ruta de su retrato: el
 * motor manda ".../unit-a.png" y las poses viven en ".../unit-a/".
 *
 * Se deduce en vez de pedirsela al motor porque COMO se anima el personaje es
 * cosa de la presentacion. El motor sigue siendo el dueno de que avatar hay
 * puesto y de cual es su retrato; si no hay carpeta, la ventana se queda con
 * la imagen unica y no se anima.
 */
export function posesDirFor(imagePath: string): string {
  const dir = path.dirname(imagePath);
  const base = path.basename(imagePath, path.extname(imagePath));
  return path.join(dir, base);
}

/** Fichero de una pose dentro de esa carpeta. */
export function poseFile(posesDir: string, pose: Pose): string {
  return path.join(posesDir, `${pose}.png`);
}

// La deteccion de saludos vivio aqui hasta que el gesto paso a decidirlo el
// MOTOR (conversation/greeting.ts en el engine): la UI recibe un mensaje
// `gesture` explicito y no infiere nada del texto.
