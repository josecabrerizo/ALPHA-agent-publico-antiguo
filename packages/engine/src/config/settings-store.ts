import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../paths.js';

/**
 * Escritor UNICO de config/alpha.settings.json, los ajustes en vivo que la UI
 * cambia desde su menu. Antes lo escribia la UI y lo leia el motor, cada uno
 * por su lado y sin coordinacion; ahora los cambios viajan por el puente, el
 * motor los aplica y AQUI se persisten: una sola mano sobre el fichero. El
 * loader lo sigue leyendo como ultima capa de la cascada de configuracion.
 */
export interface LiveSettingsPatch {
  agent?: string;
  audioDevice?: string;
  micEnabled?: boolean;
}

const settingsPath = path.join(repoRoot, 'config', 'alpha.settings.json');

/**
 * Fusiona el parche sobre lo que haya y lo escribe de forma atomica (temporal
 * + rename, como avatars.yaml). Devuelve false si no se pudo escribir: el
 * ajuste ya esta aplicado en vivo, asi que no poder persistirlo se avisa pero
 * no interrumpe nada.
 */
export function saveLiveSettings(patch: LiveSettingsPatch, file = settingsPath): boolean {
  let current: Record<string, unknown> = {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      current = parsed as Record<string, unknown>;
    }
  } catch {
    // sin fichero o corrupto: se parte de cero
  }

  const next = { ...current, ...patch };
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(tmp, JSON.stringify(next, null, 2), { encoding: 'utf8' });
    renameSync(tmp, file);
    return true;
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      // el temporal se queda; no es motivo para fallar mas fuerte
    }
    return false;
  }
}
