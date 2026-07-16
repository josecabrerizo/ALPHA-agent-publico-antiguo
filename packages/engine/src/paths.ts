import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * Raiz del monorepo.
 *
 * Vale igual desde src/ (tsx) que desde dist/ (compilado): ambos cuelgan al
 * mismo nivel dentro de packages/engine, asi que la distancia no cambia.
 */
export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

export const vendorDir = path.join(repoRoot, 'vendor');
export const modelsDir = path.join(repoRoot, 'models');

export const whisperBinary = path.join(
  vendorDir,
  'whisper',
  process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli',
);

export function whisperModel(size = 'small'): string {
  return path.join(modelsDir, `ggml-${size}.bin`);
}
