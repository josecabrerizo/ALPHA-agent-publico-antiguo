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
import { skillsDir, whisperModel } from '../paths.js';
import { createSpeaker } from '../tts/speaker.js';
import { getAvailableVoices } from '../tts/voices.js';
import { listInputDevices, defaultInputDevice } from '../audio/devices.js';
import { toDbfs } from '../audio/format.js';
import { loadConfig } from '../config/loader.js';
import {
  loadAvatars,
  saveAvatarProfile,
  type AvatarProfile,
  type AvatarProfilePatch,
} from '../config/avatars.js';
import { ConversationSession, type ConversationState } from '../conversation/session.js';
import {
  AvatarBridge,
  AVATAR_BRIDGE_PORT,
  type ConfigMessage,
  type AvatarConfigMessage,
  type ModelOption,
} from '@alpha/protocol';

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
const confidentialForced = process.env['ALPHA_CONFIDENCIAL'] === '1';

// El avatar es un PERFIL: manda sobre modelo, voz y personalidad del asistente.
let avatars = loadAvatars();
const avatarById = (id: string): AvatarProfile | undefined => avatars.find((a) => a.id === id);
let avatar = avatarById(config.agent) ?? avatars[0];
let confidential = confidentialForced || (avatar?.confidential ?? config.confidential);
// El override de entorno manda sobre el perfil. Si el avatar activo no esta
// preparado para confidencial, se usa uno que si lo este.
if (confidentialForced && avatar && !avatar.confidential) {
  const fallback = avatars.find((a) => a.confidential);
  if (fallback) avatar = fallback;
}
let model = process.env['ALPHA_MODEL'] ?? avatar?.model ?? config.brain.model;

const captureOptions = {
  device: process.env['ALPHA_AUDIO_DEVICE'] ?? config.audio.device,
  gainDb: process.env['ALPHA_MIC_GAIN']
    ? Number(process.env['ALPHA_MIC_GAIN'])
    : config.audio.gainDb,
  normalize: process.env['ALPHA_MIC_NORMALIZE'] === '1' || config.audio.normalize,
};
// device vacio = el predeterminado del sistema; ffmpeg necesita el nombre real.
if (!captureOptions.device) captureOptions.device = (await defaultInputDevice()).name;

// El tamano del modelo sale de la config (stt.model). Antes solo se pasaba el
// idioma, asi que la opcion existia, se validaba y no la usaba nadie: siempre
// se transcribia con "small".
const whisper = new WhisperTranscriber({
  language: config.stt.language,
  modelPath: whisperModel(config.stt.model),
});
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
    engine:
      (process.env['ALPHA_TTS_ENGINE'] as 'edge' | 'sapi') ?? av?.voice.engine ?? config.tts.engine,
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
  `  Avatar:    ${avatar ? `${avatar.name} — ${avatar.role}${avatar.confidential ? ' (confidencial)' : ''}` : '(ninguno)'}`,
);
console.log(
  `  Microfono: ${captureOptions.device}${captureOptions.gainDb ? ` (+${captureOptions.gainDb} dB)` : ''}${config.audio.micEnabled ? '' : '  — SILENCIADO (guardado)'}`,
);
console.log(`  Whisper:   modelo ${config.stt.model}, idioma ${config.stt.language}`);
console.log(
  `  Cerebro:   ${brainInfo.provider}/${brainInfo.model} ${brainInfo.local ? '(local)' : '(nube)'}`,
);
console.log(
  `  Voz:       ${voiceInfo.engine}/${voiceInfo.voice} ${voiceInfo.local ? '(local)' : '(nube)'}`,
);
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
// Las omitidas se DICEN. Sobre todo las que estan en cuarentena: una skill que
// escribio el agente y nadie ha aprobado no hace nada, y sin este aviso el
// usuario no se enteraria ni de que existe ni de que hay algo que revisar.
for (const sk of skills.skippedSkills()) {
  console.log(`     · omitida "${sk.name}": ${sk.reason}`);
}
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
        log(
          `   micro: pico ${db === -Infinity ? '−∞' : db.toFixed(0)} dBFS${speaking ? '  (voz)' : ''}`,
        );
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

