/**
 * Arranque de la UI del avatar de A.L.P.H.A.
 *
 * Ejecutar con qode (no con node): `npm run dev` en este paquete.
 * El motor headless se conectara mas adelante por WebSocket para mandar
 * cambios de estado; por ahora la ventana es autonoma.
 */
import { AvatarWindow } from './avatar-window.js';
import { connectBridge } from './bridge-client.js';

const avatar = new AvatarWindow();
avatar.show();

// Mantener viva la referencia: sin esto el GC podria llevarse la ventana.
(globalThis as Record<string, unknown>)['__alphaAvatar'] = avatar;

// Conexion con el motor: refleja el estado de la conversacion en el orbe y
// muestra el ultimo texto. Si el motor no esta, reintenta hasta que aparezca.
const bridge = connectBridge((msg) => {
  if (msg.type === 'state') avatar.setState(msg.state);
  else if (msg.type === 'user') avatar.showCaption(`tú: ${msg.text}`);
  else if (msg.type === 'assistant') avatar.showCaption(msg.text);
});
(globalThis as Record<string, unknown>)['__alphaBridge'] = bridge;

console.log('A.L.P.H.A. avatar en marcha.');
console.log('  · Arrastra con el boton izquierdo para moverlo.');
console.log('  · Clic derecho: menu de configuracion (avatar, modelo, privacidad).');
console.log('  · Doble clic: cambia de estado (reposo/escuchando/pensando/hablando).');
console.log('  · Conectado al motor si "npm run spike:conversar" esta en marcha.');
