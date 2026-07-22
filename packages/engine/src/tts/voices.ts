/**
 * Enumeración de voces disponibles para TTS: SAPI (local) y Edge (nube).
 * El motor manda esta lista al avatar para que el usuario pueda elegir.
 */
import { spawn } from 'node:child_process';
import type { VoiceOption } from '../conversation/avatar-bridge.js';

/**
 * Lee las voces SAPI instaladas en Windows. Devuelve [] en otros SO o si
 * PowerShell falla. Util para el avatar: permite elegir entre las voces
 * del sistema sin probar todas ciegamente.
 */
export async function listSapiVoices(): Promise<string[]> {
  if (process.platform !== 'win32') return [];

  return new Promise((resolve) => {
    const script = [
      'Add-Type -AssemblyName System.Speech',
      '(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() |',
      'Select-Object -ExpandProperty VoiceInfo |',
      'Select-Object -ExpandProperty Name',
    ].join('; ');

    let output = '';
    const ps = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });

    ps.stdout?.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8');
    });

    ps.on('close', () => {
      const voices = output
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      resolve(voices);
    });

    ps.on('error', () => resolve([]));
    setTimeout(() => ps.kill(), 5000); // timeout
  });
}

/** Las 45 voces españolas de Edge. */
const EDGE_SPANISH_VOICES = [
  'es-AR-ElmarNeural',
  'es-AR-SofíaNeural',
  'es-BO-AymiNeural',
  'es-BO-SusanaNeural',
  'es-CL-CatalinaNeural',
  'es-CL-LorenzoNeural',
  'es-CO-GonzaloNeural',
  'es-CO-SalomeNeural',
  'es-CR-JuanNeural',
  'es-CR-MariaNeural',
  'es-CU-ManuelNeural',
  'es-CU-BelkysNeural',
  'es-DO-EmilioNeural',
  'es-DO-MargaritaNeural',
  'es-EC-AndreaNeural',
  'es-EC-LuisNeural',
  'es-ES-AlvaroNeural',
  'es-ES-ElviraNeural',
  'es-ES-EstrellaNeural',
  'es-ES-IreneNeural',
  'es-ES-LauraNeural',
  'es-ES-PabloNeural',
  'es-ES-XimenaNeural',
  'es-GQ-JavierNeural',
  'es-GQ-TeresaNeural',
  'es-GT-CarlosNeural',
  'es-GT-MariaNeural',
  'es-HN-CarlosNeural',
  'es-HN-MariaNeural',
  'es-MX-BeatrizNeural',
  'es-MX-CandelaNeural',
  'es-MX-CeciliaNeural',
  'es-MX-ChuiNeural',
  'es-MX-DaliaNeural',
  'es-MX-GerardoNeural',
  'es-MX-GiseleNeural',
  'es-MX-GuadalupeNeural',
  'es-MX-JorgeNeural',
  'es-MX-LarissaNeural',
  'es-MX-LissetteNeural',
  'es-MX-RenatNeural',
  'es-NI-FranciscoNeural',
  'es-NI-VeronicaNeural',
  'es-PA-MargaritaNeural',
  'es-PA-RobertoNeural',
  'es-PE-AlexNeural',
  'es-PE-AnnieNeural',
  'es-PE-CamilaNeural',
  'es-PE-CeciliaNeural',
  'es-PE-ChicaNeural',
  'es-PE-EdithNeural',
  'es-PE-ElsaNeural',
  'es-PE-FernandoNeural',
  'es-PE-GracielaNeural',
  'es-PE-JoseNeural',
  'es-PE-LauraNeural',
  'es-PE-LeilaNeural',
  'es-PE-LuisNeural',
  'es-PE-MartinNeural',
  'es-PE-MateoNeural',
  'es-PE-MonicaNeural',
  'es-PE-OfeliaNeural',
  'es-PE-PaulaNeural',
  'es-PE-RicardoNeural',
  'es-PE-SofiaNeural',
  'es-PE-TatianaNeural',
  'es-PR-CarlosNeural',
  'es-PR-LeilaNeural',
  'es-PY-MarioNeural',
  'es-PY-ParaguayaNeural',
  'es-SV-LorenaNeural',
  'es-SV-RodrigoNeural',
  'es-US-AlonsoNeural',
  'es-US-PalomaNeural',
  'es-UY-MateoNeural',
  'es-UY-ValentinaNeural',
  'es-VE-JamesNeural',
  'es-VE-PaolaNeural',
];

/**
 * Recopila todas las voces disponibles: SAPI (local) + Edge (nube).
 * El avatar las muestra con etiqueta de privacidad.
 */
export async function getAvailableVoices(): Promise<VoiceOption[]> {
  const voices: VoiceOption[] = [];

  const sapi = await listSapiVoices();
  for (const name of sapi) {
    voices.push({
      id: `sapi:${name}`,
      name: `${name} (local)`,
      engine: 'sapi',
      local: true,
    });
  }

  for (const id of EDGE_SPANISH_VOICES) {
    // es-ES-ElviraNeural -> Elvira (Spain, nube)
    const parts = id.split('-');
    const shortName = (parts[2] ?? '').replace('Neural', '');
    voices.push({
      id: `edge:${id}`,
      name: `${shortName} (nube)`,
      engine: 'edge',
      local: false,
    });
  }

  return voices;
}
