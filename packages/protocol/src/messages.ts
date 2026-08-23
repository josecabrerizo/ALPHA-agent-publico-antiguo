/**
 * Mensajes del puente motor <-> avatar: UNA definicion para los dos procesos.
 * Antes cada lado llevaba su copia escrita a mano (y ya habian divergido en
 * los comentarios); cualquier cambio de forma se hace aqui y lo ven ambos al
 * compilar.
 */

/**
 * Version del protocolo. Viaja en el handshake (auth y ready) para que un
 * motor y un avatar de versiones distintas se delaten con un aviso en vez de
 * fallar mudos. Subirla solo cuando cambie la FORMA de un mensaje existente.
 *
 * v2: AvatarOption pasa de `image` (ruta absoluta) a `imageId` + `color`.
 */
export const PROTOCOL_VERSION = 2;

/** Estados que la UI sabe pintar. El motor mapea aqui su estado interno. */
export type AvatarWireState = 'reposo' | 'escuchando' | 'pensando' | 'hablando';

/** Gestos puntuales del personaje. Un gesto ocurre una vez; no es un estado. */
export type AvatarGesture = 'saludo';

/** Color RGB (0..255) del orbe de identidad. */
export type OrbColor = [number, number, number];

/**
 * Color neutro para un perfil que no declara el suyo: un gris azulado que NO
 * es el de ningun avatar fundador, para que "sin color declarado" se vea como
 * tal y no se disfrace de otra identidad.
 */
export const DEFAULT_ORB_COLOR: OrbColor = [150, 160, 175];

/** Un perfil de avatar, tal como lo necesita la UI para pintar su menu. */
export interface AvatarOption {
  id: string;
  name: string;
  role: string;
  /** Modelo, voz y privacidad pertenecen al perfil, no a la UI global. */
  model: string;
  confidential: boolean;
  voice: { engine: 'sapi' | 'edge'; name: string; rate: number };
  /**
   * Identificador del juego de arte (retrato y poses), NO una ruta: la UI lo
   * resuelve contra su propia carpeta de assets. Antes viajaba una ruta
   * absoluta, que ataba a motor y avatar al mismo checkout.
   */
  imageId: string;
  /** Color de identidad del orbe. */
  color: OrbColor;
}

/** Modelo que el motor puede resolver y ofrecer en el menu. */
export interface ModelOption {
  ref: string;
  label: string;
  local: boolean;
}

/** Voz disponible para elegir en el avatar. */
export interface VoiceOption {
  /** Identificador único: engine:name. */
  id: string;
  /** Nombre para mostrar. */
  name: string;
  /** Motor: 'sapi' = local, 'edge' = nube de Microsoft. */
  engine: 'sapi' | 'edge';
  /** true = solo recursos de la máquina; false = necesita internet. */
  local: boolean;
}

/** Motor -> avatar: estado, texto, microfonos, voces y perfiles de avatar. */
export type EngineToAvatarMessage =
  /** Acuse del handshake: hasta recibirlo, el avatar no esta autenticado. */
  | { type: 'ready'; version: number }
  | { type: 'state'; state: AvatarWireState }
  /** Gesto puntual decidido por el MOTOR (la UI no infiere nada del texto). */
  | { type: 'gesture'; gesture: AvatarGesture }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'devices'; inputs: { name: string; isDefault: boolean }[]; current?: string }
  | { type: 'avatars'; list: AvatarOption[]; current?: string }
  | { type: 'voices'; list: VoiceOption[] }
  | { type: 'models'; list: ModelOption[] }
  | { type: 'config-error'; message: string };

/** Avatar -> motor: handshake. El token sale del fichero que deja el motor. */
export interface AuthMessage {
  type: 'auth';
  token: string;
  /** Version del protocolo del cliente. El servidor no rechaza por ella. */
  version?: number;
}

/** Avatar -> motor: cambios de configuracion desde el menu. */
export interface ConfigMessage {
  type: 'config';
  settings: {
    agent?: string;
    audioDevice?: string;
    /** false = microfono silenciado (se cierra la captura). */
    micEnabled?: boolean;
  };
}

/** Cambia y persiste opciones que pertenecen a un perfil de avatars.yaml. */
export interface AvatarConfigMessage {
  type: 'avatar-config';
  avatarId: string;
  settings: {
    model?: string;
    confidential?: boolean;
    /** Voz del perfil: "sapi:..." o "edge:...". */
    voiceId?: string;
  };
}

/** Avatar -> motor: mensaje escrito (chat de texto). */
export interface TextInputMessage {
  type: 'text-input';
  text: string;
}

/** Avatar -> motor: todo lo que el motor acepta por el socket. */
export type AvatarToEngineMessage =
  AuthMessage | ConfigMessage | AvatarConfigMessage | TextInputMessage;