// El mute es un ajuste persistido, no un estado de la sesion: si se dejo el
// microfono cerrado, se arranca cerrado (y el indicador del sistema, apagado).
if (!config.audio.micEnabled) session.setMicEnabled(false);

// Manda al avatar la lista de microfonos disponibles (al arrancar y cada vez
// que un avatar se conecta), marcando el activo.
async function sendDevices(): Promise<void> {
  try {
    const inputs = (await listInputDevices()).map((d) => ({
      name: d.name,
      isDefault: d.isDefault,
    }));
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
      model: a.model,
      confidential: a.confidential,
      voice: a.voice,
      image: a.image,
    })),
    ...(avatar ? { current: avatar.id } : {}),
  });
}

/** El catalogo del menu sale del mismo registro que valida el motor. */
const modelOptions: ModelOption[] = Object.entries(config.brain.providers).flatMap(
  ([providerId, provider]) =>
    (provider.models ?? []).map((name) => {
      const local = provider.local && !(provider.cloudModels ?? []).includes(name);
      return {
        ref: `${providerId}/${name}`,
        label: `${name} (${providerId}${local ? ', local' : ', nube'})`,
        local,
      };
    }),
);

function sendModels(): void {
  bridge.broadcast({ type: 'models', list: modelOptions });
}

// Voces disponibles en el sistema (SAPI locales + Edge en la nube).
// Se calcula una sola vez al arrancar.
let availableVoices: Awaited<ReturnType<typeof getAvailableVoices>> = [];
const voicesReady = getAvailableVoices()
  .then((v) => {
    availableVoices = v;
    log(`voces disponibles: ${v.length} (${v.filter((vo) => vo.local).length} locales)`);
  })
  .catch(() => {
    log(`no se pudieron enumerar las voces disponibles`);
  });

async function sendVoices(): Promise<void> {
  await voicesReady; // esperar a que se carguen
  bridge.broadcast({ type: 'voices', list: availableVoices });
}

/** Todo lo que hay que mandarle a un avatar recien autenticado. */
async function greetClient(): Promise<void> {
  void sendDevices();
  sendAvatars();
  sendModels();
  await sendVoices();
}

// Los manejadores del puente son sincronos (devuelven void): si se les pasa una
// funcion async, un fallo dentro se convierte en un rechazo que nadie recoge y
// tumba el proceso. Por eso se llama a la version async y se atrapa aqui.
bridge.onClientConnect(() => {
  greetClient().catch((err: unknown) => log(`✗ [avatar] ${(err as Error).message}`));
});
void sendDevices();

// Chat escrito desde el avatar: se responde como a la voz, mismo historial.
bridge.onTextInput((text) => {
  session.sendText(text).catch((err: unknown) => log(`✗ [texto] ${(err as Error).message}`));
});

// Cambios de configuracion desde el avatar (modelo, privacidad, microfono): se
// aplican en caliente sin cortar la sesion.
bridge.onConfigMessage((msg) => {
  applyConfig(msg).catch((err: unknown) => {
    const message = (err as Error).message;
    log(`✗ [config] ${message}`);
    bridge.broadcast({ type: 'config-error', message });
    sendAvatars();
  });
});

bridge.onAvatarConfigMessage((msg) => {
  applyAvatarConfig(msg).catch((err: unknown) => {
    const message = (err as Error).message;
    log(`✗ [avatar-config] ${message}`);
    bridge.broadcast({ type: 'config-error', message });
    // Confirmacion autoritativa: ante un rechazo la UI vuelve a pintar lo que
    // de verdad sigue guardado y no conserva una seleccion optimista.
    sendAvatars();
  });
});

async function applyConfig(msg: ConfigMessage): Promise<void> {
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

  if (!s.agent || s.agent === avatar?.id) return;
  const nextAvatar = avatarById(s.agent);
  if (!nextAvatar) throw new Error(`avatar desconocido: "${s.agent}"`);
  activateAvatar(nextAvatar);
}

