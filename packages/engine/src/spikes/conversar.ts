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
import { SkillLibrary } from '../brain/skills/library.js';
import { skillsDir } from '../paths.js';
import { createSpeaker } from '../tts/speaker.js';
import { listInputDevices, defaultInputDevice } from '../audio/devices.js';
import { toDbfs } from '../audio/format.js';
import { loadConfig } from '../config/loader.js';
import { loadAvatars, type AvatarProfile } from '../config/avatars.js';
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

// Config unificada: defaults ← default.yaml ← local.yaml ← ajustes del avatar.
// El entorno solo sobreescribe para pruebas puntuales.
const config = loadConfig();
let confidential = process.env['ALPHA_CONFIDENCIAL'] === '1' || config.confidential;

// El avatar es un PERFIL: manda sobre modelo, voz y personalidad del asistente.
const avatars = loadAvatars();
const avatarById = (id: string): AvatarProfile | undefined => avatars.find((a) => a.id === id);
let avatar = avatarById(config.agent);
// En confidencial solo valen los avatares locales; si el guardado no lo es, se
// cae al primero que si lo sea (el motor lo exige, no solo el menu).
if (confidential && avatar && !avatar.local) {
  const fallback = avatars.find((a) => a.local);
  if (fallback) avatar = fallback;
}
let model = process.env['ALPHA_MODEL'] ?? avatar?.model ?? config.brain.model;

const captureOptions = {
  device: process.env['ALPHA_AUDIO_DEVICE'] ?? config.audio.device,
  gainDb: process.env['ALPHA_MIC_GAIN'] ? Number(process.env['ALPHA_MIC_GAIN']) : config.audio.gainDb,
  normalize: process.env['ALPHA_MIC_NORMALIZE'] === '1' || config.audio.normalize,
};
// device vacio = el predeterminado del sistema; ffmpeg necesita el nombre real.
if (!captureOptions.device) captureOptions.device = (await defaultInputDevice()).name;

const whisper = new WhisperTranscriber({ language: config.stt.language });
const skills = new SkillLibrary(skillsDir);
await skills.load();
const tools = new ToolRegistry().registerAll(BUILTIN_TOOLS).registerAll(skills.tools());

// Toman los valores por parametro (no del cierre) para poder construir y
// validar candidatos ANTES de comprometer el estado — reconfiguracion
// transaccional. brain y tts salen de la config unificada.
/** La personalidad del avatar se inyecta en el prompt: es lo que le da caracter. */
const systemPromptFor = (av: AvatarProfile | undefined): string =>
  av?.personality
    ? `${config.brain.systemPrompt}\n\nTe llamas ${av.name}. Tu personalidad: ${av.personality}`
    : config.brain.systemPrompt;

const makeBrain = (m: string, conf: boolean, av: AvatarProfile | undefined) =>
  new Brain({
    model: m,
    config: { ...config.brain, systemPrompt: systemPromptFor(av), confidential: conf },
    tools,
    skillsPrompt: () => skills.promptSection(),
  });
const makeSpeaker = (conf: boolean, av: AvatarProfile | undefined) =>
  createSpeaker({
    engine: (process.env['ALPHA_TTS_ENGINE'] as 'edge' | 'sapi') ?? av?.voice.engine ?? config.tts.engine,
    edgeVoice: av?.voice.engine === 'edge' ? av.voice.name : config.tts.edgeVoice,
    sapiVoice: av?.voice.engine === 'sapi' ? av.voice.name : config.tts.sapiVoice,
    rate: av?.voice.rate ?? config.tts.rate,
    confidential: conf,
  });

let brain = makeBrain(model, confidential, avatar);
let speaker = makeSpeaker(confidential, avatar);

