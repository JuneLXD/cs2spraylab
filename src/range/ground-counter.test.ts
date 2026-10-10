import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, UNIT, type ActorKinematics} from './actor-physics';
import {groundFrictionStep, accelerateGroundMotion, capGroundMotion, prepareGroundMotion} from './ground-friction';
import fixture from './native-ground-combined-fixture.json';

describe('native counter-strafe and cached-friction restart', () => {
  it('matches native work, overshoot and cap controls, including restarting from zero with an active cache', () => {
    expect(fixture.zeroCacheRestart).toBeGreaterThan(0);
    for (const sample of fixture.primitives) {
      const friction = groundFrictionStep(sample.velocity, sample.control, sample.dt);
      expect(friction.overshoot, sample.id).toBe(sample.overshoot);
      const accelerated = accelerateGroundMotion(friction.velocity, friction.acceleration, sample.wish,
        sample.speed, sample.dt, friction.overshoot, {weaponSpeed: sample.speed, ducking: false, walking: false});
      const capped = capGroundMotion(accelerated.velocity, accelerated.acceleration, sample.speed, sample.dt);
      for (const [actual, native] of [[accelerated, sample.accelerated], [capped, sample.capped]] as const) {
        for (const axis of ['x', 'z'] as const) {
          expect(actual.velocity[axis] === native.velocity[axis], `${sample.id} velocity ${axis}`).toBe(true);
          expect(actual.acceleration[axis] === native.work[axis], `${sample.id} work ${axis}`).toBe(true);
        }
      }
      const prepared = prepareGroundMotion(capped.velocity, capped.acceleration, sample.dt);
      expect(prepared.stopped, sample.id).toBe(sample.stopped);
      for (const axis of ['x', 'z'] as const)
        expect(Math.fround(prepared.movement[axis] + prepared.deferred[axis]) === sample.endpoint[axis], sample.id).toBe(true);
    }
  });

  it.each(fixture.trajectories)('carries actual actor state through $id', sample => {
    let actor: ActorKinematics = {position: {x: 0, y: 64 * UNIT, z: 0},
      velocity: {x: sample.velocity.x * UNIT, z: sample.velocity.z * UNIT},
      yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, grounded: true, jumpHeld: false,
      movementTime: sample.startTime, friction: {command: 0, state: sample.state}};
    for (const row of sample.samples) {
      const frozen = JSON.stringify(actor);
      const next = advanceActor(actor, {...idleInput(), ...row.input}, sample.speed * UNIT, row.at - actor.movementTime!);
      expect(JSON.stringify(actor)).toBe(frozen); actor = next;
      for (const axis of ['x', 'z'] as const) {
        expect(actor.velocity[axis] / UNIT).toBeCloseTo(row.velocity[axis], 9);
        expect(actor.position[axis] / UNIT).toBeCloseTo(row.derivedPosition[axis], 9);
      }
      expect(JSON.stringify(actor.friction?.state)).toBe(JSON.stringify(row.state));
    }
  });
});
