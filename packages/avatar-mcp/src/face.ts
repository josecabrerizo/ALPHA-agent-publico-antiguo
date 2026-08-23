import {
  DEFAULT_ORB_COLOR,
  type AvatarBridge,
  type AvatarGesture,
  type AvatarOption,
  type AvatarWireState,
} from '@alpha/protocol';
import type { Speaker } from './speaker.js';

/**
 * El controlador de la cara: traduce ordenes de alto nivel (decir, saludar,
 * cambiar de avatar) a la coreografia de mensajes del puente que la UI ya
 * entiende. La fachada SE HACE PASAR POR EL MOTOR: levanta el mismo
 * AvatarBridge, escribe el mismo token, y el avatar se conecta sin saber
 * quien hay detras.
 *
 * Sin SDK de MCP y sin Qt a proposito: aqui vive la logica, y se prueba
 * contra un puente real con un socket de mentira (el patron del proyecto).
 */

/** Un mensaje escrito por el usuario en el chat del avatar. */
export interface FaceMessage {
  texto: string;
  ts: number;
}

/** Perfil minimo cuando no llega ningun catalogo: la cara sigue viva. */
function fallbackProfile(): AvatarOption {
  return {
    id: 'alpha',
    name: 'A.L.P.H.A.',
    role: 'Asistente',
    confidential: true,
    model: '',
    imageId: 'alpha',
    color: DEFAULT_ORB_COLOR,
    voice: { engine: 'sapi', name: '', rate: 0 },
  };
}

export class FaceController {
  private readonly profiles: AvatarOption[];
  private active: AvatarOption;
  private inbox: FaceMessage[] = [];
  /** La voz del avatar ACTIVO: se recrea al cambiar de perfil (la fabrica). */
  private speaker: Speaker | undefined;
  /**
   * Voces con habla EN VUELO: cada frase captura su voz al empezar y la
   * suelta al asentarse. Es lo que permite a detener() cortar una voz
   * sustituida que aun suena SIN retener para siempre cada reemplazo (una
   * lista permanente creceria sin limite en una fachada longeva).
   */
  private readonly vocesEnVuelo = new Set<Speaker>();

  constructor(
    private readonly bridge: AvatarBridge,
    profiles: AvatarOption[],
    activeId?: string,
    private readonly speakerFor?: (profile: AvatarOption) => Speaker | undefined,
  ) {
    this.profiles = profiles.length > 0 ? profiles : [fallbackProfile()];
    this.active = this.profiles.find((p) => p.id === activeId) ?? this.profiles[0]!;
    this.speaker = speakerFor?.(this.active);
    // Lo que el usuario teclee en el chat del avatar se guarda para que el
    // agente externo lo recoja cuando quiera (tool leer_mensajes).
    bridge.onTextInput((texto) => this.inbox.push({ texto, ts: Date.now() }));
    bridge.onClientConnect(() => this.presentar());
    // La UI conectada a la fachada esta AUTENTICADA: sus send() devuelven true
    // y no encolan nada, asi que ignorar config/avatar-config la dejaria
    // creyendo aplicado lo que nadie gestiono. Cambiar de avatar SI es una
    // capacidad de la cara y se atiende; el resto se rechaza con config-error
    // (la UI ya lo pinta) y se reenvia el estado autoritativo.
    bridge.onConfigMessage((msg) => {
      const s = msg.settings;
      if (s.agent && s.agent !== this.active.id) {
        try {
          this.cambiarAvatar(s.agent);
        } catch (err) {
          // Eco del campo rechazado: es el veredicto que saca el parche de la
          // cola persistida de la UI (sin el, se reintentaria por siempre).
          this.bridge.broadcast({
            type: 'config-error',
            message: (err as Error).message,
            settings: { agent: s.agent },
          });
          this.sendAvatars();
        }
      }
      if (s.micEnabled !== undefined || s.audioDevice !== undefined) {
        this.bridge.broadcast({
          type: 'config-error',
          message:
            'esta cara la conduce un agente externo; el microfono y el audio se gestionan con el motor real',
          settings: {
            ...(s.micEnabled !== undefined ? { micEnabled: s.micEnabled } : {}),
            ...(s.audioDevice !== undefined ? { audioDevice: s.audioDevice } : {}),
          },
        });
        // La UI ya cambio su boton en optimista al pulsar: el estado
        // autoritativo lo revierte — aqui el micro no existe, siempre off.
        this.bridge.broadcast({ type: 'mic', enabled: false });
      }
    });
    bridge.onAvatarConfigMessage((msg) => {
      // Con avatarId y requestId, como el motor real: el rechazo cae sobre LA
      // peticion de la cola de la UI, que si no la reenviaria en cada
      // reconexion (y un motor real posterior podria aplicarla inesperadamente).
      this.bridge.broadcast({
        type: 'config-error',
        message: 'los perfiles (modelo, voz, confidencial) se editan con el motor real conectado',
        avatarId: msg.avatarId,
        ...(msg.requestId !== undefined ? { requestId: msg.requestId } : {}),
      });
      this.sendAvatars();
    });
  }

