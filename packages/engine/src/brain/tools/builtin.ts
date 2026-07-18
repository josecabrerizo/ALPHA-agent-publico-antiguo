import os from 'node:os';
import type { Tool } from './types.js';

/**
 * Herramientas base, locales y de solo lectura. Sirven para validar el bucle
 * agentico y son utiles de por si. Las capacidades con efectos (abrir apps,
 * controlar el equipo) o que salen a la red se anadiran aparte, con sus
 * salvaguardas.
 */

const obtenerFechaHora: Tool = {
  name: 'obtener_fecha_hora',
  description:
    'Devuelve la fecha y hora actuales del sistema. Usala siempre que el usuario ' +
    'pregunte por la hora, el dia, la fecha o algo que dependa del momento actual.',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    const ahora = new Date();
    const fecha = ahora.toLocaleDateString('es-ES', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    const hora = ahora.toLocaleTimeString('es-ES');
    return `${fecha}, ${hora}`;
  },
};

const informacionSistema: Tool = {
  name: 'informacion_sistema',
  description:
    'Devuelve informacion del equipo: sistema operativo, procesador, memoria y ' +
    'tiempo encendido. Usala si el usuario pregunta por su ordenador o su estado.',
  parameters: { type: 'object', properties: {} },
  run: async () => {
    const gib = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);
    const cpus = os.cpus();
    const uptimeH = Math.floor(os.uptime() / 3600);
    const uptimeM = Math.floor((os.uptime() % 3600) / 60);
    return [
      `Sistema: ${os.type()} ${os.release()} (${os.arch()})`,
      `Equipo: ${os.hostname()}`,
      `Procesador: ${cpus[0]?.model ?? 'desconocido'} (${cpus.length} nucleos)`,
      `Memoria: ${gib(os.totalmem() - os.freemem())} de ${gib(os.totalmem())} GiB en uso`,
      `Encendido desde hace: ${uptimeH}h ${uptimeM}m`,
    ].join('. ');
  },
};

export const BUILTIN_TOOLS: Tool[] = [obtenerFechaHora, informacionSistema];
