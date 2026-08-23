/**
 * Superficie publica del motor de A.L.P.H.A.
 *
 * La cadena audio→texto→cerebro→voz, mas el puente con el avatar, que se
 * re-exporta desde @alpha/protocol (alli vive el protocolo completo).
 */
export {
  AvatarBridge,
  connectBridge,
  AVATAR_BRIDGE_PORT,
  PROTOCOL_VERSION,
  alphaHomeDir,
  bridgeTokenPathFor,
} from '@alpha/protocol';
export type {
  EngineToAvatarMessage,
  AvatarToEngineMessage,
  AuthMessage,
  ConfigMessage,
  AvatarConfigMessage,
  TextInputMessage,
  AvatarOption,
  ModelOption,
  VoiceOption,
  AvatarWireState,
  BridgeHandle,
} from '@alpha/protocol';
export { captureMicrophone, type CaptureHandle, type CaptureOptions } from './audio/capture.js';
export { captureSystemAudio, listOutputDevices, type LoopbackOptions } from './audio/loopback.js';
export { listInputDevices, defaultInputDevice, type AudioDevice } from './audio/devices.js';
export { detectUtterances, type Utterance, type VadOptions } from './audio/vad.js';
export { WhisperTranscriber, type WhisperOptions } from './stt/whisper.js';
export { SAMPLE_RATE, CHANNELS, pcmToWav } from './audio/format.js';
export { Brain, type ChatMessage, type BrainOptions, type AgentEvent } from './brain/client.js';
export { ToolRegistry } from './brain/tools/registry.js';
export { BUILTIN_TOOLS } from './brain/tools/builtin.js';
export type { Tool, ToolContext } from './brain/tools/types.js';
export { SkillLibrary } from './brain/skills/library.js';
export { loadSkills } from './brain/skills/loader.js';
export type { Skill } from './brain/skills/types.js';
export { DEFAULT_BRAIN_CONFIG } from './brain/config.js';
export { resolveModel } from './brain/registry.js';
export type { BrainConfig, ProviderConfig, ResolvedModel } from './brain/types.js';
export { createSpeaker, createLocalSpeaker, hasLocalVoice } from './tts/speaker.js';
export {
  DEFAULT_TTS_CONFIG,
  type Speaker,
  type TtsConfig,
  type VoiceEngine,
  type VoiceBackend,
} from './tts/types.js';
