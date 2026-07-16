import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { systemDefaultCaptureGuid } from './default-device.js';

const execFileAsync = promisify(execFile);

export interface AudioDevice {
  /** Nombre tal cual lo espera ffmpeg en -i audio="..." */
  name: string;
  /** GUID del endpoint (Windows). Identifica al dispositivo mejor que el nombre. */
  guid?: string;
  /** Es el microfono predeterminado del sistema. */
  isDefault: boolean;
}

/**
 * Enumera microfonos, marcando cual es el predeterminado del sistema.
 *
 * En Windows la lista sale de DirectShow, que no dice cual es el preferido ni
 * en que orden vienen; el predeterminado se pregunta aparte a Core Audio y se
 * empareja por GUID. Ojo: dshow solo lista dispositivos realmente conectados,
 * asi que un casco desenchufado desaparece de aqui.
 */
export async function listInputDevices(): Promise<AudioDevice[]> {
  if (process.platform !== 'win32') {
    // PulseAudio/PipeWire ya resuelven "default" al preferido del sistema,
    // asi que no hay nada que emparejar.
    return [{ name: 'default', isDefault: true }];
  }

  const devices = await listDshowDevices();
  const defaultGuid = await systemDefaultCaptureGuid();

  return devices.map((device) => ({
    ...device,
    isDefault: defaultGuid !== undefined && device.guid === defaultGuid,
  }));
}

async function listDshowDevices(): Promise<Array<{ name: string; guid?: string }>> {
  let stderr = '';
  try {
    const result = await execFileAsync('ffmpeg', [
      '-hide_banner',
      '-list_devices',
      'true',
      '-f',
      'dshow',
      '-i',
      'dummy',
    ]);
    stderr = result.stderr;
  } catch (error) {
    // ffmpeg escupe la lista por stderr y SIEMPRE sale con codigo != 0
    // ("Error opening input file dummy"): el fallo es el camino normal.
    stderr = (error as { stderr?: string }).stderr ?? '';
    if (!stderr) throw error;
  }

  const devices: Array<{ name: string; guid?: string }> = [];
  for (const line of stderr.split(/\r?\n/)) {
    // "Nombre del dispositivo" (audio)
    const nameMatch = /"([^"]+)"\s+\(audio\)/.exec(line);
    if (nameMatch?.[1]) {
      devices.push({ name: nameMatch[1] });
      continue;
    }
    // La linea siguiente trae:  Alternative name "...\wave_{GUID}"
    const guidMatch = /Alternative name\s+"[^"]*wave_\{([0-9A-Fa-f-]{36})\}"/.exec(line);
    const last = devices[devices.length - 1];
    if (guidMatch?.[1] && last && last.guid === undefined) {
      last.guid = guidMatch[1].toLowerCase();
    }
  }
  return devices;
}

/**
 * El microfono que debe usar el asistente.
 *
 * Prioridad: el predeterminado del sistema, y si no se puede averiguar, el
 * primero que liste dshow. Respetar la configuracion de Windows importa: el
 * orden de dshow es arbitrario y puede colocar primero un dispositivo que el
 * usuario no usa.
 */
export async function defaultInputDevice(): Promise<AudioDevice> {
  const devices = await listInputDevices();
  const preferred = devices.find((device) => device.isDefault) ?? devices[0];

  if (!preferred) {
    throw new Error(
      'No se encontro ningun microfono conectado. Conecta uno y vuelve a intentarlo.\n' +
        '(En Windows, un dispositivo desenchufado no aparece en la lista.)',
    );
  }
  return preferred;
}
