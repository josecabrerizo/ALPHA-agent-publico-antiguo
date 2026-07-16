import { listInputDevices } from '../audio/devices.js';

const devices = await listInputDevices();

if (devices.length === 0) {
  console.log('\n  No hay ningun microfono conectado.\n');
  console.log('  En Windows los dispositivos desenchufados no se listan:');
  console.log('  si esperabas ver un casco, comprueba que esta puesto.\n');
} else {
  console.log(`\n  Microfonos conectados (${devices.length}):\n`);
  for (const device of devices) {
    const mark = device.isDefault ? '  ← predeterminado del sistema' : '';
    console.log(`  · ${device.name}${mark}`);
  }

  if (!devices.some((device) => device.isDefault)) {
    console.log('\n  No se pudo determinar el predeterminado; se usara el primero.');
  }
  console.log('\n  Para forzar otro:  set ALPHA_AUDIO_DEVICE=<nombre exacto>\n');
}
