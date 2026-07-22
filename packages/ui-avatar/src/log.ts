/**
 * Log de la UI con marca de tiempo, al estilo del motor: sin ella no hay forma
 * de saber cuanto lleva parado algo mirando la consola.
 */
function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function log(message: string): void {
  console.log(`[${stamp()}] ${message}`);
}
