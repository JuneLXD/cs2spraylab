import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, UNIT, type ActorKinematics} from './actor-physics';
import {groundFrictionStep, groundStopGate, prepareGroundMotion} from './ground-friction';
import native from './native-ground-friction-stop-fixture.json';

describe('native ground stopping after friction and deferred velocity', () => {
  it.each(native.controls)('uses the native strict projected-speed branch: $id', c => {
    expect(groundStopGate(c.velocity, c.acceleration, c.dt)).toBe(c.stopped);
  });
  it.each(native.smallControls)('finishes tiny velocity even when friction skips: $id', c => {
    const friction = groundFrictionStep(c.velocity, c.control, c.dt);
    expect(friction.velocity).toEqual(c.afterFriction);
    const prepared = prepareGroundMotion(friction.velocity, friction.acceleration, c.dt);
    expect(prepared.stopped).toBe(true);
    expect(prepared.movement).toEqual(c.afterPost);
    expect(prepared.deferred).toEqual({x: 0, z: 0});
  });
  it.each(native.releases)('carries the actor through exact stopping: $id', c => {
    let actor: ActorKinematics = {position: {x: 0, y: 64 * UNIT, z: 0},
      velocity: {x: c.velocity.x * UNIT, z: c.velocity.z * UNIT}, yaw: 0,
      feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true,
      movementTime: c.startTime, friction: {command: 0, state: c.state}};
    let firstNative: number | undefined, firstTrainer: number | undefined;
    for (const s of c.samples) {
      actor = advanceActor(actor, idleInput(), c.speed * UNIT, s.at - actor.movementTime!);
      expect(Math.hypot(actor.velocity.x / UNIT - s.velocity.x, actor.velocity.z / UNIT - s.velocity.z)).toBeLessThan(.0002);
      expect(Math.hypot(actor.position.x / UNIT - s.derivedPosition.x, actor.position.z / UNIT - s.derivedPosition.z)).toBeLessThan(.00003);
      if (firstNative === undefined && s.velocity.x === 0 && s.velocity.z === 0) firstNative = s.at;
      if (firstTrainer === undefined && actor.velocity.x === 0 && actor.velocity.z === 0) firstTrainer = s.at;
      // JSON serializes both signs of zero identically; native comparisons do too.
      expect(JSON.stringify(actor.friction!.state)).toBe(JSON.stringify(s.state));
    }
    expect(firstNative).toBeDefined(); expect(firstTrainer).toBe(firstNative);
    expect(actor.velocity).toEqual({x: 0, z: 0});
  });
});
