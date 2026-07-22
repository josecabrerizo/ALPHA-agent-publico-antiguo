/**
 * Rechazo de eco a nivel de TEXTO.
 *
 * Con el microfono abierto mientras A.L.P.H.A. habla, por altavoz se oye a si
 * mismo: whisper transcribiria su propia voz y se interrumpiria en bucle. La
 * cancelacion de eco de verdad (AEC) necesitaria un filtro adaptativo nativo
 * —ffmpeg no cancela eco—, pero aqui tenemos una ventaja: sabemos EXACTAMENTE
 * que esta diciendo, porque es el texto que le mandamos al TTS. Basta comparar
 * lo oido con lo que se esta diciendo.
 *
 * No es infalible (si whisper destroza su voz en palabras distintas, se cuela),
 * por eso el barge-in es desactivable; pero cubre el caso normal sin anadir
 * dependencias.
 */

/** Minusculas, sin acentos ni puntuacion: para comparar por palabras. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // marcas diacriticas
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(text: string): string[] {
  const n = normalize(text);
  return n ? n.split(' ') : [];
}

/** Umbral de solapamiento por encima del cual se considera eco. */
const ECHO_THRESHOLD = 0.6;

/**
 * ¿Lo que se oyo por el microfono es la propia voz del asistente?
 *
 * Mide que proporcion de las palabras oidas aparece en lo que se esta diciendo.
 * Alto solapamiento = eco. Se compara contra el texto hablado ACUMULADO del
 * turno, porque el microfono puede recoger cualquier parte de la frase.
 */
export function looksLikeEcho(heard: string, spoken: string): boolean {
  const heardWords = words(heard);
  const spokenWords = new Set(words(spoken));
  if (heardWords.length === 0 || spokenWords.size === 0) return false;

  // Una sola palabra suelta ("si", "vale") coincide por casualidad demasiado a
  // menudo: sin contexto suficiente no se declara eco.
  if (heardWords.length < 2) return false;

  let hits = 0;
  for (const word of heardWords) {
    if (spokenWords.has(word)) hits++;
  }
  return hits / heardWords.length >= ECHO_THRESHOLD;
}

/**
 * Une lo que el usuario dijo antes con lo que anade al interrumpir, para que el
 * asistente responda a todo junto. El caso real no es "cambio de tema" sino
 * "sigo completando mi idea mientras ya me contesta".
 */
export function mergeUserTurns(previous: string, next: string): string {
  const a = previous.trim();
  const b = next.trim();
  if (!a) return b;
  if (!b) return a;
  return `${a} ${b}`.replace(/\s+/g, ' ');
}

/** Que hacer con un tramo de voz oido mientras el asistente responde. */
export type BargeInVerdict = 'ruido' | 'eco' | 'interrumpir';

/**
 * Decide si un tramo oido durante la respuesta es una interrupcion real.
 * Sin palabras es ruido; si suena a lo que esta diciendo, es su propio eco.
 */
export function decideBargeIn(heard: string, spokenSoFar: string): BargeInVerdict {
  if (!heard.trim()) return 'ruido';
  if (looksLikeEcho(heard, spokenSoFar)) return 'eco';
  return 'interrumpir';
}
