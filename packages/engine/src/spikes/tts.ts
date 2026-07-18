/**
 * Spike: dar voz a A.L.P.H.A.
 *
 *   npm run spike:tts -- "texto a decir"
 *
 * Variables: ALPHA_TTS_ENGINE (edge|sapi), ALPHA_TTS_VOICE (voz del motor),
 * ALPHA_CONFIDENCIAL=1 (fuerza el motor local).
 */
import { createSpeaker } from '../tts/speaker.js';
import type { TtsConfig } from '../tts/types.js';

const text = process.argv.slice(2).join(' ') || 'Hola, soy A.L.P.H.A. Ya tengo voz.';

const engine = process.env['ALPHA_TTS_ENGINE'] as TtsConfig['engine'] | undefined;
const voice = process.env['ALPHA_TTS_VOICE'];
const confidential = process.env['ALPHA_CONFIDENCIAL'] === '1';

const speaker = createSpeaker({
  ...(engine ? { engine } : {}),
  ...(voice ? (engine === 'sapi' ? { sapiVoice: voice } : { edgeVoice: voice }) : {}),
  confidential,
});

const info = speaker.describe();
console.log(`\n  Voz: ${info.engine} / ${info.voice} ${info.local ? '(local)' : '(nube)'}`);
console.log(`  Diciendo: "${text}"\n`);

const started = performance.now();
await speaker.speak(text);
console.log(`  Listo (${((performance.now() - started) / 1000).toFixed(1)}s).\n`);
