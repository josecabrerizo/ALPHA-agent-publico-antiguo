/**
 * Superficie publica del motor de A.L.P.H.A.
 *
 * De momento solo la cadena audio→texto. El servidor IPC que consumira la UI
 * del avatar entra cuando exista algo que servir mas alla de transcripciones.
 */
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
export { DEFAULT_BRAIN_CONFIG } from './brain/config.js';
export { resolveModel } from './brain/registry.js';
export type { BrainConfig, ProviderConfig, ResolvedModel } from './brain/types.js';
export { createSpeaker } from './tts/speaker.js';
export { DEFAULT_TTS_CONFIG, type Speaker, type TtsConfig, type VoiceEngine } from './tts/types.js';
