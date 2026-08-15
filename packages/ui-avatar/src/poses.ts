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

/**
 * Saludos, para disparar el gesto de la mano cuando el asistente saluda o
 * devuelve el saludo.
 *
 * Se exige que el saludo este al PRINCIPIO del texto (o tras un signo de
 * apertura): asi "hola, ¿en que te ayudo?" saluda, pero "te dije hola hace un
 * rato" no. Sin ese ancla, cualquier mencion de la palabra agitaba la mano.
 */
/**
 * Saludos que valen como COMIENZO de la frase: lo que va detras es el resto del
 * saludo ("hola, dime") y no cambia que sea uno.
 */
const SALUDOS_INICIO = [
  'hola',
  'holi',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'saludos',
  'bienvenido',
  'bienvenida',
  'encantado',
  'encantada',
];

/**
 * Saludos que solo valen si son la frase ENTERA. Son palabras que empiezan
 * frases normales: "buenas noticias" no saluda, "buenas" a secas si. Este es el
 * falso positivo que hay que evitar — agitar la mano sin venir a cuento se nota
 * mucho mas que no saludar.
 */
const SALUDOS_SOLOS = ['buenas', 'hey', 'ey', 'que tal', 'como estas', 'como te va'];

/** Quita acentos y signos para comparar sin depender de como se escriba. */
function normalizar(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // marcas de acento sueltas tras NFD
    .toLowerCase()
    .replace(/^[¡¿"'\s.,-]+/, '')
    .trim();
}

export function isGreeting(text: string): boolean {
  const limpio = normalizar(text);
  if (!limpio) return false;
  // Solo la primera oracion: el saludo, si lo hay, abre el mensaje.
  const primera = limpio.split(/[.,;!?\n]/, 1)[0]?.trim() ?? '';
  if (!primera) return false;
  if (SALUDOS_SOLOS.includes(primera)) return true;
  return SALUDOS_INICIO.some((s) => primera === s || primera.startsWith(`${s} `));
}
