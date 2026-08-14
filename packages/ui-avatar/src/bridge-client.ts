import net from 'node:net';
import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Cliente del puente con el motor. Se conecta al socket TCP local que abre el
 * motor y recibe estado y texto, un JSON por linea. Reconecta solo, asi que da
 * igual quien arranque antes y sobrevive a que el motor se reinicie.
 *
 * El motor exige un token de sesion: se lee del fichero que deja y se manda como
 * handshake al conectar. Sin token valido, el motor ignora todo.
 */

// Debe coincidir con AVATAR_BRIDGE_PORT del motor.
const DEFAULT_PORT = 43117;
/**
 * Puerto del motor. Se puede cambiar con ALPHA_BRIDGE_PORT, la MISMA variable
 * que usa el motor: sin esto, levantar una segunda instancia con otro puerto
 * dejaba su avatar sin forma de conectarse.
 */
const PORT = Number(process.env['ALPHA_BRIDGE_PORT']) || DEFAULT_PORT;

/**
 * Nombre del fichero de token para un puerto. Va ATADO AL PUERTO (igual que
 * bridgeTokenPathFor en el motor): dos instancias que compartieran fichero se
 * invalidarian la autenticacion mutuamente. El puerto por defecto conserva el
 * nombre de siempre.
 */
export function tokenFileFor(port: number): string {
  return port === DEFAULT_PORT ? 'alpha.bridge-token' : `alpha.bridge-token.${port}`;
}

// dist/bridge-client.js -> repoRoot: tres niveles arriba.
const tokenPath = path.resolve(__dirname, '..', '..', '..', 'config', tokenFileFor(PORT));

function readToken(): string {
  try {
    return readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return '';
  }
}

/**
 * Saca del buffer las lineas COMPLETAS y devuelve lo que queda a medias.
 *
 * TCP no respeta los limites de mensaje: un JSON puede llegar partido en dos
 * chunks, o dos JSON juntos en uno. Sin conservar el resto, el avatar se comia
 * mensajes en cuanto el motor mandaba varios seguidos (la lista de voces son
 * ~120 entradas y no cabe en un chunk).
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let nl: number;
  while ((nl = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (line) lines.push(line);
  }
  return { lines, rest };
}

/** Perfil de avatar tal como lo manda el motor (el dueno de los perfiles). */
export interface AvatarOption {
  id: string;
  name: string;
  role: string;
  /** Privacidad: solo recursos locales. En confidencial solo se ofrecen estos. */
  local: boolean;
  /** Ruta absoluta de la imagen. */
  image: string;
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

export type BridgeMessage =
  /** Acuse del handshake: a partir de aqui el motor nos escucha de verdad. */
  | { type: 'ready' }
  | { type: 'state'; state: 'reposo' | 'escuchando' | 'pensando' | 'hablando' }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'devices'; inputs: { name: string; isDefault: boolean }[]; current?: string }
  | { type: 'avatars'; list: AvatarOption[]; current?: string }
  | { type: 'voices'; list: VoiceOption[] };

/** Avatar -> motor: la config elegida en el menu. */
export interface ConfigMessage {
  type: 'config';
  settings: {
    agent?: string;
    model?: string;
    confidential?: boolean;
    audioDevice?: string;
    micEnabled?: boolean;
    /** Voz del avatar: "sapi:..." o "edge:...". */
    voiceId?: string;
  };
}

/** Avatar -> motor: un mensaje escrito. */
export interface TextInputMessage {
  type: 'text-input';
  text: string;
}

export interface BridgeHandle {
  /** Envia la config al motor. Si no esta autenticado, se ignora (el motor la
   *  leera del fichero al arrancar). */
  send(msg: ConfigMessage): void;
  /** Envia un mensaje escrito. Devuelve false si el motor no lo va a recibir. */
  sendText(text: string): boolean;
  /** true si el motor ya acuso el handshake. */
  isReady(): boolean;
  close(): void;
}

export function connectBridge(onMessage: (msg: BridgeMessage) => void): BridgeHandle {
  let socket: net.Socket | undefined;
  let buffer = '';
  let closed = false;
  /**
   * El motor nos ha acusado el handshake. Un socket escribible NO basta: entre
   * conectar y autenticarse el motor tira todo lo que llega, y sin este acuse
   * sendText decia "enviado" sobre mensajes que se perdian.
   */
  let ready = false;

  const connect = () => {
    if (closed) return;
    const s = net.connect(PORT, '127.0.0.1');
    socket = s;
    ready = false;

    // Handshake: el token se relee en cada conexion porque el motor genera uno
    // nuevo en cada arranque.
    s.on('connect', () => {
      const token = readToken();
      if (token) s.write(JSON.stringify({ type: 'auth', token }) + '\n');
    });

    s.on('data', (chunk: Buffer) => {
      const { lines, rest } = takeLines(buffer + chunk.toString('utf8'));
      buffer = rest;
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as BridgeMessage;
          if (msg.type === 'ready') ready = true;
          onMessage(msg);
        } catch {
          // linea corrupta: ignorar, no tumbar el avatar
        }
      }
    });

    // 'error' siempre lo sigue un 'close'; se reintenta ahi, una sola vez.
    s.on('error', () => {});
    s.on('close', () => {
      buffer = '';
      ready = false;
      if (!closed) setTimeout(connect, 1000);
    });
  };

  const usable = () => ready && socket?.writable === true;

  connect();
  return {
    send(msg: ConfigMessage) {
      if (usable()) socket?.write(JSON.stringify(msg) + '\n');
    },
    sendText(text: string): boolean {
      if (!usable()) return false;
      const msg: TextInputMessage = { type: 'text-input', text };
      socket?.write(JSON.stringify(msg) + '\n');
      return true;
    },
    isReady: usable,
    close() {
      closed = true;
      socket?.destroy();
    },
  };
}
