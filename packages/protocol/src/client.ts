import net from 'node:net';
import { readFileSync } from 'node:fs';
import { AVATAR_BRIDGE_PORT, bridgeTokenPathFor } from './constants.js';
import { takeLines } from './framing.js';
import {
  PROTOCOL_VERSION,
  type AvatarConfigMessage,
  type ConfigMessage,
  type EngineToAvatarMessage,
  type TextInputMessage,
} from './messages.js';

/**
 * Puente motor <-> avatar, lado cliente. Se conecta al socket TCP local que
 * abre el servidor y recibe estado y texto, un JSON por linea. Reconecta solo,
 * asi que da igual quien arranque antes y sobrevive a que el motor se reinicie.
 *
 * El servidor exige un token de sesion: se lee del fichero que deja y se manda
 * como handshake al conectar. Sin token valido, el servidor ignora todo.
 */

/**
 * Puerto del servidor. Se puede cambiar con ALPHA_BRIDGE_PORT, la MISMA
 * variable que usa el motor: sin esto, levantar una segunda instancia con otro
 * puerto dejaba su avatar sin forma de conectarse.
 */
const PORT = Number(process.env['ALPHA_BRIDGE_PORT']) || AVATAR_BRIDGE_PORT;

function readToken(): string {
  try {
    return readFileSync(bridgeTokenPathFor(PORT), 'utf8').trim();
  } catch {
    return '';
  }
}

export interface BridgeHandle {
  /** Envia la config al motor. Devuelve false si aun no hay motor autenticado:
   *  el llamante decide si guardar el cambio para reenviarlo al conectar (un
   *  mute descartado en silencio seria una promesa de privacidad rota). */
  send(msg: ConfigMessage | AvatarConfigMessage): boolean;
  /** Envia un mensaje escrito. Devuelve false si el motor no lo va a recibir. */
  sendText(text: string): boolean;
  /** true si el motor ya acuso el handshake. */
  isReady(): boolean;
  close(): void;
}

export function connectBridge(onMessage: (msg: EngineToAvatarMessage) => void): BridgeHandle {
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
      if (token) s.write(JSON.stringify({ type: 'auth', token, version: PROTOCOL_VERSION }) + '\n');
    });

    s.on('data', (chunk: Buffer) => {
      const { lines, rest } = takeLines(buffer + chunk.toString('utf8'));
      buffer = rest;
      for (const line of lines) {
        try {
          const msg = JSON.parse(line) as EngineToAvatarMessage;
          if (msg.type === 'ready') {
            ready = true;
            // Versiones dispares no cortan nada (los mensajes desconocidos se
            // ignoran), pero se dicen: un desajuste mudo es indepurable.
            if (msg.version !== PROTOCOL_VERSION)
              console.warn(
                `[puente] protocolo del motor v${msg.version} != v${PROTOCOL_VERSION} del avatar; conviene actualizar ambos lados`,
              );
          }
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
    send(msg: ConfigMessage | AvatarConfigMessage): boolean {
      if (!usable()) return false;
      socket?.write(JSON.stringify(msg) + '\n');
      return true;
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
