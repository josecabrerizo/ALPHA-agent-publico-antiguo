import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FALLBACK_AGENTS, AGENT_ORDER, DEFAULT_AGENT } from './agents.js';
import { STATE_RHYTHMS, STATE_CYCLE, MAX_PULSE } from './states.js';

/**
 * Agentes y estados son dos EJES distintos: el agente da el color de identidad,
 * el estado el ritmo (y la amplitud) de la respiracion. La tabla de agentes es
 * solo el RESPALDO de antes de conectar (la fuente de verdad la manda el
 * motor), pero mientras cubre ese hueco no puede quedarse coja.
 */

test('cada agente del orden tiene su ficha, y al reves', () => {
  assert.deepEqual([...AGENT_ORDER].sort(), Object.keys(FALLBACK_AGENTS).sort());
});

test('la ficha de cada agente coincide con su clave', () => {
  for (const [id, agent] of Object.entries(FALLBACK_AGENTS)) {
    assert.equal(agent.id, id, `la ficha de "${id}" dice ser "${agent.id}"`);
    assert.ok(agent.label, `${id} necesita nombre para el menu`);
    assert.ok(agent.tagline, `${id} necesita una linea de rol`);
  }
});

test('los colores son RGB validos', () => {
  for (const [id, agent] of Object.entries(FALLBACK_AGENTS)) {
    assert.equal(agent.color.length, 3, `${id}: un color son tres componentes`);
    for (const c of agent.color) {
      assert.ok(
        Number.isInteger(c) && c >= 0 && c <= 255,
        `${id}: componente fuera de 0..255 (${c})`,
      );
    }
  }
});

test('el agente por defecto existe', () => {
  assert.ok(FALLBACK_AGENTS[DEFAULT_AGENT]);
});

test('el ciclo de estados recorre todos los estados, sin repetir', () => {
  assert.deepEqual([...STATE_CYCLE].sort(), Object.keys(STATE_RHYTHMS).sort());
  assert.equal(new Set(STATE_CYCLE).size, STATE_CYCLE.length);
});

test('cada estado tiene ritmo y amplitud con sentido', () => {
  for (const [state, rhythm] of Object.entries(STATE_RHYTHMS)) {
    assert.ok(rhythm.breatheMs > 0, `${state}: un periodo de respiracion no puede ser 0`);
    assert.ok(rhythm.pulse > 0, `${state}: sin amplitud, el estado no se distingue`);
  }
});

/**
 * MAX_PULSE fija el border-radius del orbe y el tamano maximo del halo. Si se
 * queda por debajo de alguna amplitud, el circulo se recorta como una capsula.
 */
test('MAX_PULSE es de verdad el pulso mas ancho', () => {
  const pulses = Object.values(STATE_RHYTHMS).map((r) => r.pulse);
  assert.equal(MAX_PULSE, Math.max(...pulses));
});