const brainInfo = brain.describe();
const voiceInfo = speaker.describe();
console.log(`\n  A.L.P.H.A. — conversacion completa`);
console.log(
  `  Avatar:    ${avatar ? `${avatar.name} — ${avatar.role} ${avatar.local ? '(solo local)' : '(usa nube)'}` : '(ninguno)'}`,
);
console.log(`  Microfono: ${captureOptions.device}${captureOptions.gainDb ? ` (+${captureOptions.gainDb} dB)` : ''}`);
console.log(`  Cerebro:   ${brainInfo.provider}/${brainInfo.model} ${brainInfo.local ? '(local)' : '(nube)'}`);
console.log(`  Voz:       ${voiceInfo.engine}/${voiceInfo.voice} ${voiceInfo.local ? '(local)' : '(nube)'}`);
console.log(`  Herramientas: ${tools.list().map((t) => t.name).join(', ')}`);
console.log(`  Skills: ${skills.list().map((s) => s.name).join(', ') || '(ninguna)'}`);
console.log(
  `  Interrupcion: ${config.conversation.bargeIn ? `si (puedes cortarle hablando, desde ${config.conversation.bargeInMinMs}ms de habla)` : 'no'}`,
);
if (confidential) console.log(`  Modo confidencial: ON (sin nube)`);

// Puente hacia el avatar: si esta abierto, refleja el estado y el texto.
// Puerto configurable: si ya hay un motor corriendo, el puerto fijo esta
// ocupado y el segundo se queda mudo sin decirlo. Con esto se puede levantar
// otra instancia (probar cambios sin matar la que este en uso).
const bridgePort = Number(process.env['ALPHA_BRIDGE_PORT']) || AVATAR_BRIDGE_PORT;
const bridge = new AvatarBridge(bridgePort);
const bridgeUp = await bridge.start();
console.log(
  bridgeUp
    ? `  Avatar: escuchando en 127.0.0.1:${bridgePort} (lanza "npm run avatar" para verlo)`
    : `  Avatar: PUERTO ${bridgePort} OCUPADO (¿otro motor corriendo?) — este motor no tendra avatar.\n` +
      `          Para levantar otra instancia: ALPHA_BRIDGE_PORT=43118 npm run spike:conversar`,
);
console.log(`  Habla cuando quieras. Ctrl+C para salir.\n`);

const ICON: Record<ConversationState, string> = { escuchando: '👂', pensando: '🧠', hablando: '🗣️' };

// Seguimiento del estado actual para el heartbeat: cuanto lleva asi.
let state: ConversationState = 'escuchando';
let stateSince = Date.now();

// Nivel del microfono: se acumula el pico y se muestra una vez por segundo
// mientras se escucha, para saber si el micro te esta oyendo.
let peak = 0;
let lastLevelLog = 0;

// Copia, no el mismo objeto: si la sesion y el spike compartieran captureOptions,
// mutar el device aqui haria que setAudioDevice lo viera "ya aplicado" y no
// reiniciara la captura. currentMic lleva el aparte cual es el activo.
let currentMic = captureOptions.device;
const session = new ConversationSession({
  capture: { ...captureOptions },
  bargeIn: config.conversation.bargeIn,
  bargeInMinMs: config.conversation.bargeInMinMs,
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
    onMicChange: (enabled) => {
      log(enabled ? '🎤 microfono activo' : '🔇 microfono silenciado');
      // Con el micro cerrado no esta "escuchando": el avatar pasa a reposo.
      if (!enabled) bridge.broadcast({ type: 'state', state: 'reposo' });
    },
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

// Manda al avatar la lista de microfonos disponibles (al arrancar y cada vez
// que un avatar se conecta), marcando el activo.
async function sendDevices(): Promise<void> {
  try {
    const inputs = (await listInputDevices()).map((d) => ({ name: d.name, isDefault: d.isDefault }));
    bridge.broadcast({ type: 'devices', inputs, current: currentMic });
  } catch (err) {
    log(`✗ [devices] ${(err as Error).message}`);
  }
}
// Los perfiles de avatar los tiene el motor (los lee de config/avatars.yaml);
// la UI solo los pinta, igual que con los microfonos.
function sendAvatars(): void {
  bridge.broadcast({
    type: 'avatars',
    list: avatars.map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      local: a.local,
      image: a.image,
    })),
    ...(avatar ? { current: avatar.id } : {}),
  });
}
bridge.onClientConnect(() => {
  void sendDevices();
  sendAvatars();
});
void sendDevices();

