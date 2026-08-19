/**
 * Saca del buffer las lineas COMPLETAS y devuelve lo que queda a medias.
 *
 * TCP no respeta los limites de mensaje: un JSON puede llegar partido en dos
 * chunks, o dos JSON juntos en uno. Sin conservar el resto, el avatar se comia
 * mensajes en cuanto el motor mandaba varios seguidos (la lista de voces son
 * ~120 entradas y no cabe en un chunk).
 */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const lines: string[] = [];
  let rest = buffer;
  let nl: number;
  while ((nl = rest.indexOf('\n')) >= 0) {
    const line = rest.slice(0, nl).trim();
    rest = rest.slice(nl + 1);
    if (line) lines.push(line);
  }
  return { lines, rest };
}
