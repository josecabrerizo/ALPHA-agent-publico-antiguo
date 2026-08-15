import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { ConversationState } from './session.js';
import { repoRoot } from '../paths.js';

/**
 * Puente motor <-> avatar. Los dos son procesos Node separados (el motor con
 * tsx, el avatar con qode), asi que se hablan por un socket TCP local con un
 * mensaje JSON por linea. Sin dependencias ni WebSocket.
 *
 * Endurecido: escucha solo en 127.0.0.1, pero cualquier proceso del equipo
 * podria conectar. Por eso exige un TOKEN de sesion (handshake) antes de
 * aceptar comandos o recibir datos, valida cada mensaje y limita su tamano.
 */

/** Puerto fijo en localhost. Alto y poco comun para no chocar. */
export const AVATAR_BRIDGE_PORT = 43117;

/**
 * Fichero donde el motor deja el token para que el avatar lo lea. Va ATADO AL
 * PUERTO: dos instancias en la misma maquina escuchan en puertos distintos, y
 * si compartieran fichero la segunda invalidaria la autenticacion de la
 * primera (el avatar releeria el token nuevo y el motor viejo lo rechazaria).
 * El puerto por defecto conserva el nombre de siempre.
 */
export function bridgeTokenPathFor(port: number = AVATAR_BRIDGE_PORT): string {
  const suffix = port === AVATAR_BRIDGE_PORT ? '' : `.${port}`;
  return path.join(repoRoot, 'config', `alpha.bridge-token${suffix}`);
}

/** Fichero del puerto por defecto. */
export const bridgeTokenPath = bridgeTokenPathFor();

/** Tope de una linea sin salto: por encima, la conexion es basura y se corta. */
const MAX_LINE = 64 * 1024;
/** Tope de un mensaje escrito. */
const MAX_TEXT = 8_000;
/** Tope de los valores de config (nombres de modelo/dispositivo). */
const MAX_FIELD = 256;

/** Un perfil de avatar, tal como lo necesita la UI para pintar su menu. */
export interface AvatarOption {
  id: string;
  name: string;
  role: string;
  /** Modelo, voz y privacidad pertenecen al perfil, no a la UI global. */
  model: string;
  confidential: boolean;
  voice: { engine: 'sapi' | 'edge'; name: string; rate: number };
  /** Ruta absoluta de la imagen (mismo equipo, otro proceso). */
  image: string;
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
  /** Motort: 'sapi' = local, 'edge' = nube de Microsoft. */
  engine: 'sapi' | 'edge';
  /** true = solo recursos de la máquina; false = necesita internet. */
  local: boolean;
}

/** Motor -> avatar: estado, texto, microfonos, voces y perfiles de avatar. */
export type AvatarMessage =
  /** Acuse del handshake: hasta recibirlo, el avatar no esta autenticado. */
  | { type: 'ready' }
  | { type: 'state'; state: ConversationState | 'reposo' }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'devices'; inputs: { name: string; isDefault: boolean }[]; current?: string }
  | { type: 'avatars'; list: AvatarOption[]; current?: string }
  | { type: 'voices'; list: VoiceOption[] }
  | { type: 'models'; list: ModelOption[] }
  | { type: 'config-error'; message: string };

/** Avatar -> motor: cambios de configuracion desde el menu. */
export interface AlphaConfigMessage {
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
export interface AlphaTextMessage {
  type: 'text-input';
  text: string;
}

export class AvatarBridge {
  private server: net.Server | undefined;
  /** Solo los clientes autenticados; reciben datos y pueden mandar comandos. */
  private readonly authed = new Set<net.Socket>();
  private readonly onConfig: ((msg: AlphaConfigMessage) => void)[] = [];
  private readonly onAvatarConfig: ((msg: AvatarConfigMessage) => void)[] = [];
  private readonly onText: ((text: string) => void)[] = [];
  private readonly onConnect: (() => void)[] = [];
  private token = '';

  /** Puerto configurable para poder aislar los tests del puerto real. */
  constructor(private readonly port: number = AVATAR_BRIDGE_PORT) {}

  onConfigMessage(handler: (msg: AlphaConfigMessage) => void): void {
    this.onConfig.push(handler);
  }
  onTextInput(handler: (text: string) => void): void {
    this.onText.push(handler);
  }
  onAvatarConfigMessage(handler: (msg: AvatarConfigMessage) => void): void {
    this.onAvatarConfig.push(handler);
  }
  /** Se dispara cuando un avatar se autentica (para mandarle el estado inicial). */
  onClientConnect(handler: () => void): void {
    this.onConnect.push(handler);
  }

  /** true si quedo escuchando; false si el puerto estaba ocupado. */
  async start(): Promise<boolean> {
    // PRIMERO el puerto, DESPUES el token. Al reves, un segundo motor que se
    // encontraba el puerto ocupado ya habia pisado el fichero: el avatar releia
    // ese token nuevo al reconectar y el motor original —el unico que de verdad
    // escuchaba— lo rechazaba, dejando el avatar mudo sin explicacion.
    const listening = await new Promise<boolean>((resolve) => {
      const server = net.createServer((socket) => {
        this.readFrom(socket);
        socket.on('close', () => this.authed.delete(socket));
        socket.on('error', () => this.authed.delete(socket));
      });
      // Puerto ocupado (tipico: ya hay otro motor corriendo). Se sigue sin
      // avatar, pero se DICE: antes se anunciaba "escuchando" igualmente y el
      // segundo motor quedaba mudo sin que nada lo delatara.
      server.once('error', () => resolve(false));
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server;
        resolve(true);
      });
    });
    if (!listening) return false;

