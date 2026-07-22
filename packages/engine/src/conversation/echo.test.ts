import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeEcho, normalize, decideBargeIn, mergeUserTurns } from './echo.js';

const SPOKEN = 'Claro, te ayudo con eso. La reunión de hoy tiene tres puntos pendientes.';

test('normaliza acentos, mayusculas y puntuacion', () => {
  assert.equal(normalize('¿Qué TAL, señor?'), 'que tal senor');
});

test('lo oido igual a lo dicho es eco', () => {
  assert.equal(looksLikeEcho('la reunión de hoy tiene tres puntos', SPOKEN), true);
});

test('una transcripcion parcial de lo dicho tambien es eco', () => {
  // El microfono recoge un trozo suelto de la frase que esta diciendo.
  assert.equal(looksLikeEcho('tres puntos pendientes', SPOKEN), true);
});

test('el eco se detecta pese a acentos y puntuacion distintos', () => {
  assert.equal(looksLikeEcho('LA REUNION DE HOY!!', SPOKEN), true);
});

test('una frase distinta del usuario NO es eco', () => {
  assert.equal(looksLikeEcho('y dime también qué hora es', SPOKEN), false);
});

test('una interrupcion corta del usuario NO es eco', () => {
  assert.equal(looksLikeEcho('espera, cambia el modelo', SPOKEN), false);
});

test('una sola palabra no basta para declarar eco', () => {
  // "puntos" aparece en lo dicho, pero sin contexto no se descarta al usuario.
  assert.equal(looksLikeEcho('puntos', SPOKEN), false);
});

test('sin nada dicho todavia, nada es eco', () => {
  assert.equal(looksLikeEcho('hola qué tal', ''), false);
});

// --- Veredicto de interrupcion -------------------------------------------

test('una transcripcion vacia es ruido y NO interrumpe', () => {
  // Es el caso que motivo todo esto: el VAD salta con ruido constante, pero si
  // whisper no saca palabras, no hay interrupcion.
  assert.equal(decideBargeIn('', SPOKEN), 'ruido');
  assert.equal(decideBargeIn('   ', SPOKEN), 'ruido');
});

test('oirse a si mismo es eco y NO interrumpe', () => {
  assert.equal(decideBargeIn('la reunión de hoy tiene tres puntos', SPOKEN), 'eco');
});

test('una frase nueva del usuario SI interrumpe', () => {
  assert.equal(decideBargeIn('y dime también qué hora es', SPOKEN), 'interrumpir');
});

// --- Fusion de lo interrumpido -------------------------------------------

test('la interrupcion se une a lo anterior para responder a todo', () => {
  assert.equal(
    mergeUserTurns('¿Qué reuniones tengo hoy?', 'y dime también qué hora es'),
    '¿Qué reuniones tengo hoy? y dime también qué hora es',
  );
});

test('la fusion tolera espacios sobrantes', () => {
  assert.equal(mergeUserTurns('  hola  ', '  qué tal  '), 'hola qué tal');
});

test('sin frase anterior, la fusion es la nueva a secas', () => {
  assert.equal(mergeUserTurns('', 'dime la hora'), 'dime la hora');
});
