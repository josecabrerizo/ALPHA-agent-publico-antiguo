import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface AudioDevice {
  /** Nombre tal cual lo espera ffmpeg en -i audio="..." */
  name: string;
}

/**
 * Enumera microfonos.
 *
 * ffmpeg escupe la lista por stderr y SIEMPRE termina con codigo != 0
 * ("Error opening input file dummy"), asi que el fallo es el camino normal:
 * hay que leer stderr del error, no tratarlo como excepcion.
 */
export async function listInputDevices(): Promise<AudioDevice[]> {
  if (process.platform === 'win32') {
    return listDshowDevices();
  }
  // En Linux ffmpeg toma el device por nombre de PulseAudio/PipeWire.
  // "default" cubre el caso normal sin enumerar.
  return [{ name: 'default' }];
}

async function listDshowDevices(): Promise<AudioDevice[]> {
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
    stderr = (error as { stderr?: string }).stderr ?? '';
    if (!stderr) throw error;
  }

  const devices: AudioDevice[] = [];
  for (const line of stderr.split(/\r?\n/)) {
    // Formato: [in#0 @ 0x...] "Nombre del dispositivo" (audio)
    const match = /"([^"]+)"\s+\(audio\)/.exec(line);
    if (match?.[1]) devices.push({ name: match[1] });
  }
  return devices;
}

/** Primer microfono disponible, o error con la lista vacia explicada. */
export async function defaultInputDevice(): Promise<AudioDevice> {
  const devices = await listInputDevices();
  const first = devices[0];
  if (!first) {
    throw new Error(
      'No se encontro ningun dispositivo de entrada de audio. ' +
        'Comprueba que hay un microfono conectado y habilitado en el sistema.',
    );
  }
  return first;
}