  /**
   * Todo lo que un avatar recien autenticado espera del "motor". Las listas de
   * microfonos, voces y modelos van vacias: la UI ya pinta "(motor no
   * conectado)" en esos menus, que es la verdad — esta fachada no captura ni
   * reconfigura, solo da la cara.
   */
  presentar(): void {
    // Estado autoritativo del micro, lo primero (como hace el motor): esta
    // fachada NO captura nunca, y la cache de la UI puede venir de una sesion
    // con el motor real mostrando "Escuchando" sobre una captura que no existe.
    this.bridge.broadcast({ type: 'mic', enabled: false });
    // Y la pose ACTUAL: un cliente que llega (o reconecta) a mitad de un
    // "pensando" largo se quedaria con su pose por defecto hasta el siguiente
    // cambio — las difusiones anteriores a su conexion no existen para el.
    this.bridge.broadcast({ type: 'state', state: this.poseActual });
    this.sendAvatars();
    this.bridge.broadcast({ type: 'devices', inputs: [] });
    this.bridge.broadcast({ type: 'voices', list: [] });
    this.bridge.broadcast({ type: 'models', list: [] });
  }

  private sendAvatars(): void {
    // Los perfiles YA son AvatarOption (el tipo del cable): viajan tal cual.
    this.bridge.broadcast({ type: 'avatars', list: [...this.profiles], current: this.active.id });
  }

  /** Pose actual: para saludar con ella a un cliente que llegue tarde. */
  private poseActual: AvatarWireState = 'reposo';

  /** Estado del orbe/pose. La UI lo anima; aqui solo se difunde. */
  estado(state: AvatarWireState): void {
    this.poseActual = state;
    this.bridge.broadcast({ type: 'state', state });
  }

  /** Turno de habla en curso: las peticiones concurrentes se encolan detras. */
  private turno: Promise<void> = Promise.resolve();

  /**
   * La coreografia completa de hablar: pose de hablando, texto en el
   * bocadillo, gesto opcional, voz si la hay (se espera a que termine de
   * sonar) y vuelta a reposo — pase lo que pase con el TTS.
   *
   * SERIALIZADO: un agente puede despachar dos `decir` a la vez, y el Speaker
   * solo controla un proceso hijo — sin cola, los audios se solapaban y el
   * primero en terminar mandaba `reposo` con el otro aun hablando.
   */
  decir(texto: string, opts: { gesto?: AvatarGesture } = {}): Promise<void> {
    const trabajo = this.turno.then(() => this.decirAhora(texto, opts));
    // La cola nunca se rompe: el fallo se propaga al llamante, no al siguiente.
    this.turno = trabajo.catch(() => {});
    return trabajo;
  }

  private async decirAhora(texto: string, opts: { gesto?: AvatarGesture }): Promise<void> {
    const clean = texto.trim();
    if (!clean) return;
    this.estado('hablando');
    this.bridge.broadcast({ type: 'assistant', text: clean });
    if (opts.gesto) this.bridge.broadcast({ type: 'gesture', gesture: opts.gesto });
    // La voz se captura AHORA: si el avatar cambia a mitad de frase, esta
    // sigue siendo la que suena y detener() debe poder alcanzarla.
    const voz = this.speaker;
    if (voz) this.vocesEnVuelo.add(voz);
    try {
      await voz?.speak(clean);
    } finally {
      if (voz) this.vocesEnVuelo.delete(voz);
      this.estado('reposo');
    }
  }

  /** Agita la mano; con texto, ademas lo dice. */
  async saludar(texto?: string): Promise<void> {
    if (texto?.trim()) {
      await this.decir(texto, { gesto: 'saludo' });
      return;
    }
    this.bridge.broadcast({ type: 'gesture', gesture: 'saludo' });
  }

  /** Cambia el avatar activo y lo anuncia (la UI cambia retrato y color). */
  cambiarAvatar(id: string): AvatarOption {
    const next = this.profiles.find((p) => p.id === id);
    if (!next) {
      throw new Error(
        `avatar desconocido: "${id}" (disponibles: ${this.profiles.map((p) => p.id).join(', ')})`,
      );
    }
    this.active = next;
    // La voz pertenece al PERFIL: se recrea con la del nuevo (si no, Nexus
    // seguiria hablando con la voz y el ritmo de Unit-A). La cola de habla no
    // se corta; lo que quede en ella sale ya con la voz nueva. Si la
    // sustituida esta sonando, vocesEnVuelo la mantiene al alcance de
    // detener() hasta que su frase se asiente.
    if (this.speakerFor) this.speaker = this.speakerFor(next);
    this.sendAvatars();
    return next;
  }

  /** Drena los mensajes escritos pendientes (se entregan una sola vez). */
  leerMensajes(): FaceMessage[] {
    const out = this.inbox;
    this.inbox = [];
    return out;
  }

  /** Corta la voz vigente y cualquiera con habla en vuelo (apagado). */
  detener(): void {
    this.speaker?.stop();
    for (const voz of this.vocesEnVuelo) {
      try {
        voz.stop();
      } catch {
        // cortar cada voz es cortesia; una que falle no protege a las demas
      }
    }
  }

  get activo(): AvatarOption {
    return this.active;
  }

  avatares(): AvatarOption[] {
    return this.profiles;
  }
}