/** Valida y activa un perfil completo: sus tres opciones viajan juntas. */
function activateAvatar(nextAvatar: AvatarProfile): void {
  const nextConfidential = confidentialForced || nextAvatar.confidential;
  const nextModel = process.env['ALPHA_MODEL'] ?? nextAvatar.model;
  const nextBrain = makeBrain(nextModel, nextConfidential, nextAvatar);
  const info = nextBrain.describe();
  const nextSpeaker = makeSpeaker(nextConfidential, nextAvatar);
  const voiceInfo = nextSpeaker.describe();

  brain = nextBrain;
  speaker = nextSpeaker;
  model = nextModel;
  confidential = nextConfidential;
  avatar = nextAvatar;
  session.reconfigure({ brain, speaker });
  sendAvatars();
  log(
    `⚙️  ${nextAvatar.name} · ${info.provider}/${info.model} · voz ${voiceInfo.voice}${confidential ? ' · confidencial' : ''}`,
  );
}

/** Cambia una opcion de un perfil, la guarda en avatars.yaml y la aplica si esta activo. */
async function applyAvatarConfig(msg: AvatarConfigMessage): Promise<void> {
  await voicesReady;
  const current = avatarById(msg.avatarId);
  if (!current) throw new Error(`avatar desconocido: "${msg.avatarId}"`);

  const nextModel = msg.settings.model ?? current.model;
  const modelOption = modelOptions.find((option) => option.ref === nextModel);
  if (!modelOption) throw new Error(`modelo desconocido: "${nextModel}"`);

  const currentVoiceId = `${current.voice.engine}:${current.voice.name}`;
  const nextVoiceId = msg.settings.voiceId ?? currentVoiceId;
  const voiceOption = availableVoices.find((option) => option.id === nextVoiceId);
  // Una voz ya guardada puede no aparecer en la enumeracion de este equipo
  // (por ejemplo, un perfil SAPI compartido entre dos Windows distintos).
  // Solo exigimos que figure en el catalogo cuando el usuario la cambia.
  if (msg.settings.voiceId !== undefined && !voiceOption) {
    throw new Error(`voz desconocida: "${nextVoiceId}"`);
  }

  const nextConfidential = msg.settings.confidential ?? current.confidential;
  if (nextConfidential && !modelOption.local) {
    throw new Error(`el modelo "${modelOption.label}" usa la nube`);
  }
  const voiceIsLocal = voiceOption?.local ?? current.voice.engine === 'sapi';
  if (nextConfidential && !voiceIsLocal) {
    throw new Error(`la voz "${voiceOption?.name ?? current.voice.name}" usa la nube`);
  }

  const patch: AvatarProfilePatch = {
    ...(msg.settings.model !== undefined ? { model: nextModel } : {}),
    ...(msg.settings.confidential !== undefined ? { confidential: nextConfidential } : {}),
    ...(msg.settings.voiceId !== undefined
      ? {
          voice: {
            engine: voiceOption!.engine,
            name: nextVoiceId.slice(nextVoiceId.indexOf(':') + 1),
            rate: current.voice.rate,
          },
        }
      : {}),
  };

  const candidate: AvatarProfile = {
    ...current,
    model: nextModel,
    confidential: nextConfidential,
    voice: patch.voice ?? current.voice,
  };

  // El perfil activo se valida por completo antes de tocar el disco.
  if (avatar?.id === current.id) {
    makeBrain(
      process.env['ALPHA_MODEL'] ?? candidate.model,
      confidentialForced || nextConfidential,
      candidate,
    ).describe();
    makeSpeaker(confidentialForced || nextConfidential, candidate).describe();
  }

  avatars = saveAvatarProfile(current.id, patch);
  const saved = avatarById(current.id)!;
  if (avatar?.id === current.id) activateAvatar(saved);
  else sendAvatars();
}

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
