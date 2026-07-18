/**
 * Arranque de la UI del avatar de A.L.P.H.A.
 *
 * Ejecutar con qode (no con node): `npm run dev` en este paquete.
 * El motor headless se conectara mas adelante por WebSocket para mandar
 * cambios de estado; por ahora la ventana es autonoma.
 */
import { AvatarWindow } from './avatar-window.js';

const avatar = new AvatarWindow();
avatar.show();

// Mantener viva la referencia: sin esto el GC podria llevarse la ventana.
(globalThis as Record<string, unknown>)['__alphaAvatar'] = avatar;

console.log('A.L.P.H.A. avatar en marcha.');
console.log('  · Arrastra con el boton izquierdo para moverlo.');
console.log('  · Clic derecho: menu de configuracion (avatar, modelo, privacidad).');
console.log('  · Doble clic: cambia de estado (reposo/escuchando/pensando/hablando).');
