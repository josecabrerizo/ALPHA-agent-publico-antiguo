import {
  AvatarBridge,
  AVATAR_BRIDGE_PORT,
  type AvatarConfigMessage,
  type ConfigMessage,
  type ModelOption,
} from '@alpha/protocol';
import { WhisperTranscriber } from '../stt/whisper.js';
import { Brain } from '../brain/client.js';
import { ToolRegistry } from '../brain/tools/registry.js';
import { BUILTIN_TOOLS } from '../brain/tools/builtin.js';
import { SkillLibrary } from '../brain/skills/library.js';
import { skillsDir, whisperModel } from '../paths.js';
import { createSpeaker } from '../tts/speaker.js';
import { getAvailableVoices } from '../tts/voices.js';
import { listInputDevices, defaultInputDevice } from '../audio/devices.js';
import { loadConfig } from '../config/loader.js';
import {
  loadAvatars,
  saveAvatarProfile,
  type AvatarProfile,
  type AvatarProfilePatch,
} from '../config/avatars.js';
import { saveLiveSettings } from '../config/settings-store.js';
import { connectMcpProviders } from '../brain/mcp/provider.js';
import { isGreeting } from '../conversation/greeting.js';
import { ConversationSession, type ConversationState } from '../conversation/session.js';
import type { AlphaConfig } from '../config/schema.js';

/**
 * Composition root del motor: carga config y perfiles, construye la cadena
 * completa (whisper, cerebro, voz, sesion), levanta el puente del avatar y
 * cablea la reconfiguracion en caliente. Era el grueso del spike conversar;
 * ahora el spike es solo la consola y CUALQUIER proceso puede arrancar el
 * motor entero con una llamada.
 */

/** Lo que el anfitrion (la CLI, un test...) quiere ver pasar. Todo opcional. */
export interface EngineRuntimeCallbacks {
  onLog?: (message: string) => void;
  onState?: (state: ConversationState) => void;
  onUserText?: (text: string) => void;
  onAssistantText?: (text: string) => void;
  onLevel?: (level: number, speaking: boolean) => void;
  onMicChange?: (enabled: boolean) => void;
  onError?: (where: string, error: Error) => void;
}

/** Foto del arranque, para que la CLI pinte su banner sin rebuscar. */
export interface EngineRuntimeInfo {
  avatar?: { name: string; role: string; confidential: boolean };
  micDevice: string;
  micGainDb: number;
  brain: { provider: string; model: string; local: boolean };
  voice: { engine: string; voice: string; local: boolean };
  tools: string[];
  skills: string[];
  skippedSkills: { name: string; reason: string }[];
  confidential: boolean;
  bridgePort: number;
  bridgeUp: boolean;
}

export interface EngineRuntime {
  session: ConversationSession;
  bridge: AvatarBridge;
  config: AlphaConfig;
  info: EngineRuntimeInfo;
  /** Bucle principal (captura → VAD → turno). Resuelve al parar la sesion. */
  run(): Promise<void>;
  stop(): void;
}

