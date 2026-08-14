import { spawn } from 'node:child_process';
import audify from 'audify';
import type { CaptureHandle } from './capture.js';
import { SAMPLE_RATE, CHANNELS } from './format.js';

const { RtAudio } = audify;

// audify declara RtAudioApi/RtAudioFormat como `const enum` NO exportados:
// invisibles para TS (y ademas chocan con verbatimModuleSyntax). Pero en
// runtime son objetos reales. Se leen de ahi, en vez de fijar numeros magicos
// que se romperian si audify los renumera. El de la API necesita ademas el tipo
// exacto que espera el constructor, que si es publico.
type ApiArg = ConstructorParameters<typeof RtAudio>[0];
const rtEnums = audify as unknown as {
  RtAudioApi: { WINDOWS_WASAPI: number };
  RtAudioFormat: { RTAUDIO_SINT16: number };
};
const WASAPI = rtEnums.RtAudioApi.WINDOWS_WASAPI as ApiArg;
const SINT16 = rtEnums.RtAudioFormat.RTAUDIO_SINT16;

/**
 * SOLO WINDOWS. Todo este modulo abre el mezclador por WASAPI loopback, que es
 * una API de Windows: en Linux el equivalente es monitorizar el sink de
 * PipeWire/PulseAudio, y eso no esta implementado todavia. Se comprueba y se
 * dice; antes se construia RtAudio(WINDOWS_WASAPI) igualmente y el fallo salia
 * como un error opaco del modulo nativo.
 */
function requireWindows(): void {
  if (process.platform === 'win32') return;
  throw new Error(
    `La captura del audio del sistema es solo para Windows (WASAPI loopback); ` +
      `este equipo es ${process.platform}. En Linux hara falta leer el monitor ` +
      `de PipeWire/PulseAudio, que aun no esta implementado.`,
  );
}

export interface LoopbackOptions {
  /**
   * Nombre del dispositivo de SALIDA cuyo audio capturar. Por defecto, la
   * salida predeterminada del sistema (lo que el usuario esta oyendo).
   */
  outputDeviceName?: string;
  gainDb?: number;
  normalize?: boolean;
}

/**
 * Captura lo que suena en el PC (audio del sistema) por WASAPI loopback.
 * SOLO WINDOWS: ver requireWindows.
 *
 * Es la unica via automatica en Windows: no necesita Mezcla estereo, ni cable
 * virtual, ni que el usuario habilite nada. Se abre el dispositivo de SALIDA
 * como si fuera de entrada y el sistema entrega una copia de la mezcla.
 *
 * ffmpeg no soporta WASAPI, asi que aqui si se usa un modulo nativo (audify,
 * RtAudio) — con prebuilds N-API, sin compilar. El plan ya contemplaba modulos
 * nativos con prebuilds para el audio; este es el caso donde ffmpeg no llega.
 *
 * WASAPI entrega 48 kHz estereo (el formato del mezclador), pero el resto del
 * motor trabaja en 16 kHz mono. El remuestreo se delega a ffmpeg leyendo el PCM
 * por stdin, de modo que la salida es identica a la de captureMicrophone y VAD
 * y whisper no distinguen el origen.
 */
export function captureSystemAudio(options: LoopbackOptions = {}): CaptureHandle {
  requireWindows();
  const rtaudio = new RtAudio(WASAPI);
  const device = pickOutputDevice(rtaudio, options.outputDeviceName);

  // Loopback exige el formato nativo del dispositivo; forzar otro rate falla.
  const inputRate = device.preferredSampleRate;
  const inputChannels = Math.min(2, device.outputChannels);

  const ffmpeg = spawn(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-f',
      's16le',
      '-ar',
      String(inputRate),
      '-ac',
      String(inputChannels),
      '-i',
      'pipe:0',
      ...buildFilterArgs(options),
      '-ar',
      String(SAMPLE_RATE),
      '-ac',
      String(CHANNELS),
      '-f',
      's16le',
      'pipe:1',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );

  let stderr = '';
  ffmpeg.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  ffmpeg.on('close', (code) => {
    if (code !== 0 && code !== null && !ffmpeg.stdout.destroyed) {
      ffmpeg.stdout.destroy(
        new Error(`ffmpeg (resample) fallo (codigo ${code}): ${stderr.trim()}`),
      );
    }
  });

  // El tamano de trama (1920 = 40 ms @48k) equilibra latencia y sobrecarga de
  // callbacks. audify entrega PCM s16le intercalado; se vuelca tal cual a ffmpeg.
  const frameSize = Math.round((inputRate * 40) / 1000);
  rtaudio.openStream(
    null,
    { deviceId: device.id, nChannels: inputChannels, firstChannel: 0 },
    SINT16,
    inputRate,
    frameSize,
    'alpha-loopback',
    (pcm: Buffer) => {
      // Si ffmpeg ya murio, no reventar por escribir en un pipe cerrado.
      if (ffmpeg.stdin.writable) ffmpeg.stdin.write(Buffer.from(pcm));
    },
    null,
  );
  rtaudio.start();

  let stopped = false;
  return {
    pcm: ffmpeg.stdout,
    stop: () => {
      if (stopped) return;
      stopped = true;
      try {
        rtaudio.stop();
        rtaudio.closeStream();
      } catch {
        // cerrar dos veces o sobre un stream ya muerto no debe propagar
      }
      ffmpeg.stdin.end();
    },
  };
}

type RtDevice = ReturnType<InstanceType<typeof RtAudio>['getDevices']>[number];

function pickOutputDevice(
  rtaudio: InstanceType<typeof RtAudio>,
  name: string | undefined,
): RtDevice {
  const devices = rtaudio.getDevices().filter((d) => d.outputChannels > 0);
  if (devices.length === 0) {
    throw new Error('No hay ningun dispositivo de salida para capturar por loopback.');
  }
  if (name) {
    const match = devices.find((d) => d.name === name);
    if (!match) {
      const lista = devices.map((d) => `  · ${d.name}`).join('\n');
      throw new Error(`No se encontro la salida "${name}". Disponibles:\n${lista}`);
    }
    return match;
  }
  return devices.find((d) => d.isDefaultOutput) ?? devices[0]!;
}

function buildFilterArgs(options: LoopbackOptions): string[] {
  const filters: string[] = [];
  if (options.gainDb) filters.push(`volume=${options.gainDb}dB`);
  if (options.normalize) filters.push('dynaudnorm=f=150:g=15:m=64:p=0.9');
  return filters.length > 0 ? ['-af', filters.join(',')] : [];
}

/** Nombres de las salidas disponibles, para elegir cual capturar. SOLO WINDOWS. */
export function listOutputDevices(): string[] {
  requireWindows();
  const rtaudio = new RtAudio(WASAPI);
  return rtaudio
    .getDevices()
    .filter((d) => d.outputChannels > 0)
    .map((d) => (d.isDefaultOutput ? `${d.name}  (predeterminado)` : d.name));
}
