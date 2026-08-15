/**
 * Spike: el cerebro con herramientas (agentico), por texto.
 *
 * Escribes, y si hace falta A.L.P.H.A. usa herramientas (hora, sistema...)
 * antes de responder. Se ve cada llamada. Sin audio ni UI.
 *
 * Prueba: "¿qué hora es?", "¿cómo va mi ordenador?".
 */
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { Brain, type ChatMessage } from '../brain/client.js';
import { ToolRegistry } from '../brain/tools/registry.js';
import { BUILTIN_TOOLS } from '../brain/tools/builtin.js';
import { SkillLibrary } from '../brain/skills/library.js';
import { skillsDir } from '../paths.js';

const skills = new SkillLibrary(skillsDir);
await skills.load();

const tools = new ToolRegistry().registerAll(BUILTIN_TOOLS).registerAll(skills.tools());
const brain = new Brain({
  ...(process.env['ALPHA_MODEL'] ? { model: process.env['ALPHA_MODEL'] } : {}),
  tools,
  skillsPrompt: () => skills.promptSection(),
});

const info = brain.describe();
console.log(`\n  A.L.P.H.A. — spike agente (con herramientas y skills)`);
console.log(`  Modelo: ${info.provider}/${info.model} ${info.local ? '(local)' : '(nube)'}`);
console.log(
  `  Herramientas: ${tools
    .list()
    .map((t) => t.name)
    .join(', ')}`,
);
console.log(
  `  Skills: ${
    skills
      .list()
      .map((s) => s.name)
      .join(', ') || '(ninguna)'
  }`,
);
for (const sk of skills.skippedSkills()) console.log(`    (omitida: ${sk.name} — ${sk.reason})`);
console.log(`  Escribe y pulsa Enter. Ctrl+C para salir.\n`);

const history: ChatMessage[] = [];
const rl = createInterface({ input: stdin, output: stdout });

for (;;) {
  let text: string;
  try {
    text = (await rl.question('  tú › ')).trim();
  } catch {
    break;
  }
  if (!text) continue;

  history.push({ role: 'user', content: text });
  stdout.write('  ALPHA › ');
  let full = '';
  const started = performance.now();
  try {
    for await (const ev of brain.runAgentic(history)) {
      if (ev.type === 'text') {
        stdout.write(ev.delta);
        full += ev.delta;
      } else if (ev.type === 'tool-start') {
        stdout.write(`\n    🔧 ${ev.name}(${ev.args || ''})`);
      } else if (ev.type === 'tool-end') {
        stdout.write(` → ${ev.result}\n  ALPHA › `);
      }
    }
  } catch (error) {
    console.error(`\n  ✗ ${(error as Error).message}\n`);
    history.pop();
    continue;
  }
  const elapsed = ((performance.now() - started) / 1000).toFixed(1);
  if (full.trim()) history.push({ role: 'assistant', content: full });
  console.log(`\n  (${elapsed}s)\n`);
}
