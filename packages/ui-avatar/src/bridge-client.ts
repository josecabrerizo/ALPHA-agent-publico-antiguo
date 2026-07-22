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
const PORT = 43117;
// dist/bridge-client.js -> repoRoot: tres niveles arriba.
const tokenPath = path.resolve(__dirname, '..', '..', '..', 'config', 'alpha.bridge-token');

function readToken(): string {
  try {
    return readFileSync(tokenPath, 'utf8').trim();
  } catch {
    return '';
  }
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
  /** Envia la config al motor. Si no hay conexion, se ignora (el motor la leera
   *  del fichero al arrancar). */
  send(msg: ConfigMessage): void;
  /** Envia un mensaje escrito. Devuelve false si no hay motor conectado. */
  sendText(text: string): boolean;
  close(): void;
}

export function connectBridge(onMessage: (msg: BridgeMessage) => void): BridgeHandle {
  let socket: net.Socket | undefined;
  let buffer = '';
  let closed = false;

  const connect = () => {
    if (closed) return;
    const s = net.connect(PORT, '127.0.0.1');
    socket = s;

    // Handshake: el token se relee en cada conexion porque el motor genera uno
    // nuevo en cada arranque.
    s.on('connect', () => {
      const token = readToken();
      if (token) s.write(JSON.stringify({ type: 'auth', token }) + '\n');
    });

    s.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          onMessage(JSON.parse(line) as BridgeMessage);
        } catch {
          // linea corrupta: ignorar, no tumbar el avatar
        }
      }
    });

    // 'error' siempre lo sigue un 'close'; se reintenta ahi, una sola vez.
    s.on('error', () => {});
    s.on('close', () => {
      buffer = '';
      if (!closed) setTimeout(connect, 1000);
    });
  };

  connect();
  return {
    send(msg: ConfigMessage) {
      if (socket?.writable) socket.write(JSON.stringify(msg) + '\n');
    },
    sendText(text: string): boolean {
      if (!socket?.writable) return false;
      const msg: TextInputMessage = { type: 'text-input', text };
      socket.write(JSON.stringify(msg) + '\n');
      return true;
    },
    close() {
      closed = true;
      socket?.destroy();
    },
  };
}
