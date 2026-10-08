import {describe, expect, it} from 'vitest';
import {PunchRecovery} from './punch-recovery';
import {WeaponRecovery} from './ballistics';
import {gameData} from './config';
import fixture from './native-recovery-fixture.json';
import anchors from './native-recoil-anchor-fixture.json';

const vector = ([pitch, yaw, roll]: number[]) => ({pitch, yaw, roll});

describe('native recoil recovery sampling', () => {
  it('matches 72 independently emulated samples, including fractional times, cutoff, clamp and the cache tail', () => {
    for (const sample of fixture.samples) {
      const actual = new PunchRecovery(vector(sample.angle), vector(sample.velocity)).sample(sample.elapsed);
      const tolerance = Math.max(...sample.angle.map(Math.abs)) > 80 ? .00012 : .00001;
      for (const [i, key] of (['pitch', 'yaw', 'roll'] as const).entries()) {
        expect(Math.abs(actual[key] * 2 - sample.result[i]), `${sample.elapsed}: ${key}`).toBeLessThan(tolerance);
      }
    }
  });

  it('matches the carried angles and velocities of all 14 shots in the native AK tap/spray recording', () => {
    const recovery = new WeaponRecovery(gameData.weapons.ak47);
    for (const [index, sample] of anchors.samples.entries()) {
      recovery.advance(sample.elapsed); recovery.fire();
      for (const [i, key] of (['pitch', 'yaw'] as const).entries()) {
        expect(Math.abs(recovery.angle[key] + sample.angle[i]), `shot ${index}: ${key}`).toBeLessThan(.00001);
        expect(Math.abs(recovery.velocity[key] + sample.velocity[i]), `shot ${index} velocity: ${key}`).toBeLessThan(.00003);
      }
    }
  });

  it('reproduces each recorded native carry independently, with the half-tick angle offset', () => {
    for (let i = 1; i < anchors.samples.length; i++) {
      const previous = anchors.samples[i - 1], sample = anchors.samples[i];
      const actual = new PunchRecovery(vector(previous.angle), vector(previous.velocity)).sample(sample.elapsed + 1 / 128);
      for (const [axis, key] of (['pitch', 'yaw', 'roll'] as const).entries()) {
        expect(Math.abs(actual[key] - sample.angle[axis])).toBeLessThan(.000002);
      }
    }
  });

  it.each([64, 128, 240, 500, 1000, 8000])('keeps shot and recovery angles independent of %i Hz updates', hz => {
    const reference = new WeaponRecovery(gameData.weapons.ak47), sliced = new WeaponRecovery(gameData.weapons.ak47);
    for (const elapsed of [.003, .1, .1, .1, .041, .391, .1, .1, .019, 1.4]) {
      reference.advance(elapsed);
      for (let remaining = elapsed; remaining > 1e-12;) {
        const step = Math.min(remaining, 1 / hz); sliced.advance(step); remaining -= step;
      }
      expect(sliced.recoil.pitch).toBeCloseTo(reference.recoil.pitch, 6);
      expect(sliced.recoil.yaw).toBeCloseTo(reference.recoil.yaw, 6);
      reference.fire(); sliced.fire();
      expect(sliced.angle.pitch).toBeCloseTo(reference.angle.pitch, 6);
      expect(sliced.velocity.pitch).toBeCloseTo(reference.velocity.pitch, 6);
    }
  });

  it('keeps prediction queries from extending or rebasing the live cache', () => {
    const recovery = new WeaponRecovery(gameData.weapons.ak47); recovery.fire(); recovery.advance(.047);
    const before = JSON.stringify(recovery), predicted = recovery.predict(.2, true);
    expect(JSON.stringify(recovery)).toBe(before);
    recovery.fire(); recovery.advance(.2); expect(recovery.recoil).toEqual(predicted);
  });

  it('allows out-of-order render samples without changing later samples', () => {
    const angle = {pitch: 3, yaw: -2, roll: 0}, impulse = {pitch: 32, yaw: 8, roll: 0};
    const recovery = new PunchRecovery(angle, impulse), expected = recovery.sample(.203);
    recovery.sample(3); recovery.sample(.004); expect(recovery.sample(.203)).toEqual(expected);
  });
});
