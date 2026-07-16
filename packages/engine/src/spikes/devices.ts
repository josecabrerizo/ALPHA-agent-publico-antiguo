import { listInputDevices } from '../audio/devices.js';

const devices = await listInputDevices();

if (devices.length === 0) {
  console.log('No se detecto ningun microfono.');
} else {
  console.log(`\nMicrofonos detectados (${devices.length}):\n`);
  devices.forEach((device, index) => {
    console.log(`  [${index}] ${device.name}${index === 0 ? '  <- por defecto' : ''}`);
  });
  console.log('\nPara elegir otro:  set ALPHA_AUDIO_DEVICE=<nombre exacto>\n');
}
