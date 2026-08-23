import os from 'node:os';
import path from 'node:path';

/**
 * Constantes del puente motor <-> avatar. Los dos procesos importan ESTE
 * fichero: el puerto, los limites y la ruta del token tienen una sola
 * definicion (antes cada lado llevaba su copia y podian divergir).
 */

/** Puerto fijo en localhost. Alto y poco comun para no chocar. */
export const AVATAR_BRIDGE_PORT = 43117;

/** Tope de una linea sin salto: por encima, la conexion es basura y se corta. */
export const MAX_LINE = 64 * 1024;
/** Tope de un mensaje escrito. */
export const MAX_TEXT = 8_000;
/** Tope de los valores de config (nombres de modelo/dispositivo). */
export const MAX_FIELD = 256;

/**
 * Carpeta de datos en vivo de A.L.P.H.A. (hoy, el token de sesion del puente).
 * Fuera del repo a proposito: un secreto de sesion no es configuracion del
 * proyecto, y motor y avatar podrian vivir en checkouts distintos sin una raiz
 * comun. ALPHA_HOME la mueve (los tests la apuntan a un temporal).
 */
export function alphaHomeDir(): string {
  return process.env['ALPHA_HOME'] ?? path.join(os.homedir(), '.alpha');
}

/**
 * Fichero donde el motor deja el token para que el avatar lo lea. Va ATADO AL
 * PUERTO: dos instancias en la misma maquina escuchan en puertos distintos, y
 * si compartieran fichero la segunda invalidaria la autenticacion de la
 * primera (el avatar releeria el token nuevo y el motor viejo lo rechazaria).
 * El puerto por defecto conserva el nombre de siempre.
 */
export function bridgeTokenPathFor(port: number = AVATAR_BRIDGE_PORT): string {
  const suffix = port === AVATAR_BRIDGE_PORT ? '' : `.${port}`;
  return path.join(alphaHomeDir(), `alpha.bridge-token${suffix}`);
}
