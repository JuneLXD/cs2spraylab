import {describe, expect, it} from 'vitest';
import {ViewPunch} from './view-punch';
import {STEP, UNIT} from './actor-physics';
import {defaults} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';
import fixture from './native-landing-camera-fixture.json';

describe('native landing camera pitch', () => {
  it('matches all 32 native stationary-ground threshold, scale and yaw-preservation cases', () => {
    for (const row of fixture.samples) {
      const punch = new ViewPunch(); punch.add({pitch: -row.previous[0], yaw: -row.previous[1]}, 0);
      const before = punch.sample(row.age); punch.land(row.speed, row.age);
      const result = punch.sample(row.age);
      if (row.result) {
        expect(result.pitch).toBeCloseTo(-row.result[0], 7);
        expect(result.yaw).toBeCloseTo(-row.result[1], 7);
      } else expect(result).toEqual(before);
    }
  });
  it('replaces prior shot pitch and permits another shot during landing recovery', () => {
    const punch = new ViewPunch(); punch.add({pitch: 1.1, yaw: -.5}, 0); punch.land(302, .01);
    expect(punch.sample(.01).pitch).toBe(-.75);
    punch.add({pitch: 1.1, yaw: -.5}, .02);
    expect(punch.sample(.02).pitch).toBeCloseTo(1.1 - .75 * Math.exp(-.18), 7);
    expect(punch.sample(.02).yaw).toBeCloseTo(-.5 * Math.exp(-.36) - .5, 7);
  });
  it.each(['guided', 'duel'] as const)('%s adds one dip on contact without changing aim, stance or the following ground step', mode => {
    const duel = mode === 'duel' ? new DuelSimulation(sanitizeDuelConfig({health: 500, playerHealth: 500}), 42, testArena()) : undefined;
    const range = mode === 'guided' ? new Simulation({...defaults, mode, weapon: 'ak47'}) : undefined;
    const sim = (duel ?? range)!, actor = duel ? duel.actors[0] : range!;
    if (duel) {duel.command(1, {}); duel.start();} else range!.active = true;
    actor.feet = .015; actor.position.y = actor.feet + 64 * UNIT;
    actor.verticalVelocity = -302 * UNIT; actor.grounded = false;
    const raw = {yaw: actor.yaw, pitch: actor.pitch};
    sim.advance(STEP);
    expect(actor.grounded).toBe(true); expect(actor.landedAt).toBeGreaterThan(0);
    const landed = actor.landedAt!;
    expect(actor.viewPunch.sample(landed).pitch).toBe(-.75);
    expect(actor.viewPunch.sample(sim.time).pitch).toBeCloseTo(-.75 * Math.exp(-18 * (sim.time - landed)), 7);
    expect({yaw: actor.yaw, pitch: actor.pitch}).toEqual(raw); expect(actor.duckAmount).toBe(0);
    sim.advance(.05);
    expect(actor.viewPunch.sample(sim.time).pitch).toBeCloseTo(-.75 * Math.exp(-18 * (sim.time - landed)), 7);
  });
  it('does not dip for a small step down below the native threshold', () => {
    const sim = new Simulation({...defaults, mode: 'guided'}); sim.active = true;
    sim.feet = .002; sim.position.y = sim.feet + 64 * UNIT; sim.grounded = false; sim.verticalVelocity = -100 * UNIT;
    sim.advance(STEP); expect(sim.grounded).toBe(true); expect(sim.viewPunch.sample(sim.time).pitch).toBe(0);
  });
});
