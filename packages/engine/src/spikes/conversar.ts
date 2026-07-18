/**
 * Spike: la conversacion completa, escuchar -> pensar -> hablar.
 *
 * Hablas al microfono y A.L.P.H.A. te responde con voz, manteniendo el hilo.
 * Es la integracion de todas las piezas del MVP, sin avatar todavia (los
 * estados se pintan en consola).
 *
 * Variables: ALPHA_AUDIO_DEVICE, ALPHA_MIC_GAIN, ALPHA_MODEL, ALPHA_TTS_ENGINE,
 * ALPHA_CONFIDENCIAL=1.
 */
import { WhisperTranscriber } from '../stt/whisper.js';
import { Brain } from '../brain/client.js';
import { createSpeaker } from '../tts/speaker.js';
import { captureOptionsFromEnv } from '../audio/options.js';
import { ConversationSession } from '../conversation/session.js';

const captureOptions = await captureOptionsFromEnv();
const confidential = process.env['ALPHA_CONFIDENCIAL'] === '1';

const whisper = new WhisperTranscriber({ language: process.env['ALPHA_LANG'] ?? 'es' });
const brain = new Brain({
  ...(process.env['ALPHA_MODEL'] ? { model: process.env['ALPHA_MODEL'] } : {}),
  config: { confidential },
});
const speaker = createSpeaker({
  ...(process.env['ALPHA_TTS_ENGINE'] ? { engine: process.env['ALPHA_TTS_ENGINE'] as 'edge' } : {}),
  confidential,
});

const brainInfo = brain.describe();
const voiceInfo = speaker.describe();
console.log(`\n  A.L.P.H.A. — conversacion completa`);
console.log(`  Microfono: ${captureOptions.device}${captureOptions.gainDb ? ` (+${captureOptions.gainDb} dB)` : ''}`);
console.log(`  Cerebro:   ${brainInfo.provider}/${brainInfo.model} ${brainInfo.local ? '(local)' : '(nube)'}`);
console.log(`  Voz:       ${voiceInfo.engine}/${voiceInfo.voice} ${voiceInfo.local ? '(local)' : '(nube)'}`);
if (confidential) console.log(`  Modo confidencial: ON (sin nube)`);
console.log(`  Habla cuando quieras. Ctrl+C para salir.\n`);

const ICON: Record<string, string> = { escuchando: '👂', pensando: '🧠', hablando: '🗣️' };

const session = new ConversationSession({
  capture: captureOptions,
  whisper,
  brain,
  speaker,
  callbacks: {
    onState: (s) => process.stdout.write(`\r  ${ICON[s]} ${s}...            `),
    onUserText: (t) => console.log(`\r  tú    › ${t}                    `),
    onAssistantText: (t) => console.log(`  ALPHA › ${t}\n`),
    onError: (where, err) => console.error(`\r  ✗ [${where}] ${err.message}\n`),
  },
});

process.on('SIGINT', () => {
  session.stop();
  console.log('\n\n  Hasta luego.\n');
  process.exit(0);
});

await session.run();
