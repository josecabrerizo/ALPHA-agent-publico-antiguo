/**
 * Spike: la conversacion completa, escuchar -> pensar -> hablar.
 *
 * Hablas al microfono y A.L.P.H.A. te responde con voz, manteniendo el hilo.
 * El motor entero lo monta startEngineRuntime (app/runtime.ts); aqui queda
 * SOLO la consola: banner, iconos, nivel del micro, heartbeat y Ctrl+C.
 *
 * Variables: ALPHA_AUDIO_DEVICE, ALPHA_MIC_GAIN, ALPHA_MODEL, ALPHA_TTS_ENGINE,
 * ALPHA_CONFIDENCIAL=1, ALPHA_BRIDGE_PORT.
 */
import { toDbfs } from '../audio/format.js';
import { startEngineRuntime } from '../app/runtime.js';
import type { ConversationState } from '../conversation/session.js';

/** Marca de tiempo estilo Java: HH:MM:SS.mmm. */
function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function log(message: string): void {
  console.log(`[${stamp()}] ${message}`);
}

const ICON: Record<ConversationState, string> = {
  escuchando: '👂',
  pensando: '🧠',
  hablando: '🗣️',
};

// Seguimiento del estado actual para el heartbeat: cuanto lleva asi.
let state: ConversationState = 'escuchando';
let stateSince = Date.now();

// Nivel del microfono: se acumula el pico y se muestra una vez por segundo
// mientras se escucha, para saber si el micro te esta oyendo.
let peak = 0;
let lastLevelLog = 0;

const runtime = await startEngineRuntime({
  onLog: (m) => log(m),
  onState: (s) => {
    state = s;
    stateSince = Date.now();
    log(`${ICON[s]} ${s}`);
  },
  onLevel: (level, speaking) => {
    peak = Math.max(peak, level);
    const now = Date.now();
    // Solo en escuchando y como mucho cada segundo, para no inundar.
    if (state === 'escuchando' && now - lastLevelLog > 1000) {
      const db = toDbfs(peak);
      log(
        `   micro: pico ${db === -Infinity ? '−∞' : db.toFixed(0)} dBFS${speaking ? '  (voz)' : ''}`,
      );
      peak = 0;
      lastLevelLog = now;
    }
  },
  onMicChange: (enabled) => log(enabled ? '🎤 microfono activo' : '🔇 microfono silenciado'),
  onUserText: (t) => log(`tú    › ${t}`),
  onAssistantText: (t) => log(`ALPHA › ${t}`),
  onError: (where, err) => log(`✗ [${where}] ${err.message}`),
});

const { config, info } = runtime;
console.log(`\n  A.L.P.H.A. — conversacion completa`);
console.log(
  `  Avatar:    ${info.avatar ? `${info.avatar.name} — ${info.avatar.role}${info.avatar.confidential ? ' (confidencial)' : ''}` : '(ninguno)'}`,
);
console.log(
  `  Microfono: ${info.micDevice}${info.micGainDb ? ` (+${info.micGainDb} dB)` : ''}${config.audio.micEnabled ? '' : '  — SILENCIADO (guardado)'}`,
);
console.log(`  Whisper:   modelo ${config.stt.model}, idioma ${config.stt.language}`);
console.log(
  `  Cerebro:   ${info.brain.provider}/${info.brain.model} ${info.brain.local ? '(local)' : '(nube)'}`,
);
console.log(
  `  Voz:       ${info.voice.engine}/${info.voice.voice} ${info.voice.local ? '(local)' : '(nube)'}`,
);
console.log(`  Herramientas: ${info.tools.join(', ')}`);
console.log(`  Skills: ${info.skills.join(', ') || '(ninguna)'}`);
// Las omitidas se DICEN. Sobre todo las que estan en cuarentena: una skill que
// escribio el agente y nadie ha aprobado no hace nada, y sin este aviso el
// usuario no se enteraria ni de que existe ni de que hay algo que revisar.
for (const sk of info.skippedSkills) {
  console.log(`     · omitida "${sk.name}": ${sk.reason}`);
}
console.log(
  `  Interrupcion: ${config.conversation.bargeIn ? `si (puedes cortarle hablando, desde ${config.conversation.bargeInMinMs}ms de habla)` : 'no'}`,
);
if (info.confidential) console.log(`  Modo confidencial: ON (sin nube)`);
console.log(
  info.bridgeUp
    ? `  Avatar: escuchando en 127.0.0.1:${info.bridgePort} (lanza "npm run avatar" para verlo)`
    : `  Avatar: PUERTO ${info.bridgePort} OCUPADO (¿otro motor corriendo?) — este motor no tendra avatar.\n` +
        `          Para levantar otra instancia: ALPHA_BRIDGE_PORT=43118 npm run spike:conversar`,
);
console.log(`  Habla cuando quieras. Ctrl+C para salir.\n`);

// Heartbeat: si lleva mas de 3s sin cambiar de estado (y no esta escuchando),
// avisa de cuanto lleva, para ver un cuelgue en vez de un silencio.
const heartbeat = setInterval(() => {
  if (state === 'escuchando') return;
  const secs = ((Date.now() - stateSince) / 1000).toFixed(0);
  log(`   ⏳ sigue en "${state}" desde hace ${secs}s`);
}, 3000);

process.on('SIGINT', () => {
  clearInterval(heartbeat);
  runtime.stop();
  console.log('\n  Hasta luego.\n');
  process.exit(0);
});

await runtime.run();