    // Token nuevo cada arranque, escrito a un fichero que solo el usuario lee.
    this.token = randomBytes(24).toString('hex');
    this.writeToken();
    return true;
  }

  /**
   * Deja el token en disco. Se escribe a un temporal y se renombra encima: el
   * avatar puede estar leyendolo justo ahora, y un rename es atomico, asi que
   * nunca ve un token a medias.
   */
  private writeToken(): void {
    const file = bridgeTokenPathFor(this.port);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(tmp, this.token, { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, file);
    } catch {
      // Si no se puede escribir el token, el avatar no podra autenticarse; se
      // sigue arrancando (el motor funciona sin avatar).
      try {
        rmSync(tmp, { force: true });
      } catch {
        // el temporal se queda; no es motivo para tumbar el arranque
      }
    }
  }

  private readFrom(socket: net.Socket): void {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      // Linea gigantesca sin salto = basura o intento de agotar memoria: fuera.
      if (buffer.length > MAX_LINE && !buffer.includes('\n')) {
        socket.destroy();
        return;
      }
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (line) this.handleLine(socket, line);
      }
    });
  }

  private handleLine(socket: net.Socket, line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      return; // linea corrupta
    }
    if (!msg || typeof msg !== 'object') return;
    const m = msg as Record<string, unknown>;

    // Hasta autenticarse, lo unico que se acepta es el handshake.
    if (!this.authed.has(socket)) {
      if (m['type'] === 'auth' && typeof m['token'] === 'string' && this.tokenMatches(m['token'])) {
        this.authed.add(socket);
        // Acuse explicito: sin el, la UI no puede distinguir "socket abierto"
        // de "motor escuchandome", y daba por enviado lo que se tiraba.
        if (socket.writable) socket.write(JSON.stringify({ type: 'ready' }) + '\n');
        for (const h of this.onConnect) h();
      }
      return;
    }

    if (m['type'] === 'config') {
      const settings = sanitizeSettings(m['settings']);
      if (settings) for (const h of this.onConfig) h({ type: 'config', settings });
    } else if (
      m['type'] === 'avatar-config' &&
      typeof m['avatarId'] === 'string' &&
      m['avatarId'].length <= MAX_FIELD
    ) {
      const settings = sanitizeAvatarSettings(m['settings']);
      if (settings) {
        const message: AvatarConfigMessage = {
          type: 'avatar-config',
          avatarId: m['avatarId'],
          settings,
        };
        for (const h of this.onAvatarConfig) h(message);
      }
    } else if (m['type'] === 'text-input' && typeof m['text'] === 'string') {
      const text = m['text'].slice(0, MAX_TEXT);
      if (text.trim()) for (const h of this.onText) h(text);
    }
  }

  /** Comparacion en tiempo constante para no filtrar el token por timing. */
  private tokenMatches(candidate: string): boolean {
    // Sin token (arranque fallido o puente ya parado) no autentica NADIE: si no,
    // un "token": "" entrante empataria con la cadena vacia y entraria.
    if (!this.token) return false;
    if (candidate.length !== this.token.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++)
      diff |= candidate.charCodeAt(i) ^ this.token.charCodeAt(i);
    return diff === 0;
  }

  broadcast(message: AvatarMessage): void {
    const line = JSON.stringify(message) + '\n';
    for (const socket of this.authed) {
      if (socket.writable) socket.write(line);
    }
  }

  stop(): void {
    for (const socket of this.authed) socket.destroy();
    this.authed.clear();
    this.server?.close();
    this.server = undefined;
    // El token es un secreto de SESION: sin servidor detras ya no vale para
    // nada, asi que no se deja en disco.
    if (this.token) {
      try {
        rmSync(bridgeTokenPathFor(this.port), { force: true });
      } catch {
        // borrar es cortesia; no puede impedir el cierre
      }
      this.token = '';
    }
  }
}

/** Valida y recorta la config entrante; descarta lo que no cuadre. */
function sanitizeSettings(value: unknown): AlphaConfigMessage['settings'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const out: AlphaConfigMessage['settings'] = {};
  if (typeof v['agent'] === 'string') out.agent = v['agent'].slice(0, MAX_FIELD);
  if (typeof v['audioDevice'] === 'string') out.audioDevice = v['audioDevice'].slice(0, MAX_FIELD);
  if (typeof v['micEnabled'] === 'boolean') out.micEnabled = v['micEnabled'];
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeAvatarSettings(value: unknown): AvatarConfigMessage['settings'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const out: AvatarConfigMessage['settings'] = {};
  if (typeof v['model'] === 'string') out.model = v['model'].slice(0, MAX_FIELD);
  if (typeof v['voiceId'] === 'string') out.voiceId = v['voiceId'].slice(0, MAX_FIELD);
  if (typeof v['confidential'] === 'boolean') out.confidential = v['confidential'];
  return Object.keys(out).length > 0 ? out : undefined;
}
