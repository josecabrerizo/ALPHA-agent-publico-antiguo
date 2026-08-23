/**
 * Arranque de la UI del avatar de A.L.P.H.A.
 *
 * Ejecutar con qode (no con node): `npm run dev` en este paquete.
 * Con el motor se habla por el puente de @alpha/protocol (TCP local, un JSON
 * por linea); si el motor no esta, la ventana funciona sola y reintenta.
 */
import { AvatarWindow } from './avatar-window.js';
import { connectBridge, type AvatarConfigMessage, type ConfigMessage } from '@alpha/protocol';
import { loadPendiente, savePendiente } from './settings.js';
import { log } from './log.js';

const avatar = new AvatarWindow();
avatar.show();

// Mantener viva la referencia: sin esto el GC podria llevarse la ventana.
(globalThis as Record<string, unknown>)['__alphaAvatar'] = avatar;

// Cambios hechos SIN motor: se acumulan y se reenvian al autenticar. El caso
// que importa es el mute pre-arranque — es una promesa de privacidad y no
// puede perderse en silencio, NI SIQUIERA reiniciando la UI antes de conectar:
// por eso el parche se persiste junto a la cache y se recupera al arrancar.
let pendiente: ConfigMessage['settings'] = loadPendiente();
// Los cambios de PERFIL (modelo, voz, confidencial de un avatar) tambien: el
// menu sigue operativo con los catalogos cacheados durante un reinicio del
// motor, y "activar confidencial" descartado en silencio dejaria al perfil
// usando la nube creyendose local.
const pendientesPerfil: AvatarConfigMessage[] = [];

// Conexion con el motor: refleja el estado de la conversacion en el orbe y
// muestra el ultimo texto. Si el motor no esta, reintenta hasta que aparezca.
/**
 * Confirmacion POR CAMPO del parche pendiente: solo cuando el estado
 * autoritativo del motor dice que un valor ya es el suyo, esa promesa queda
 * cumplida y se limpia. Enviar no basta — send() solo garantiza que el socket
 * estaba escribible, y un motor que caiga con el envio en el buffer no lo
 * habra aplicado ni persistido: el parche debe sobrevivir para reintentarse.
 */
function confirmarPendiente<K extends keyof ConfigMessage['settings']>(
  campo: K,
  valor: ConfigMessage['settings'][K],
): void {
  if (pendiente[campo] === undefined || pendiente[campo] !== valor) return;
  delete pendiente[campo];
  savePendiente(Object.keys(pendiente).length > 0 ? pendiente : undefined);
  log(`config pendiente confirmada por el motor: ${campo}=${String(valor)}`);
}

