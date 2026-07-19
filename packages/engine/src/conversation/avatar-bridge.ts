import net from 'node:net';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
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

/** Fichero donde el motor deja el token para que el avatar lo lea. */
export const bridgeTokenPath = path.join(repoRoot, 'config', 'alpha.bridge-token');

/** Tope de una linea sin salto: por encima, la conexion es basura y se corta. */
const MAX_LINE = 64 * 1024;
/** Tope de un mensaje escrito. */
const MAX_TEXT = 8_000;
/** Tope de los valores de config (nombres de modelo/dispositivo). */
const MAX_FIELD = 256;

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
  /** Se dispara cuando un avatar se autentica (para mandarle el estado inicial). */
  onClientConnect(handler: () => void): void {
    this.onConnect.push(handler);
  }

  async start(): Promise<void> {
    // Token nuevo cada arranque, escrito a un fichero que solo el usuario lee.
    this.token = randomBytes(24).toString('hex');
    try {
      mkdirSync(path.dirname(bridgeTokenPath), { recursive: true });
      writeFileSync(bridgeTokenPath, this.token, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // Si no se puede escribir el token, el avatar no podra autenticarse; se
      // sigue arrancando (el motor funciona sin avatar).
    }

    return new Promise((resolve) => {
      const server = net.createServer((socket) => {
        this.readFrom(socket);
        socket.on('close', () => this.authed.delete(socket));
        socket.on('error', () => this.authed.delete(socket));
      });
      server.listen(this.port, '127.0.0.1', () => resolve());
      server.on('error', () => resolve()); // puerto ocupado: seguimos sin avatar
      this.server = server;
    });
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
        for (const h of this.onConnect) h();
      }
      return;
    }

    if (m['type'] === 'config') {
      const settings = sanitizeSettings(m['settings']);
      if (settings) for (const h of this.onConfig) h({ type: 'config', settings });
    } else if (m['type'] === 'text-input' && typeof m['text'] === 'string') {
      const text = m['text'].slice(0, MAX_TEXT);
      if (text.trim()) for (const h of this.onText) h(text);
    }
  }

  /** Comparacion en tiempo constante para no filtrar el token por timing. */
  private tokenMatches(candidate: string): boolean {
    if (candidate.length !== this.token.length) return false;
    let diff = 0;
    for (let i = 0; i < candidate.length; i++) diff |= candidate.charCodeAt(i) ^ this.token.charCodeAt(i);
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
  }
}

/** Valida y recorta la config entrante; descarta lo que no cuadre. */
function sanitizeSettings(value: unknown): AlphaConfigMessage['settings'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const out: AlphaConfigMessage['settings'] = {};
  if (typeof v['agent'] === 'string') out.agent = v['agent'].slice(0, MAX_FIELD);
  if (typeof v['model'] === 'string') out.model = v['model'].slice(0, MAX_FIELD);
  if (typeof v['audioDevice'] === 'string') out.audioDevice = v['audioDevice'].slice(0, MAX_FIELD);
  if (typeof v['confidential'] === 'boolean') out.confidential = v['confidential'];
  return Object.keys(out).length > 0 ? out : undefined;
}