export async function startEngineRuntime(cb: EngineRuntimeCallbacks = {}): Promise<EngineRuntime> {
  const log = (message: string) => cb.onLog?.(message);

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

  const whisper = new WhisperTranscriber({
    language: config.stt.language,
    modelPath: whisperModel(config.stt.model),
  });
  const skills = new SkillLibrary(skillsDir);
  await skills.load();
  const tools = new ToolRegistry().registerAll(BUILTIN_TOOLS).registerAll(skills.tools());

  // Servidores MCP declarados en la config: sus tools entran al MISMO registro
  // que las builtin y las skills. Un servidor caido se dice y se omite; los no
  // locales quedan sujetos al contrato confidencial (dos capas: el cerebro no
  // los ensena y su run() se niega).
  const mcpProviders = await connectMcpProviders(config.mcp.servers, log);
  for (const provider of mcpProviders) {
    for (const tool of provider.tools()) {
      // register() sobrescribe en silencio; una colision entre servidores (o
      // con una builtin) merece decirse antes de pisar.
      if (tools.has(tool.name)) log(`✗ [mcp] herramienta duplicada "${tool.name}": se sobrescribe`);
      tools.register(tool);
    }
  }

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
        (process.env['ALPHA_TTS_ENGINE'] as 'edge' | 'sapi') ??
        av?.voice.engine ??
        config.tts.engine,
      edgeVoice: av?.voice.engine === 'edge' ? av.voice.name : config.tts.edgeVoice,
      sapiVoice: av?.voice.engine === 'sapi' ? av.voice.name : config.tts.sapiVoice,
      rate: av?.voice.rate ?? config.tts.rate,
      confidential: conf,
    });

  let brain = makeBrain(model, confidential, avatar);
  let speaker = makeSpeaker(confidential, avatar);

  // Puente hacia el avatar: si esta abierto, refleja el estado y el texto.
  // Puerto configurable: si ya hay un motor corriendo, el puerto fijo esta
  // ocupado y el segundo se queda mudo sin decirlo. Con esto se puede levantar
  // otra instancia (probar cambios sin matar la que este en uso).
  const bridgePort = Number(process.env['ALPHA_BRIDGE_PORT']) || AVATAR_BRIDGE_PORT;
  const bridge = new AvatarBridge(bridgePort);
  const bridgeUp = await bridge.start();

  // Copia, no el mismo objeto: si la sesion y el runtime compartieran
  // captureOptions, mutar el device aqui haria que setAudioDevice lo viera "ya
  // aplicado" y no reiniciara la captura. currentMic lleva aparte cual es el activo.
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
        bridge.broadcast({ type: 'state', state: s });
        cb.onState?.(s);
      },
      onLevel: (level, speaking) => cb.onLevel?.(level, speaking),
      onLog: (m) => log(`   ${m}`),
      onMicChange: (enabled) => {
        // Con el micro cerrado no esta "escuchando": el avatar pasa a reposo.
        if (!enabled) bridge.broadcast({ type: 'state', state: 'reposo' });
        cb.onMicChange?.(enabled);
      },
      onUserText: (t) => {
        bridge.broadcast({ type: 'user', text: t });
        cb.onUserText?.(t);
      },
      onAssistantText: (t) => {
        bridge.broadcast({ type: 'assistant', text: t });
        // El gesto lo decide el MOTOR y viaja explicito: la UI no infiere nada
        // del texto (la ataba al idioma del agente).
        if (isGreeting(t)) bridge.broadcast({ type: 'gesture', gesture: 'saludo' });
        cb.onAssistantText?.(t);
      },
      onError: (where, err) => cb.onError?.(where, err),
    },
  });

  // El mute es un ajuste persistido, no un estado de la sesion: si se dejo el
  // microfono cerrado, se arranca cerrado (y el indicador del sistema, apagado).
  if (!config.audio.micEnabled) session.setMicEnabled(false);

  // Persistencia de los ajustes en vivo: el MOTOR es el unico que escribe el
  // fichero (la UI solo manda el cambio por el puente). No poder guardarlo se
  // avisa y se sigue: el ajuste ya esta aplicado.
  const persist = (patch: Parameters<typeof saveLiveSettings>[0]): void => {
    if (!saveLiveSettings(patch)) log(`no se pudo guardar alpha.settings.json`);
  };

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
        imageId: a.imageId,
        color: a.color,
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

  // Los manejadores del puente son sincronos (devuelven void): si se les pasa
  // una funcion async, un fallo dentro se convierte en un rechazo que nadie
  // recoge y tumba el proceso. Por eso se llama a la version async y se atrapa.
  bridge.onClientConnect(() => {
    greetClient().catch((err: unknown) => log(`✗ [avatar] ${(err as Error).message}`));
  });
  void sendDevices();

  // Chat escrito desde el avatar: se responde como a la voz, mismo historial.
  bridge.onTextInput((text) => {
    session.sendText(text).catch((err: unknown) => log(`✗ [texto] ${(err as Error).message}`));
  });

  // Cambios de configuracion desde el avatar (modelo, privacidad, microfono):
  // se aplican en caliente sin cortar la sesion.
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
      persist({ micEnabled: s.micEnabled });
    }

    // Microfono: reinicia la captura con el nuevo dispositivo. Se deja que
    // setAudioDevice sea quien actualiza el estado de la sesion.
    if (typeof s.audioDevice === 'string' && s.audioDevice && s.audioDevice !== currentMic) {
      currentMic = s.audioDevice;
      session.setAudioDevice(s.audioDevice);
      persist({ audioDevice: s.audioDevice });
      log(`⚙️  microfono desde el avatar: ${s.audioDevice}`);
    }

    if (!s.agent || s.agent === avatar?.id) return;
    const nextAvatar = avatarById(s.agent);
    if (!nextAvatar) throw new Error(`avatar desconocido: "${s.agent}"`);
    activateAvatar(nextAvatar);
    persist({ agent: nextAvatar.id });
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

  const brainInfo = brain.describe();
  const voiceInfo = speaker.describe();
  const info: EngineRuntimeInfo = {
    ...(avatar
      ? { avatar: { name: avatar.name, role: avatar.role, confidential: avatar.confidential } }
      : {}),
    micDevice: captureOptions.device,
    micGainDb: captureOptions.gainDb,
    brain: brainInfo,
    voice: voiceInfo,
    tools: tools.list().map((t) => t.name),
    skills: skills.list().map((s) => s.name),
    skippedSkills: skills.skippedSkills().map((s) => ({ name: s.name, reason: s.reason })),
    confidential,
    bridgePort,
    bridgeUp,
  };

  return {
    session,
    bridge,
    config,
    info,
    run: () => session.run(),
    stop: () => {
      session.stop();
      bridge.stop();
      // Cerrar es cortesia (mata el proceso hijo de un stdio); un fallo aqui
      // no puede impedir el apagado.
      for (const provider of mcpProviders) {
        provider.close().catch(() => {});
      }
    },
  };
}
