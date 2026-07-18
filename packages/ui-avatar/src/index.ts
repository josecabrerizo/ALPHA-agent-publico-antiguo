/**
 * Arranque de la UI del avatar de A.L.P.H.A.
 *
 * Ejecutar con qode (no con node): `npm run dev` en este paquete.
 * El motor headless se conectara mas adelante por WebSocket para mandar
 * cambios de estado; por ahora la ventana es autonoma.
 */
import { AvatarWindow } from './avatar-window.js';
import { connectBridge } from './bridge-client.js';

/** Log con marca de tiempo, como en el motor, para que la consola informe. */
function stamp(): string {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function log(message: string): void {
  console.log(`[${stamp()}] ${message}`);
}

const avatar = new AvatarWindow();
avatar.show();

// Mantener viva la referencia: sin esto el GC podria llevarse la ventana.
(globalThis as Record<string, unknown>)['__alphaAvatar'] = avatar;

// Conexion con el motor: refleja el estado de la conversacion en el orbe y
// muestra el ultimo texto. Si el motor no esta, reintenta hasta que aparezca.
const bridge = connectBridge((msg) => {
  if (msg.type === 'state') {
    avatar.setState(msg.state);
    log(`estado: ${msg.state}`);
  } else if (msg.type === 'user') {
    avatar.showCaption(`tú: ${msg.text}`);
    log(`tú    › ${msg.text}`);
  } else if (msg.type === 'assistant') {
    avatar.showCaption(msg.text);
    log(`ALPHA › ${msg.text}`);
  } else if (msg.type === 'devices') {
    avatar.setMicDevices(msg.inputs);
    log(`motor conectado · ${msg.inputs.length} micrófonos disponibles`);
  }
});
(globalThis as Record<string, unknown>)['__alphaBridge'] = bridge;

// Lo que se cambie en el menu del avatar viaja al motor: el avatar es el panel
// de control. (Si el motor no esta conectado, lo leera del fichero al arrancar.)
avatar.setOnSettingsChanged((settings) => {
  bridge.send({ type: 'config', settings });
  log(`config → motor: agente=${settings.agent}, modelo=${settings.model}, confidencial=${settings.confidential}, micro=${settings.audioDevice || '(sistema)'}`);
});

log('A.L.P.H.A. avatar en marcha.');
console.log('  · Arrastra con el botón izquierdo para moverlo.');
console.log('  · Clic derecho: menú de configuración (avatar, modelo, sonido, privacidad).');
console.log('  · Doble clic: cambia de estado.');
console.log('  · Esperando al motor ("npm run spike:conversar")…');
