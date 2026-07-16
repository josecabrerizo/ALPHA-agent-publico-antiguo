import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Pregunta a Windows cual es el microfono predeterminado del sistema.
 *
 * No hay forma de averiguarlo sin Core Audio: el registro guarda los endpoints
 * y su estado, pero no que rol tiene cada uno. Y DirectShow, que es de donde
 * tira ffmpeg, ni siquiera tiene el concepto de "predeterminado": entrega los
 * dispositivos en un orden arbitrario. Asi que se invoca la COM
 * IMMDeviceEnumerator via PowerShell.
 *
 * Devuelve el GUID del endpoint en minusculas, que coincide con el
 * `wave_{GUID}` del nombre alternativo que da ffmpeg. Se empareja por GUID y
 * no por nombre a proposito: los nombres de dshow se truncan y se repiten.
 */

/** eConsole = 0, eMultimedia = 1, eCommunications = 2. */
export type AudioRole = 'console' | 'communications';

const ROLE_ID: Record<AudioRole, number> = { console: 0, communications: 2 };

const PS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$code = @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumeratorComObject { }
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int NotImpl1();
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppDevice);
}
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
  int OpenPropertyStore(int stgmAccess, out IntPtr ppProperties);
  int GetId([MarshalAs(UnmanagedType.LPWStr)] out string ppstrId);
}
public static class AlphaDefaultMic {
  public static string Get(int role) {
    var en = (IMMDeviceEnumerator)(new MMDeviceEnumeratorComObject());
    IMMDevice dev; string id;
    // dataFlow 1 = eCapture. Un HRESULT != 0 aqui suele ser "no hay ningun
    // microfono": no es excepcional, se devuelve vacio y decide el llamante.
    if (en.GetDefaultAudioEndpoint(1, role, out dev) != 0) { return ""; }
    dev.GetId(out id);
    return id;
  }
}
'@
Add-Type -TypeDefinition $code
[AlphaDefaultMic]::Get(__ROLE__)
`;

/**
 * GUID del microfono predeterminado, o undefined si no se puede averiguar.
 *
 * Nunca lanza: si Core Audio o PowerShell fallan, el llamante debe poder
 * seguir con su heuristica. Quedarse sin microfono por no poder preguntar
 * cual es el preferido seria peor que usar otro.
 */
export async function systemDefaultCaptureGuid(
  role: AudioRole = 'console',
): Promise<string | undefined> {
  if (process.platform !== 'win32') return undefined;

  const script = PS_SCRIPT.replace('__ROLE__', String(ROLE_ID[role]));
  // -EncodedCommand evita por completo el infierno de comillas entre cmd.exe,
  // PowerShell y el here-string de C#.
  const encoded = Buffer.from(script, 'utf16le').toString('base64');

  try {
    const { stdout } = await execFileAsync(
      'powershell',
      ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded],
      { timeout: 20_000 },
    );
    // Formato: {0.0.1.00000000}.{be5ca08c-a179-4528-9294-c0ce75ad2713}
    const match = /\{([0-9a-f-]{36})\}\s*$/i.exec(stdout.trim());
    return match?.[1]?.toLowerCase();
  } catch {
    return undefined;
  }
}
