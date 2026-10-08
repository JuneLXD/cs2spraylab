import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, UNIT, type ActorKinematics} from './actor-physics';
import native from './native-duck-fixture.json';

function actor(phase: typeof native.phases[number]): ActorKinematics {
  const first = phase.samples[0], curve = first.amount * first.amount * (3 - 2 * first.amount);
  return {position: {x: 0, y: (64 - 18 * curve) * UNIT, z: 0}, velocity: {x: 0, z: 0}, yaw: 0,
    feet: 0, verticalVelocity: 0, eyeHeight: (64 - 18 * curve) * UNIT, jumpHeld: false, grounded: true,
    duckAmount: first.amount, duckSpeed: first.speed, crouchHeld: phase.held, duckCooldown: 0};
}

describe('recorded native crouch and stand transitions', () => {
  it.each(native.phases)('$name matches native 64 Hz transition arithmetic from its first sampled state', phase => {
    let current = actor(phase);
    for (const sample of phase.samples.slice(1)) {
      current = advanceActor(current, {...idleInput(), crouch: phase.held}, 215 * UNIT, 1 / 64);
      expect(Math.abs(current.duckAmount! - sample.amount)).toBeLessThan(.000001);
      expect(Math.abs(current.duckSpeed! - sample.speed)).toBeLessThan(.000001);
    }
  });
  it.each(native.phases)('$name at the trainer’s 128 Hz stays within 0.003 of the recorded duck amount', phase => {
    let current = actor(phase);
    for (const sample of phase.samples.slice(1)) {
      for (let tick = 0; tick < 2; tick++) current = advanceActor(current, {...idleInput(), crouch: phase.held}, 215 * UNIT, 1 / 128);
      expect(Math.abs(current.duckAmount! - sample.amount)).toBeLessThan(.003);
      expect(Math.abs(current.duckSpeed! - sample.speed)).toBeLessThan(.000001);
    }
  });
});
