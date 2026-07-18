/**
 * Spike: conversar por texto con el cerebro de A.L.P.H.A.
 *
 * Sin audio ni UI: escribes, el modelo responde en streaming. Sirve para
 * validar el cliente compatible-OpenAI, el registro de proveedores y el
 * control de razonamiento, con Ollama local por defecto.
 *
 * Variables: ALPHA_MODEL (ref proveedor/modelo), ALPHA_REASONING (none|low|...).
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Brain, type ChatMessage } from '../brain/client.js';

const brain = new Brain({
  ...(process.env['ALPHA_MODEL'] ? { model: process.env['ALPHA_MODEL'] } : {}),
  reasoningEffort: (process.env['ALPHA_REASONING'] as 'none') ?? 'none',
});

const info = brain.describe();
console.log(`\n  A.L.P.H.A. — spike cerebro`);
console.log(`  Modelo: ${info.provider}/${info.model} ${info.local ? '(local)' : '(nube)'}`);
console.log(`  Escribe y pulsa Enter. Ctrl+C para salir.\n`);

const history: ChatMessage[] = [];
const rl = createInterface({ input: stdin, output: stdout });

for (;;) {
  let text: string;
  try {
    text = (await rl.question('  tu › ')).trim();
  } catch {
    // readline cerrado (Ctrl+C, o EOF de una tuberia): salir sin ruido, pero
    // solo al pedir la SIGUIENTE entrada, nunca a mitad de una respuesta.
    break;
  }
  if (!text) continue;

  history.push({ role: 'user', content: text });
  stdout.write('  ALPHA › ');

  let full = '';
  const started = performance.now();
  try {
    for await (const chunk of brain.replyStream(history)) {
      stdout.write(chunk);
      full += chunk;
    }
  } catch (error) {
    console.error(`\n  ✗ ${(error as Error).message}\n`);
    history.pop();
    continue;
  }
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  history.push({ role: 'assistant', content: full });
  console.log(`\n  (${elapsed}s)\n`);
}
