import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGreeting } from './greeting.js';

/**
 * El gesto de saludo lo decide el MOTOR y viaja como mensaje `gesture`; estos
 * casos vivian en la UI cuando era ella quien infería el saludo del texto.
 */

test('detecta saludos al principio, con y sin acentos ni signos', () => {
  for (const t of [
    'Hola, ¿en qué te ayudo?',
    'hola',
    '¡Buenas tardes!',
    'Buenos días.',
    'BUENAS',
    'Qué tal, dime',
    'Encantado de saludarte',
  ]) {
    assert.equal(isGreeting(t), true, `deberia saludar: "${t}"`);
  }
});

test('no confunde una mencion con un saludo', () => {
  for (const t of [
    'te dije hola hace un rato',
    'la palabra hola viene del latin',
    'holanda es un pais',
    // El falso positivo caro: "buenas" abre frases que no son saludos. Agitar
    // la mano sin venir a cuento se nota mas que no saludar.
    'buenas noticias sobre el informe',
    'buenas practicas de programacion',
    'que tal si probamos otra cosa',
    'como estas cosas no funcionan, mejor lo dejamos',
    '',
    '   ',
  ]) {
    assert.equal(isGreeting(t), false, `NO deberia saludar: "${t}"`);
  }
});

test('"buenas" a secas si es un saludo', () => {
  for (const t of ['buenas', '¡Buenas!', 'Buenas.', 'qué tal', 'Hey!']) {
    assert.equal(isGreeting(t), true, `deberia saludar: "${t}"`);
  }
});
