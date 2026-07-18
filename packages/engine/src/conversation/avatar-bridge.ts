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

export type AvatarMessage =
  | { type: 'state'; state: ConversationState | 'reposo' }
  | { type: 'user'; text: string }
  | { type: 'assistant'; text: string };

export class AvatarBridge {
  private server: net.Server | undefined;
  private readonly clients = new Set<net.Socket>();

  /** Arranca el servidor. Resuelve cuando escucha (o si el puerto esta ocupado). */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        this.clients.add(socket);
        socket.on('close', () => this.clients.delete(socket));
        socket.on('error', () => this.clients.delete(socket));
      });
      // Solo localhost: nada de exponerlo a la red.
      server.listen(AVATAR_BRIDGE_PORT, '127.0.0.1', () => resolve());
      server.on('error', () => resolve()); // si el puerto esta ocupado, seguimos sin avatar
      this.server = server;
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
