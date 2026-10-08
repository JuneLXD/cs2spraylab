import {describe, expect, it} from 'vitest';
import {ViewPunch, viewPunchImpulse} from './view-punch';
import {WeaponRecovery} from './ballistics';
import {defaults, gameData} from './config';
import {Simulation} from './simulation';
import {DuelSimulation} from './duel/simulation';
import {DuelWeaponState} from './duel/weapon-state';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';
import fixture from './native-view-punch-fixture.json';
import anchors from './native-view-punch-anchor-fixture.json';

const vector = ([pitch, yaw]: number[]) => ({pitch: -pitch, yaw: -yaw});

describe('native camera-only shot kick', () => {
  it('matches 36 native impulse evaluations, including pre-existing camera kick', () => {
    for (const row of fixture.shots) {
      const kick = new ViewPunch(); kick.add(vector(row.previous), 0);
      kick.add(viewPunchImpulse(row.angle, row.magnitude), 0);
      const actual = kick.sample(0);
      expect(actual.pitch).toBeCloseTo(-row.result[0], 7);
      expect(actual.yaw).toBeCloseTo(-row.result[1], 7);
    }
  });
  it('matches 33 native decay samples without the aim-punch cutoff', () => {
    for (const row of fixture.samples) {
      const kick = new ViewPunch(); kick.add(vector(row.angle), 0);
      const actual = kick.sample(row.elapsed);
      expect(actual.pitch).toBeCloseTo(-row.result[0], 7);
      expect(actual.yaw).toBeCloseTo(-row.result[1], 7);
    }
  });
  it('reproduces the camera anchors in the native 14-shot AK tap/spray recording', () => {
    const recovery = new WeaponRecovery(gameData.weapons.ak47), kick = new ViewPunch();
    let previous = 0;
    for (const [i, row] of anchors.samples.entries()) {
      recovery.advance(row.elapsed - previous); previous = row.elapsed; recovery.fire();
      kick.add(recovery.lastViewPunch, row.elapsed);
      const actual = kick.sample(row.elapsed);
      // Network angles plus the native absolute float clock lose precision;
      // the separate arithmetic fixture above is checked to 1e-7 degrees.
      expect(Math.abs(actual.pitch + row.angle[0]), `shot ${i} pitch`).toBeLessThan(.001);
      expect(Math.abs(actual.yaw + row.angle[1]), `shot ${i} yaw`).toBeLessThan(.001);
    }
  });
  it('samples without mutating state or accumulating frame-dependent rounding', () => {
    const kick = new ViewPunch(); kick.add({pitch: 1.2, yaw: -.4}, 2);
    const before = JSON.stringify(kick), expected = kick.sample(2.143);
    for (let i = 0; i < 1000; i++) kick.sample(2 + i / 8000);
    kick.sample(20); expect(kick.sample(2.143)).toEqual(expected); expect(JSON.stringify(kick)).toBe(before);
    expect(kick.sample(2.3).pitch).toBeGreaterThan(0);
  });
  it('starts immediately in the range, survives a holster, and resets with the session', () => {
    const sim = new Simulation({...defaults, mode: 'guided', weapon: 'ak47'}); sim.active = true;
    const shots: {direction: {x: number; y: number; z: number}}[] = []; sim.onShot = shot => shots.push(shot);
    sim.start(true); sim.finish();
    expect(sim.viewPunch.sample(sim.time).pitch).toBeGreaterThan(1);
    const kick = sim.viewPunch.sample(sim.time), originalShot = structuredClone(shots[0]);
    sim.equip(3); expect(sim.viewPunch.sample(sim.time)).toEqual(kick);
    sim.advance(.05); expect(sim.viewPunch.sample(sim.time + sim.accumulator).pitch).toBeCloseTo(kick.pitch * Math.exp(-.9), 6);
    expect(shots[0]).toEqual(originalShot); sim.reset(); expect(sim.viewPunch.sample(sim.time).pitch).toBe(0);
  });
  it('uses player-owned kick in the duel without changing the shot ray or raw aim', () => {
    const sim = new DuelSimulation(sanitizeDuelConfig({health: 500, playerHealth: 500}), 42, testArena());
    const actor = sim.actors[0]; actor.weapon = new DuelWeaponState('ak47', () => 0, {spread: false});
    sim.command(1, {}); sim.start(); sim.command(0, {firePressed: true}); sim.processInput();
    const shot = sim.drainEvents().find(e => e.kind === 'fire');
    expect(shot).toMatchObject({direction: {x: -0, y: 0, z: -1}});
    expect(actor.viewPunch.sample(sim.time).pitch).toBeGreaterThan(1);
    expect(actor.yaw).toBe(0); expect(actor.pitch).toBe(0);
    const before = actor.viewPunch.sample(sim.time); sim.equipPlayer(3);
    expect(actor.viewPunch.sample(sim.time)).toEqual(before);
  });
});
