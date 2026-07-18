import net from 'node:net';
import type { ConversationState } from './session.js';

/**
 * Puente motor -> avatar. Los dos son procesos Node separados (el motor con
 * tsx, el avatar con qode), asi que se hablan por un socket TCP local con un
 * mensaje JSON por linea. Sin dependencias ni WebSocket.
 *
 * De momento es unidireccional: el motor difunde estado y texto, el avatar los
 * refleja. Mas adelante el avatar podra mandar comandos (empezar/parar, cambiar
 * de modelo) por el mismo canal.
 */

/** Puerto fijo en localhost. Alto y poco comun para no chocar. */
export const AVATAR_BRIDGE_PORT = 43117;

/** Motor -> avatar: estado, texto y lista de microfonos disponibles. */
export type AvatarMessage =
  | { type: 'state'; state: ConversationState | 'reposo' }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string }
  | { type: 'devices'; inputs: { name: string; isDefault: boolean }[]; current?: string };

/** Avatar -> motor: cambios de configuracion desde el menu. */
export interface AlphaConfigMessage {
  type: 'config';
  settings: { agent?: string; model?: string; confidential?: boolean; audioDevice?: string };
}

export class AvatarBridge {
  private server: net.Server | undefined;
  private readonly clients = new Set<net.Socket>();
  private readonly onConfig: ((msg: AlphaConfigMessage) => void)[] = [];
  private readonly onConnect: (() => void)[] = [];

  /** Se suscribe a los cambios de config que manda el avatar. */
  onConfigMessage(handler: (msg: AlphaConfigMessage) => void): void {
    this.onConfig.push(handler);
  }

  /** Se suscribe a la conexion de un avatar (para mandarle el estado inicial). */
  onClientConnect(handler: () => void): void {
    this.onConnect.push(handler);
  }

  /** Arranca el servidor. Resuelve cuando escucha (o si el puerto esta ocupado). */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        this.clients.add(socket);
        this.readFrom(socket);
        socket.on('close', () => this.clients.delete(socket));
        socket.on('error', () => this.clients.delete(socket));
        for (const h of this.onConnect) h();
      });
      // Solo localhost: nada de exponerlo a la red.
      server.listen(AVATAR_BRIDGE_PORT, '127.0.0.1', () => resolve());
      server.on('error', () => resolve()); // si el puerto esta ocupado, seguimos sin avatar
      this.server = server;
    });
  }

  /** Lee mensajes entrantes del avatar (JSON por linea) y despacha los de config. */
  private readFrom(socket: net.Socket): void {
    let buffer = '';
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let nl: number;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as AlphaConfigMessage;
          if (msg.type === 'config') for (const h of this.onConfig) h(msg);
        } catch {
          // linea corrupta: ignorar
        }
      }
    });
  }

  broadcast(message: AvatarMessage): void {
    const line = JSON.stringify(message) + '\n';
    for (const socket of this.clients) {
      if (socket.writable) socket.write(line);
    }
  }

  stop(): void {
    for (const socket of this.clients) socket.destroy();
    this.clients.clear();
    this.server?.close();
  }
}
