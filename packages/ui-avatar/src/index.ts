/**
 * Arranque de la UI del avatar de A.L.P.H.A.
 *
 * Ejecutar con qode (no con node): `npm run dev` en este paquete.
 * El motor headless se conectara mas adelante por WebSocket para mandar
 * cambios de estado; por ahora la ventana es autonoma.
 */
import { AvatarWindow } from './avatar-window.js';
import { connectBridge } from './bridge-client.js';
import { isGreeting } from './poses.js';
import { log } from './log.js';

const avatar = new AvatarWindow();
avatar.show();

// Mantener viva la referencia: sin esto el GC podria llevarse la ventana.
(globalThis as Record<string, unknown>)['__alphaAvatar'] = avatar;

// Conexion con el motor: refleja el estado de la conversacion en el orbe y
// muestra el ultimo texto. Si el motor no esta, reintenta hasta que aparezca.
const bridge = connectBridge((msg) => {
  if (msg.type === 'ready') {
    // No se reenvia la config: el motor lee el mismo alpha.settings.json al
    // arrancar y ademas puede tener overrides propios (ALPHA_CONFIDENCIAL). Lo
    // que manda es lo que el motor diga que tiene puesto.
    log('motor autenticado: el avatar ya manda y recibe');
  } else if (msg.type === 'state') {
    avatar.setState(msg.state);
    log(`estado: ${msg.state}`);
  } else if (msg.type === 'user') {
    avatar.showCaption(`tú: ${msg.text}`);
    log(`tú    › ${msg.text}`);
  } else if (msg.type === 'assistant') {
    avatar.showCaption(msg.text);
    log(`ALPHA › ${msg.text}`);
    // Si el asistente saluda (o devuelve el saludo), agita la mano. Se mira lo
    // que DICE, no en que estado esta: saludar es algo que pasa una vez, no una
    // fase del turno.
    if (isGreeting(msg.text)) {
      avatar.greet();
      log('gesto: saludo');
    }
  } else if (msg.type === 'devices') {
    avatar.setMicDevices(msg.inputs);
    log(`motor conectado · ${msg.inputs.length} micrófonos disponibles`);
  } else if (msg.type === 'avatars') {
    avatar.setAvatarOptions(msg.list, msg.current);
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
// de control. (Si el motor no esta conectado, lo leera del fichero al arrancar.)
avatar.setOnSettingsChanged((settings) => {
  bridge.send({ type: 'config', settings });
  log(`config → motor: agente=${settings.agent}, micro=${settings.audioDevice || '(sistema)'}`);
});

avatar.setOnAvatarSettingsChanged((message) => {
  bridge.send(message);
  log(`perfil → motor: avatar=${message.avatarId}, cambios=${JSON.stringify(message.settings)}`);
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
