/**
 * Deteccion de saludos, para disparar el gesto de la mano cuando el asistente
 * saluda o devuelve el saludo.
 *
 * Vive en el MOTOR: decidir que "esto fue un saludo" es semantica de la
 * conversacion (y depende del idioma del agente), no presentacion. La UI
 * recibe un mensaje `gesture` explicito y solo lo ejecuta; antes infería el
 * saludo del texto y quedaba atada al español.
 *
 * Se exige que el saludo este al PRINCIPIO del texto (o tras un signo de
 * apertura): asi "hola, ¿en que te ayudo?" saluda, pero "te dije hola hace un
 * rato" no. Sin ese ancla, cualquier mencion de la palabra agitaba la mano.
 */

/**
 * Saludos que valen como COMIENZO de la frase: lo que va detras es el resto del
 * saludo ("hola, dime") y no cambia que sea uno.
 */
const SALUDOS_INICIO = [
  'hola',
  'holi',
  'buenos dias',
  'buenas tardes',
  'buenas noches',
  'saludos',
  'bienvenido',
  'bienvenida',
  'encantado',
  'encantada',
];

/**
 * Saludos que solo valen si son la frase ENTERA. Son palabras que empiezan
 * frases normales: "buenas noticias" no saluda, "buenas" a secas si. Este es el
 * falso positivo que hay que evitar — agitar la mano sin venir a cuento se nota
 * mucho mas que no saludar.
 */
const SALUDOS_SOLOS = ['buenas', 'hey', 'ey', 'que tal', 'como estas', 'como te va'];

/** Quita acentos y signos para comparar sin depender de como se escriba. */
function normalizar(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // marcas de acento sueltas tras NFD
    .toLowerCase()
    .replace(/^[¡¿"'\s.,-]+/, '')
    .trim();
}

export function isGreeting(text: string): boolean {
  const limpio = normalizar(text);
  if (!limpio) return false;
  // Solo la primera oracion: el saludo, si lo hay, abre el mensaje.
  const primera = limpio.split(/[.,;!?\n]/, 1)[0]?.trim() ?? '';
  if (!primera) return false;
  if (SALUDOS_SOLOS.includes(primera)) return true;
  return SALUDOS_INICIO.some((s) => primera === s || primera.startsWith(`${s} `));
}
