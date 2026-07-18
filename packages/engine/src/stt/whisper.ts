import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { availableParallelism } from 'node:os';
import { pcmToWav } from '../audio/format.js';
import { whisperBinary, whisperModel } from '../paths.js';

const execFileAsync = promisify(execFile);

export interface WhisperOptions {
  binaryPath?: string;
  modelPath?: string;
  /** Codigo ISO ('es', 'en') o 'auto' para detectar. */
  language?: string;
  threads?: number;
  /**
   * Tamano del haz de busqueda. Por defecto whisper-cli decodifica en modo
   * voraz (beam=1): rapido pero se traga silabas con mala diccion. Con un haz
   * de 5 explora varias hipotesis y acierta bastante mas, a cambio de algo mas
   * de CPU. 0/1 = voraz.
   */
  beamSize?: number;
  /**
   * Texto de contexto que sesga la transcripcion (nombres propios, jerga del
   * dominio, el idioma). whisper lo usa como "lo dicho justo antes", asi que
   * ancla el vocabulario esperado.
   */
  initialPrompt?: string;
}

/**
 * STT sobre el binario oficial de whisper.cpp, spawneado como proceso.
 *
 * No se usa ningun addon .node a proposito: los bindings publicados en npm
 * traen prebuilds compilados contra el ABI de Electron, que no cargan en Node,
 * y las alternativas exigen compilar whisper.cpp en cada maquina. El binario
 * oficial trae releases por plataforma y no depende de la version de Node.
 */
export class WhisperTranscriber {
  private readonly binaryPath: string;
  private readonly modelPath: string;
  private readonly language: string;
  private readonly threads: number;
  private readonly beamSize: number;
  private readonly initialPrompt: string | undefined;
  private checked = false;

  constructor(options: WhisperOptions = {}) {
    this.binaryPath = options.binaryPath ?? whisperBinary;
    this.modelPath = options.modelPath ?? whisperModel();
    this.language = options.language ?? 'es';
    this.threads = options.threads ?? Math.min(8, Math.max(1, availableParallelism() - 2));
    this.beamSize = options.beamSize ?? 5;
    this.initialPrompt = options.initialPrompt;
  }

  /** Transcribe un tramo de PCM s16le 16 kHz mono. Cadena vacia si no hay habla. */
  async transcribe(pcm: Buffer): Promise<string> {
    await this.ensureReady();

    const dir = await mkdtemp(path.join(tmpdir(), 'alpha-stt-'));
    const wavPath = path.join(dir, 'utterance.wav');
    try {
      await writeFile(wavPath, pcmToWav(pcm));
      const args = [
        '-m',
        this.modelPath,
        '-f',
        wavPath,
        '-l',
        this.language,
        '-t',
        String(this.threads),
        '-nt', // sin marcas de tiempo
        '-np', // sin cabeceras ni progreso: solo el texto
      ];
      if (this.beamSize > 1) args.push('-bs', String(this.beamSize));
      if (this.initialPrompt) args.push('--prompt', this.initialPrompt);

      const { stdout } = await execFileAsync(this.binaryPath, args);
      return cleanTranscript(stdout);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private async ensureReady(): Promise<void> {
    if (this.checked) return;
    for (const [file, what] of [
      [this.binaryPath, 'el binario de whisper.cpp'],
      [this.modelPath, 'el modelo de whisper'],
    ] as const) {
      try {
        await access(file);
      } catch {
        throw new Error(`No se encuentra ${what} en ${file}. Ejecuta: npm run setup:stt`);
      }
    }
    this.checked = true;
  }
}

/**
 * Limpia la salida cruda de whisper.cpp:
 * - Etiquetas de ruido/silencio entre corchetes o parentesis ([BLANK_AUDIO],
 *   (musica)): dejarlas pasar convertiria un carraspeo en un turno.
 * - Marcas de turno ">>" que whisper hereda de sus datos de subtitulos.
 */
function cleanTranscript(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[[(][^\])]*[\])]/g, '') // [BLANK_AUDIO], (musica)
        .replace(/^\s*>>+\s*/, '') // marca de turno al inicio
        .trim(),
    )
    .filter((line) => line.length > 0)
    .join(' ')
    .trim();
}