const bridge = connectBridge((msg) => {
  if (msg.type === 'ready') {
    log('motor autenticado: el avatar ya manda y recibe');
    // Reenvio de lo cambiado sin conexion. NO se limpia aqui: la limpieza
    // llega campo a campo cuando el motor confirma con su estado autoritativo
    // (mic/avatars/devices). El reenvio es idempotente, asi que si el motor
    // cayo antes de aplicarlo, el siguiente ready lo reintenta.
    if (Object.keys(pendiente).length > 0) {
      if (bridge.send({ type: 'config', settings: pendiente })) {
        log(`config pendiente → motor: ${JSON.stringify(pendiente)}`);
      }
    }
    for (const mensaje of pendientesPerfil.splice(0)) {
      if (bridge.send(mensaje)) {
        log(`perfil pendiente → motor: avatar=${mensaje.avatarId}`);
      }
    }
  } else if (msg.type === 'state') {
    avatar.setState(msg.state);
    log(`estado: ${msg.state}`);
  } else if (msg.type === 'mic') {
    // Estado REAL del microfono segun el motor: la cache de esta UI se alinea
    // sin reenviar nada (si no, podia mostrar silencio mientras se capturaba).
    avatar.setMicEnabled(msg.enabled);
    confirmarPendiente('micEnabled', msg.enabled);
    log(msg.enabled ? 'micrófono activo (motor)' : 'micrófono silenciado (motor)');
  } else if (msg.type === 'gesture') {
    // El gesto lo decide el motor; la UI solo lo ejecuta. Saludar es algo que
    // pasa una vez, no una fase del turno.
    if (msg.gesture === 'saludo') {
      avatar.greet();
      log('gesto: saludo');
    }
  } else if (msg.type === 'user') {
    avatar.showCaption(`tú: ${msg.text}`);
    log(`tú    › ${msg.text}`);
  } else if (msg.type === 'assistant') {
    avatar.showCaption(msg.text);
    log(`ALPHA › ${msg.text}`);
  } else if (msg.type === 'devices') {
    avatar.setMicDevices(msg.inputs, msg.current);
    if (msg.current !== undefined) confirmarPendiente('audioDevice', msg.current);
    log(`motor conectado · ${msg.inputs.length} micrófonos disponibles`);
  } else if (msg.type === 'avatars') {
    avatar.setAvatarOptions(msg.list, msg.current);
    if (msg.current !== undefined) confirmarPendiente('agent', msg.current);
    const nombres = msg.list
      .map((a) => `${a.name}${a.confidential ? ' (confidencial)' : ''}`)
      .join(', ');
    log(`avatares: ${nombres || '(ninguno)'} · activo: ${msg.current ?? '(ninguno)'}`);
  } else if (msg.type === 'voices') {
    avatar.setVoiceOptions(msg.list);
    const sapi = msg.list.filter((v) => v.engine === 'sapi').length;
    const edge = msg.list.filter((v) => v.engine === 'edge').length;
    log(`voces: ${sapi} locales (SAPI) + ${edge} nube (Edge)`);
  } else if (msg.type === 'models') {
    avatar.setModelOptions(msg.list);
    log(`modelos: ${msg.list.length} disponibles`);
  } else if (msg.type === 'config-error') {
    log(`configuracion rechazada: ${msg.message}`);
    avatar.showCaption(`No se aplico: ${msg.message}`);
  }
});
(globalThis as Record<string, unknown>)['__alphaBridge'] = bridge;

// Lo que se cambie en el menu del avatar viaja al motor: el avatar es el panel
// de control. Viaja SOLO el parche de lo cambiado, nunca la cache entera; sin
// motor, el parche se acumula para reenviarse al autenticar.
avatar.setOnSettingsChanged((patch) => {
  if (bridge.send({ type: 'config', settings: patch })) {
    log(`config → motor: ${JSON.stringify(patch)}`);
  } else {
    pendiente = { ...pendiente, ...patch };
    savePendiente(pendiente);
    log(`config pendiente (sin motor): ${JSON.stringify(patch)}`);
  }
});

avatar.setOnAvatarSettingsChanged((message) => {
  // Sin motor, el cambio de perfil se guarda para reenviarlo al autenticar; y
  // el log dice la verdad (antes anunciaba "enviado" sobre un send ignorado).
  if (bridge.send(message)) {
    log(`perfil → motor: avatar=${message.avatarId}, cambios=${JSON.stringify(message.settings)}`);
  } else {
    pendientesPerfil.push(message);
    log(
      `perfil pendiente (sin motor): avatar=${message.avatarId}, cambios=${JSON.stringify(message.settings)}`,
    );
  }
});

// Chat escrito: Enter en el campo del avatar manda el texto al motor.
avatar.setOnTextSubmit((text) => {
  // Solo se pinta como enviado si el motor lo ha aceptado de verdad (handshake
  // acusado); si no, el usuario veria su mensaje en pantalla y nadie lo leeria.
  if (bridge.sendText(text)) {
    avatar.showCaption(`tú: ${text}`);
    log(`texto → motor: ${text}`);
  } else {
    log('el motor no está conectado/autenticado; el mensaje escrito no se envió');
    avatar.showCaption('(sin motor: arranca "npm run spike:conversar")');
  }
});

log('A.L.P.H.A. avatar en marcha.');
console.log('  · Arrastra con el botón izquierdo para moverlo.');
console.log('  · Clic derecho: menú de configuración (avatar, modelo, sonido, privacidad).');
console.log('  · Doble clic: cambia de estado.');
console.log('  · Esperando al motor ("npm run spike:conversar")…');
