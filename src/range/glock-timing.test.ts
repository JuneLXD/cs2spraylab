import {describe, expect, it} from 'vitest';
import {defaults} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';

function bench(engine: 'range' | 'duel') {
  const range = engine === 'range' ? new Simulation({...defaults, weapon: 'glock', mode: 'guided', spread: false, burst: 0}, () => .5) : undefined;
  const duel = range ? undefined : new DuelSimulation(sanitizeDuelConfig({botCount: 1, roundSeconds: 60}), 1, testArena(), 'glock');
  const sim = range ?? duel!, state = range?.reloadState ?? duel!.actors[0].weapon.reload;
  const actions = range?.actions ?? duel!.actors[0].weapon.actions;
  if (range) range.active = true;
  else {duel!.start(); duel!.actors[0].yaw = Math.PI; duel!.command(1, {fireHeld: false});}
  return {sim, state, actions,
    at(time: number) {
      while (sim.time < time - 1e-10) {
        const dt = Math.min(1 / 128, time - sim.time);
        if (range) range.step(dt); else duel!.step(dt, true);
      }
    },
    fire(down: boolean) {
      if (range) {if (down) range.pressTrigger(); else range.release('mouse');}
      else {duel!.command(0, {fireHeld: down, firePressed: down}); duel!.processInput();}
    },
    secondary(down: boolean) {
      if (range) {range.secondaryHeld = down; if (down) range.secondary();}
      else {duel!.command(0, {secondaryHeld: down, secondaryPressed: down}); duel!.processInput();}
    },
  };
}

for (const engine of ['range', 'duel'] as const) describe(`${engine}: native Glock attack clocks`, () => {
  it('allows a tap immediately after either mode switch', () => {
    for (const initialBurst of [false, true]) {
      const b = bench(engine); b.at(1); b.actions.burst = initialBurst;
      b.secondary(true); b.secondary(false);
      expect(b.actions.burst).toBe(!initialBurst);
      expect(b.actions.readyAt).toBe(0);
      b.fire(true); b.fire(false);
      expect(b.state.ammo).toBe(19);
      b.at(1.125);
      expect(b.state.ammo).toBe(initialBurst ? 19 : 17);
    }
  });
  it('retains a future secondary deadline when immediate burst shots advance both clocks', () => {
    const b = bench(engine); b.at(1.003);
    b.secondary(true); b.secondary(false); b.fire(true); b.fire(false);
    expect(b.actions.secondaryReadyAt).toBeCloseTo(1.353, 9);
    b.at(1.125);
    expect(b.state.ammo).toBe(17);
    expect(b.actions.secondaryReadyAt).toBeCloseTo(1.803, 9);
    b.at(1.6); b.secondary(true); b.secondary(false);
    expect(b.actions.burst).toBe(true);
    b.at(1.803); b.secondary(true); b.secondary(false);
    expect(b.actions.burst).toBe(false);
  });
  it('drops a secondary tap during pending rounds without delaying the burst', () => {
    const b = bench(engine); b.at(1); b.actions.burst = true;
    b.fire(true); b.fire(false); b.at(1.03125);
    b.secondary(true); b.secondary(false);
    expect(b.actions.burst).toBe(true);
    b.at(1.125);
    expect(b.state.ammo).toBe(17);
    expect(b.actions.secondaryReadyAt).toBeCloseTo(1.5, 9);
    b.at(1.6); expect(b.actions.burst).toBe(true);
  });
  it('retries held secondary after the complete burst cycle', () => {
    const b = bench(engine); b.at(1); b.actions.burst = true;
    b.fire(true); b.fire(false); b.at(1.03125); b.secondary(true);
    b.at(1.125); expect(b.state.ammo).toBe(17);
    b.at(1.499); expect(b.actions.burst).toBe(true);
    b.at(1.5); expect(b.actions.burst).toBe(false);
    b.at(1.799); expect(b.actions.burst).toBe(false);
    b.at(1.8); expect(b.actions.burst).toBe(true);
    b.secondary(false);
  });
  it('preserves semiautomatic cadence and rejects an early released toggle tap', () => {
    const b = bench(engine); b.at(1); b.fire(true); b.fire(false);
    b.at(1.03125); b.secondary(true); b.secondary(false);
    b.at(1.149); expect(b.actions.burst).toBe(false);
    b.fire(true); b.fire(false); // released primary before readiness is also dropped
    b.at(1.15); expect(b.state.ammo).toBe(19);
    b.fire(true); b.fire(false); expect(b.state.ammo).toBe(18);
    expect(b.actions.secondaryReadyAt).toBeCloseTo(1.3, 9);
  });
  it('gives held primary priority over held secondary after semiautomatic readiness', () => {
    const b = bench(engine); b.at(1); b.fire(true); b.secondary(true);
    b.at(1.5); expect(b.actions.burst).toBe(false); expect(b.state.ammo).toBe(19);
    b.fire(false);
    expect(b.actions.burst).toBe(true); expect(b.state.ammo).toBe(19);
    b.secondary(false);
  });
});

it('Duel processes a due primary command before a simultaneous Glock mode switch', () => {
  const sim = new DuelSimulation(sanitizeDuelConfig({botCount: 1}), 1, testArena(), 'glock');
  sim.start(); sim.actors[0].yaw = Math.PI;
  sim.command(0, {fireHeld: true, firePressed: true, secondaryHeld: true, secondaryPressed: true});
  sim.processInput();
  expect(sim.actors[0].weapon.ammo).toBe(19);
  expect(sim.actors[0].weapon.actions.burst).toBe(false);
  expect(sim.actors[0].weapon.actions.secondaryReadyAt).toBeCloseTo(.15, 9);
});
