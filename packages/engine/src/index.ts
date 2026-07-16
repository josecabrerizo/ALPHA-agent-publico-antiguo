/**
 * Superficie publica del motor de A.L.P.H.A.
 *
 * De momento solo la cadena audio→texto. El servidor IPC que consumira la UI
 * del avatar entra cuando exista algo que servir mas alla de transcripciones.
 */
export { captureMicrophone, type CaptureHandle, type CaptureOptions } from './audio/capture.js';
export { listInputDevices, defaultInputDevice, type AudioDevice } from './audio/devices.js';
export { detectUtterances, type Utterance, type VadOptions } from './audio/vad.js';
export { WhisperTranscriber, type WhisperOptions } from './stt/whisper.js';
export { SAMPLE_RATE, CHANNELS, pcmToWav } from './audio/format.js';
