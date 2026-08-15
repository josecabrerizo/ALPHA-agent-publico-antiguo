import { POSE_CENTRO, transitionPath, type Pose } from './poses.js';

/**
 * El reloj de la animacion del personaje. Decide QUE hay que pintar en cada
 * instante; pintarlo es cosa de la ventana.
 *
 * Se separa de Qt porque aqui esta todo lo que puede salir mal —encadenar
 * tramos, encolar un gesto mientras se esta a mitad de otro, volver a reposo
 * cuando toca— y nada de eso deberia necesitar una ventana para probarse.
 *
 * No tiene temporizador propio: se le pregunta por un instante (`frameAt`). Asi
 * el test avanza el tiempo a mano y no hay esperas reales.
 */

/** Duracion de un tramo del fundido. Corto: es un cambio de gesto, no una escena. */
export const FADE_MS = 170;
/** Cuanto se queda puesto un gesto puntual antes de volver a reposo. */
export const GESTO_MS = 1600;

/** Lo que hay que pintar en un instante. */
export interface PoseFrame {
  /** Pose que se va. */
  from: Pose;
  /** Pose que llega. Igual a `from` cuando no hay transicion. */
  to: Pose;
  /** 0 = solo `from`, 1 = solo `to`. */
  mix: number;
  /** true si hay fundido en curso (la ventana solo recompone entonces). */
  moving: boolean;
}

/** Suavizado en los extremos: sin esto el fundido arranca y frena de golpe. */
function suavizar(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - 2 * (1 - t) * (1 - t);
}

interface Tramo {
  desde: Pose;
  hasta: Pose;
  /** Instante en el que empieza; si es un gesto, se espera antes de seguir. */
  esperaAntesMs: number;
}

export class PoseAnimator {
  private actual: Pose = POSE_CENTRO;
  private cola: Tramo[] = [];
  /** Instante en el que arranco el tramo que esta corriendo (con su espera). */
  private tramoDesde = 0;

  constructor(private readonly inicial: Pose = POSE_CENTRO) {
    this.actual = inicial;
  }

  /** La pose a la que se dirige (o en la que esta si no hay nada encolado). */
  get objetivo(): Pose {
    return this.cola.length > 0 ? this.cola[this.cola.length - 1]!.hasta : this.actual;
  }

  /**
   * Pide una pose sostenida (viene de un cambio de estado). Reemplaza lo que
   * hubiera encolado: si el estado cambia a mitad de camino, manda el nuevo.
   */
  goTo(pose: Pose, now: number): void {
    if (pose === this.objetivo && this.cola.length > 0) return;
    this.encolar(this.tramosHasta(pose, now), now);
  }

  /**
   * Gesto puntual: va a la pose, la sostiene y vuelve a reposo. Se usa para el
   * saludo, que no es un estado sino algo que pasa una vez.
   */
  gesture(pose: Pose, now: number): void {
    const ida = this.tramosHasta(pose, now);
    if (ida.length === 0 && this.actual === pose) return;
    const vuelta: Tramo[] = [{ desde: pose, hasta: POSE_CENTRO, esperaAntesMs: GESTO_MS }];
    this.encolar([...ida, ...vuelta], now);
  }

  private tramosHasta(pose: Pose, now: number): Tramo[] {
    // Se parte de donde se estara cuando acabe el tramo en curso, no de la
    // pose actual: encadenar desde el punto medio de un fundido daria un salto.
    const desde = this.enTransito(now) ? this.cola[0]!.hasta : this.actual;
    return transitionPath(desde, pose).map((hasta, i, todos) => ({
      desde: i === 0 ? desde : todos[i - 1]!,
      hasta,
      esperaAntesMs: 0,
    }));
  }

  private encolar(tramos: Tramo[], now: number): void {
    if (tramos.length === 0) return;
    // El tramo en curso se respeta; lo que venia detras se descarta.
    if (this.enTransito(now)) {
      const enCurso = this.cola[0]!;
      this.cola = [enCurso, ...tramos];
    } else {
      this.cola = tramos;
      this.tramoDesde = now;
    }
  }

  private enTransito(now: number): boolean {
    if (this.cola.length === 0) return false;
    const t = this.cola[0]!;
    return now < this.tramoDesde + t.esperaAntesMs + FADE_MS;
  }

  /** Que pintar en `now`. Avanza la cola por el camino. */
  frameAt(now: number): PoseFrame {
    // Consumir los tramos ya terminados.
    for (;;) {
      const t = this.cola[0];
      if (!t) break;
      const fin = this.tramoDesde + t.esperaAntesMs + FADE_MS;
      if (now < fin) break;
      this.actual = t.hasta;
      this.cola.shift();
      this.tramoDesde = fin;
    }

    const t = this.cola[0];
    if (!t) {
      return { from: this.actual, to: this.actual, mix: 1, moving: false };
    }

    const arranca = this.tramoDesde + t.esperaAntesMs;
    if (now < arranca) {
      // Sosteniendo el gesto: quieto en la pose, sin fundido.
      return { from: t.desde, to: t.desde, mix: 1, moving: false };
    }
    const bruto = Math.min(1, Math.max(0, (now - arranca) / FADE_MS));
    return { from: t.desde, to: t.hasta, mix: suavizar(bruto), moving: true };
  }
}
