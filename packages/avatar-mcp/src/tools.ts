import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { AvatarGesture, AvatarWireState } from '@alpha/protocol';

/**
 * Las tools MCP de la cara, en espanol y descritas PARA el agente externo:
 * quien las lee es un Claude (u otro agente) decidiendo si le sirven. El
 * mapeo es fino a proposito; la logica vive en FaceController.
 */

/** Lo que las tools necesitan del controlador; interfaz propia para poder
 *  probar el mapeo con un doble sin puente detras. */
export interface FaceLike {
  decir(texto: string, opts?: { gesto?: AvatarGesture }): Promise<void>;
  estado(state: AvatarWireState): void;
  saludar(texto?: string): Promise<void>;
  cambiarAvatar(id: string): { id: string; name: string };
  leerMensajes(): { texto: string; ts: number }[];
  avatares(): { id: string; name: string; role: string }[];
  readonly activo: { id: string; name: string };
}

const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const errorText = (t: string) => ({ content: [{ type: 'text' as const, text: t }], isError: true });

export function registerFaceTools(server: McpServer, face: FaceLike): void {
  server.registerTool(
    'decir',
    {
      description:
        'Habla al usuario a traves del avatar: muestra el texto en su bocadillo y, si hay voz configurada, lo dice en alto. Es la forma normal de comunicarte con el usuario por la cara de A.L.P.H.A.',
      inputSchema: {
        texto: z.string().describe('Lo que el avatar dice al usuario'),
        gesto: z
          .enum(['saludo'])
          .optional()
          .describe('Gesto que acompana al texto (saludo = agitar la mano)'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ texto, gesto }) => {
      await face.decir(texto, gesto ? { gesto } : {});
      return text(`${face.activo.name} lo ha dicho.`);
    },
  );

  server.registerTool(
    'saludar',
    {
      description:
        'El avatar agita la mano. Con texto, ademas lo dice. Uselo al empezar una sesion o cuando el usuario salude.',
      inputSchema: {
        texto: z.string().optional().describe('Saludo hablado opcional'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ texto }) => {
      await face.saludar(texto);
      return text(`${face.activo.name} ha saludado.`);
    },
  );

  server.registerTool(
    'estado',
    {
      description:
        'Cambia la postura del avatar: reposo, escuchando, pensando o hablando. Util para reflejar en que anda el agente (pensando mientras trabajas, reposo al terminar).',
      inputSchema: {
        estado: z.enum(['reposo', 'escuchando', 'pensando', 'hablando']),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ estado }) => {
      face.estado(estado);
      return text(`Estado: ${estado}.`);
    },
  );

  server.registerTool(
    'leer_mensajes',
    {
      description:
        'Recoge lo que el usuario haya escrito en el chat del avatar desde la ultima lectura. Cada mensaje se entrega una sola vez.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const mensajes = face.leerMensajes();
      if (mensajes.length === 0) return text('(no hay mensajes nuevos)');
      return text(
        mensajes
          .map((m) => `[${new Date(m.ts).toLocaleTimeString('es-ES')}] ${m.texto}`)
          .join('\n'),
      );
    },
  );

  server.registerTool(
    'cambiar_avatar',
    {
      description:
        'Cambia el personaje activo (retrato, color y nombre). Los disponibles salen de config/avatars.yaml del proyecto ALPHA.',
      inputSchema: {
        avatarId: z.string().describe('Id del avatar (p. ej. vulpis, unit-a, nexus, synapse)'),
      },
      annotations: { readOnlyHint: false },
    },
    async ({ avatarId }) => {
      try {
        const next = face.cambiarAvatar(avatarId);
        return text(`Avatar activo: ${next.name} (${next.id}).`);
      } catch (err) {
        return errorText((err as Error).message);
      }
    },
  );
}
