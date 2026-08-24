/**
 * @alpha/protocol — el puente motor <-> avatar de A.L.P.H.A.
 *
 * Unica fuente de verdad del protocolo: mensajes, constantes (puerto, token),
 * framing NDJSON, y las dos puntas del socket (AvatarBridge y connectBridge).
 */
export * from './constants.js';
export * from './messages.js';
export * from './founders.js';
export * from './framing.js';
export * from './server.js';
export * from './client.js';
