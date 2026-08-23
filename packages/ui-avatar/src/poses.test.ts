import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  poseForState,
  transitionPath,
  breathAt,
  posesDirFor,
  poseFile,
  POSES,
  POSE_CENTRO,
} from './poses.js';
import { PoseAnimator, FADE_MS, GESTO_MS } from './animator.js';
import { STATE_CYCLE, STATE_RHYTHMS } from './states.js';

/**
 * La regla que sostiene todo esto: TODA transicion pasa por reposo. Fundir una
 * pose con brazos contra otra pose con brazos da un borron de cuatro manos;
 * pasando por el centro, cada fundido tiene un extremo con los brazos bajados.
 */

test('cada estado tiene pose, y escuchando comparte la de reposo', () => {
  for (const s of STATE_CYCLE) assert.ok(POSES.includes(poseForState(s)), `${s} sin pose`);
  assert.equal(poseForState('reposo'), 'reposo');
  assert.equal(poseForState('escuchando'), 'reposo', 'el halo ya distingue escuchar de reposar');
  assert.equal(poseForState('pensando'), 'pensando');
  assert.equal(poseForState('hablando'), 'hablando');
});

test('ningun estado pide el saludo: es un gesto, no un estado', () => {
  for (const s of STATE_CYCLE) assert.notEqual(poseForState(s), 'saludo');
});

test('de reposo a cualquier pose se va directo', () => {
  assert.deepEqual(transitionPath('reposo', 'hablando'), ['hablando']);
  assert.deepEqual(transitionPath('pensando', 'reposo'), ['reposo']);
});

test('entre dos poses con brazos se pasa por reposo', () => {
  assert.deepEqual(transitionPath('hablando', 'pensando'), ['reposo', 'pensando']);
  assert.deepEqual(transitionPath('saludo', 'hablando'), ['reposo', 'hablando']);
});

test('quedarse donde se esta no anima nada', () => {
  for (const p of POSES) assert.deepEqual(transitionPath(p, p), []);
});

test('ninguna ruta salta de una pose con brazos a otra', () => {
  for (const a of POSES) {
    for (const b of POSES) {
      const ruta = [a, ...transitionPath(a, b)];
      for (let i = 1; i < ruta.length; i++) {
        const salto = ruta[i - 1] !== POSE_CENTRO && ruta[i] !== POSE_CENTRO;
        assert.equal(salto, false, `${a}->${b} funde ${ruta[i - 1]} contra ${ruta[i]}`);
      }
    }
  }
});

test('la respiracion es una sinusoide acotada y con el periodo pedido', () => {
  const T = STATE_RHYTHMS.reposo.breatheMs;
  assert.ok(Math.abs(breathAt(0, T)) < 1e-9);
  assert.ok(Math.abs(breathAt(T / 4, T) - 1) < 1e-9, 'a un cuarto de periodo, el maximo');
  assert.ok(Math.abs(breathAt(T, T)) < 1e-9, 'al periodo completo, vuelve al inicio');
  for (let ms = 0; ms < 5000; ms += 37) {
    const v = breathAt(ms, T);
    assert.ok(v >= -1 && v <= 1, `fuera de rango en ${ms}: ${v}`);
  }
});

test('periodo cero no divide por cero', () => {
  assert.equal(breathAt(123, 0), 0);
});

test('las poses se buscan en la carpeta hermana del retrato', () => {
  const dir = posesDirFor(path.join('C:', 'repo', 'assets', 'avatars', 'unit-a.png'));
  assert.equal(dir, path.join('C:', 'repo', 'assets', 'avatars', 'unit-a'));
  assert.equal(poseFile(dir, 'saludo'), path.join(dir, 'saludo.png'));
});

// La deteccion de saludos (y sus tests) vive ahora en el motor
// (conversation/greeting.ts): el gesto llega como mensaje `gesture`.

/* ── El animador ─────────────────────────────────────────────────────────── */

test('ir a una pose funde y acaba puesto en ella', () => {
  const a = new PoseAnimator();
  a.goTo('hablando', 0);

  const medio = a.frameAt(FADE_MS / 2);
  assert.equal(medio.from, 'reposo');
  assert.equal(medio.to, 'hablando');
  assert.ok(medio.mix > 0 && medio.mix < 1, `mezcla a medias, no ${medio.mix}`);
  assert.equal(medio.moving, true);

  const fin = a.frameAt(FADE_MS + 1);
  assert.equal(fin.to, 'hablando');
  assert.equal(fin.mix, 1);
  assert.equal(fin.moving, false, 'terminado el fundido, ya no hay que recomponer');
});

test('entre dos poses con brazos, el fundido pasa por reposo', () => {
  const a = new PoseAnimator();
  a.goTo('hablando', 0);
  a.frameAt(FADE_MS + 1); // ya esta en hablando

  a.goTo('pensando', 1000);
  const primero = a.frameAt(1000 + FADE_MS / 2);
  assert.equal(primero.from, 'hablando');
  assert.equal(primero.to, 'reposo', 'el primer tramo tiene que ir al centro');

  const segundo = a.frameAt(1000 + FADE_MS + FADE_MS / 2);
  assert.equal(segundo.from, 'reposo');
  assert.equal(segundo.to, 'pensando');

  const fin = a.frameAt(1000 + 2 * FADE_MS + 1);
  assert.equal(fin.to, 'pensando');
  assert.equal(fin.moving, false);
});

test('el gesto de saludo se sostiene y vuelve solo a reposo', () => {
  const a = new PoseAnimator();
  a.gesture('saludo', 0);

  assert.equal(a.frameAt(FADE_MS + 1).to, 'saludo', 'primero llega');

  const sosteniendo = a.frameAt(FADE_MS + GESTO_MS / 2);
  assert.equal(sosteniendo.to, 'saludo');
  assert.equal(sosteniendo.moving, false, 'sosteniendo no se recompone nada');

  const volviendo = a.frameAt(FADE_MS + GESTO_MS + FADE_MS / 2);
  assert.equal(volviendo.from, 'saludo');
  assert.equal(volviendo.to, 'reposo', 'vuelve solo, sin que nadie se lo pida');

  const fin = a.frameAt(FADE_MS + GESTO_MS + FADE_MS + 1);
  assert.equal(fin.to, 'reposo');
  assert.equal(fin.moving, false);
});

test('un cambio de estado a mitad de camino no deja la pose colgada', () => {
  const a = new PoseAnimator();
  a.goTo('pensando', 0);
  // A mitad del fundido cambia de idea.
  a.goTo('hablando', FADE_MS / 2);
  const fin = a.frameAt(10_000);
  assert.equal(fin.to, 'hablando');
  assert.equal(fin.moving, false, 'la cola tiene que vaciarse, no quedarse girando');
});

test('la mezcla nunca se sale de 0..1 ni retrocede dentro de un tramo', () => {
  const a = new PoseAnimator();
  a.goTo('hablando', 0);
  let previo = -1;
  for (let ms = 0; ms <= FADE_MS; ms += 5) {
    const f = a.frameAt(ms);
    assert.ok(f.mix >= 0 && f.mix <= 1, `mezcla fuera de rango: ${f.mix}`);
    assert.ok(f.mix >= previo, 'el fundido no puede ir hacia atras');
    previo = f.mix;
  }
});

test('pedir la pose en la que ya se esta no reabre un fundido', () => {
  const a = new PoseAnimator();
  a.goTo('hablando', 0);
  a.frameAt(FADE_MS + 1);
  a.goTo('hablando', 2000);
  assert.equal(a.frameAt(2000).moving, false);
});