// Chat escrito desde el avatar: se responde como a la voz, mismo historial.
bridge.onTextInput((text) => void session.sendText(text));

// Cambios de configuracion desde el avatar (modelo, privacidad, microfono): se
// aplican en caliente sin cortar la sesion.
bridge.onConfigMessage((msg) => {
  const s = msg.settings;

  // Silenciar el microfono: independiente del resto: sigue valiendo el chat
  // escrito y no toca modelo, voz ni avatar.
  if (typeof s.micEnabled === 'boolean' && s.micEnabled !== session.isMicEnabled()) {
    session.setMicEnabled(s.micEnabled);
  }

  // Microfono: reinicia la captura con el nuevo dispositivo. Se deja que
  // setAudioDevice sea quien actualiza el estado de la sesion.
  if (typeof s.audioDevice === 'string' && s.audioDevice && s.audioDevice !== currentMic) {
    currentMic = s.audioDevice;
    session.setAudioDevice(s.audioDevice);
    log(`⚙️  microfono desde el avatar: ${s.audioDevice}`);
  }

  const nextConfidential = typeof s.confidential === 'boolean' ? s.confidential : confidential;

  // Cambio de AVATAR: su perfil manda sobre modelo, voz y personalidad.
  let nextAvatar = avatar;
  if (s.agent && s.agent !== avatar?.id) {
    const candidate = avatarById(s.agent);
    if (!candidate) {
      log(`✗ [config] avatar desconocido: "${s.agent}"`);
      return;
    }
    // Contrato de privacidad: en confidencial solo avatares locales.
    if (nextConfidential && !candidate.local) {
      log(`✗ [config] "${candidate.name}" usa la nube y el modo confidencial esta activo — no se aplica`);
      return;
    }
    nextAvatar = candidate;
  }

  // Activar confidencial con un avatar de nube puesto: en vez de fallar entero
  // (y quedarnos sin modo confidencial), se cae al primer avatar local.
  if (nextConfidential && nextAvatar && !nextAvatar.local) {
    const fallback = avatars.find((a) => a.local);
    if (!fallback) {
      log(`✗ [config] modo confidencial sin ningun avatar local disponible`);
      return;
    }
    log(`⚙️  confidencial: "${nextAvatar.name}" usa la nube — se cambia a "${fallback.name}"`);
    nextAvatar = fallback;
  }

  // Un avatar nuevo trae su modelo; si no, manda el que pidan explicitamente.
  const nextModel =
    nextAvatar !== avatar ? nextAvatar?.model ?? model : s.model && s.model !== model ? s.model : model;

  if (nextAvatar === avatar && nextModel === model && nextConfidential === confidential) return;

  try {
    // Se construye y VALIDA el candidato antes de tocar nada: describe() llama a
    // resolveModel, que lanza si el modelo no cuadra (p. ej. nube en
    // confidencial, proveedor desconocido o clave ausente).
    const nextBrain = makeBrain(nextModel, nextConfidential, nextAvatar);
    const info = nextBrain.describe();
    const nextSpeaker = makeSpeaker(nextConfidential, nextAvatar);
    const voiceInfo = nextSpeaker.describe();

    // Solo ahora, con todo construido y validado, se compromete el estado.
    brain = nextBrain;
    speaker = nextSpeaker;
    model = nextModel;
    confidential = nextConfidential;
    avatar = nextAvatar;
    session.reconfigure({ brain, speaker });
    sendAvatars(); // que la UI sepa cual quedo activo
    log(
      `⚙️  ${avatar ? `${avatar.name} · ` : ''}${info.provider}/${info.model} · voz ${voiceInfo.voice}${confidential ? ' · confidencial' : ''}`,
    );
  } catch (err) {
    // Falla la validacion: se mantiene la config anterior intacta.
    log(`✗ [config] ${(err as Error).message} — se mantiene la configuracion anterior`);
  }
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
