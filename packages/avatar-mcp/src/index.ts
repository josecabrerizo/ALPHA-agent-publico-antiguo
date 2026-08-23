/**
 * Fachada MCP del avatar: un servidor MCP por stdio que da la CARA de
 * A.L.P.H.A. a cualquier agente externo (Claude Code, por ejemplo).
 *
 * Se hace pasar por el motor: levanta el AvatarBridge (mismo puerto, mismo
 * token), y la app del avatar —que reconecta sola y relee el token en cada
 * intento— se engancha sin cambiar ni una linea. Motor y fachada en el mismo
 * puerto se excluyen a proposito: sobre la cara solo puede mandar una voz.
 *
 * Registro en Claude Code (desde cualquier proyecto):
 *   claude mcp add alpha-avatar -- npx -y tsx <ruta>/packages/avatar-mcp/src/index.ts
 *
 * Variables: ALPHA_BRIDGE_PORT (compartida con la UI), ALPHA_MCP_AVATAR (id
 * del perfil inicial), ALPHA_MCP_TTS=sapi|off (default sapi: la voz local del
 * sistema — la neuronal es del motor real, y el texto de un agente externo no
 * va a la nube, coherente con el contrato confidencial del proyecto).
 *
 * SIN dependencia del motor: los perfiles salen del catalogo compartido de
 * @alpha/protocol (FOUNDER_AVATARS) y la voz del mini-speaker SAPI propio.
 * Es el desacople que permite que la fachada viva en el repo del avatar.
 */
// PRIMER import: desvia stdout a stderr antes de que cualquier modulo hable.
import './stdout-guard.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { AvatarBridge, AVATAR_BRIDGE_PORT, FOUNDER_AVATARS } from '@alpha/protocol';
import { createFacadeSpeaker } from './speaker.js';
import { FaceController } from './face.js';
import { registerFaceTools } from './tools.js';

const log = (m: string) => console.error(`[avatar-mcp] ${m}`);

const port = Number(process.env['ALPHA_BRIDGE_PORT']) || AVATAR_BRIDGE_PORT;
const bridge = new AvatarBridge(port);
if (!(await bridge.start())) {
  log(`el puerto ${port} esta ocupado — ¿esta corriendo el motor de verdad?`);
  log(`sobre la cara solo manda una voz: motor y fachada no conviven en el mismo puerto.`);
  log(`para tener ambos a la vez, otro puerto en fachada Y avatar: ALPHA_BRIDGE_PORT=43118`);
  process.exit(1);
}

// Los perfiles: el catalogo compartido de protocol, la misma fuente que el
// yaml del motor (un test del engine los compara) y el respaldo de la UI.
const profiles = [...FOUNDER_AVATARS];

const face = new FaceController(bridge, profiles, process.env['ALPHA_MCP_AVATAR'], (active) =>
  createFacadeSpeaker(active, { log }),
);

const server = new McpServer({ name: 'alpha-avatar', version: '0.0.1' });
registerFaceTools(server, face);
await server.connect(new StdioServerTransport());

log(
  `listo: puente en 127.0.0.1:${port}, ${face.avatares().length} avatares (activo: ${face.activo.id}), voz ${(process.env['ALPHA_MCP_TTS'] ?? 'sapi') === 'off' ? 'apagada' : 'sapi'}`,
);
log(`lanza la cara con "npm run avatar" si no esta ya abierta`);

// Apagado UNICO para todas las salidas: corta la voz en curso (los speakers
// lanzan PowerShell/ffplay, y salir del padre no mata a esos hijos — el
// avatar seguiria hablando con la fachada ya muerta), retira el puente y
// borra su token.
const apagar = (): never => {
  try {
    face.detener();
  } catch {
    // cortar la voz es cortesia; no puede impedir el apagado
  }
  bridge.stop();
  process.exit(0);
};
// Cuando el agente cierra el stdio, la fachada se retira.
process.stdin.on('close', apagar);
process.on('SIGINT', apagar);
process.on('SIGTERM', apagar);
