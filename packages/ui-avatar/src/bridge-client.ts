import net from 'node:net';

/**
 * Cliente del puente con el motor. Se conecta al socket TCP local que abre el
 * motor y recibe estado y texto, un JSON por linea. Reconecta solo, asi que da
 * igual quien arranque antes y sobrevive a que el motor se reinicie.
 */

// Debe coincidir con AVATAR_BRIDGE_PORT del motor.
const PORT = 43117;

export type BridgeMessage =
  | { type: 'state'; state: 'reposo' | 'escuchando' | 'pensando' | 'hablando' }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'devices'; inputs: { name: string; isDefault: boolean }[]; current?: string };

/** Avatar -> motor: la config elegida en el menu. */
export interface ConfigMessage {
  type: 'config';
  settings: { agent?: string; model?: string; confidential?: boolean; audioDevice?: string };
}

export interface BridgeHandle {
  /** Envia la config al motor. Si no hay conexion, se ignora (el motor la leera
   *  del fichero al arrancar). */
  send(msg: ConfigMessage): void;
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
    close() {
      closed = true;
      socket?.destroy();
    },
  };
}
