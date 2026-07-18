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
import { ToolRegistry } from '../brain/tools/registry.js';
import { BUILTIN_TOOLS } from '../brain/tools/builtin.js';
import { createSpeaker } from '../tts/speaker.js';
import { captureOptionsFromEnv } from '../audio/options.js';
import { toDbfs } from '../audio/format.js';
import { ConversationSession, type ConversationState } from '../conversation/session.js';
import { AvatarBridge, AVATAR_BRIDGE_PORT } from '../conversation/avatar-bridge.js';

/** Marca de tiempo estilo Java: HH:MM:SS.mmm. */
function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function log(message: string): void {
  console.log(`[${stamp()}] ${message}`);
}

const captureOptions = await captureOptionsFromEnv();
const confidential = process.env['ALPHA_CONFIDENCIAL'] === '1';

const whisper = new WhisperTranscriber({ language: process.env['ALPHA_LANG'] ?? 'es' });
const tools = new ToolRegistry().registerAll(BUILTIN_TOOLS);
const brain = new Brain({
  ...(process.env['ALPHA_MODEL'] ? { model: process.env['ALPHA_MODEL'] } : {}),
  config: { confidential },
  tools,
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
console.log(`  Herramientas: ${tools.list().map((t) => t.name).join(', ')}`);
if (confidential) console.log(`  Modo confidencial: ON (sin nube)`);

// Puente hacia el avatar: si esta abierto, refleja el estado y el texto.
const bridge = new AvatarBridge();
await bridge.start();
console.log(`  Avatar: escuchando en 127.0.0.1:${AVATAR_BRIDGE_PORT} (lanza "npm run avatar" para verlo)`);
console.log(`  Habla cuando quieras. Ctrl+C para salir.\n`);

const ICON: Record<ConversationState, string> = { escuchando: '👂', pensando: '🧠', hablando: '🗣️' };

// Seguimiento del estado actual para el heartbeat: cuanto lleva asi.
let state: ConversationState = 'escuchando';
let stateSince = Date.now();

// Nivel del microfono: se acumula el pico y se muestra una vez por segundo
// mientras se escucha, para saber si el micro te esta oyendo.
let peak = 0;
let lastLevelLog = 0;

const session = new ConversationSession({
  capture: captureOptions,
  whisper,
  brain,
  speaker,
  callbacks: {
    onState: (s) => {
      state = s;
      stateSince = Date.now();
      log(`${ICON[s]} ${s}`);
      bridge.broadcast({ type: 'state', state: s });
    },
    onLevel: (level, speaking) => {
      peak = Math.max(peak, level);
      const now = Date.now();
      // Solo en escuchando y como mucho cada segundo, para no inundar.
      if (state === 'escuchando' && now - lastLevelLog > 1000) {
        const db = toDbfs(peak);
        log(`   micro: pico ${db === -Infinity ? '−∞' : db.toFixed(0)} dBFS${speaking ? '  (voz)' : ''}`);
        peak = 0;
        lastLevelLog = now;
      }
    },
    onLog: (m) => log(`   ${m}`),
    onUserText: (t) => {
      log(`tú    › ${t}`);
      bridge.broadcast({ type: 'user', text: t });
    },
    onAssistantText: (t) => {
      log(`ALPHA › ${t}`);
      bridge.broadcast({ type: 'assistant', text: t });
    },
    onError: (where, err) => log(`✗ [${where}] ${err.message}`),
  },
});

// Heartbeat: si lleva mas de 3s sin cambiar de estado (y no esta escuchando),
// avisa de cuanto lleva, para ver un cuelgue en vez de un silencio.
const heartbeat = setInterval(() => {
  if (state === 'escuchando') return;
  const secs = ((Date.now() - stateSince) / 1000).toFixed(0);
  log(`   ⏳ sigue en "${state}" desde hace ${secs}s`);
}, 3000);

process.on('SIGINT', () => {
  clearInterval(heartbeat);
  session.stop();
  bridge.stop();
  console.log('\n  Hasta luego.\n');
  process.exit(0);
});

await session.run();
