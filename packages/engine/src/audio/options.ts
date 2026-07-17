import { defaultInputDevice } from './devices.js';
import type { CaptureOptions } from './capture.js';

/**
 * Opciones de captura tomadas del entorno, para que los spikes compartan la
 * misma configuracion sin repetirla:
 *   ALPHA_AUDIO_DEVICE    nombre exacto del dispositivo (si no, el del sistema)
 *   ALPHA_MIC_GAIN        ganancia fija en dB (micro constante pero flojo)
 *   ALPHA_MIC_NORMALIZE   1 para normalizacion dinamica (micro lejano/variable)
 */
export async function captureOptionsFromEnv(): Promise<Required<CaptureOptions>> {
  const device = process.env['ALPHA_AUDIO_DEVICE'] ?? (await defaultInputDevice()).name;
  const gainDb = Number(process.env['ALPHA_MIC_GAIN'] ?? 0);
  const normalize = process.env['ALPHA_MIC_NORMALIZE'] === '1';
  return { device, gainDb: Number.isFinite(gainDb) ? gainDb : 0, normalize };
}
