import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, resetActorMovementHistory, STEP, UNIT, type ActorKinematics} from './actor-physics';
import {groundFrictionVelocity, selectGroundFriction, finishGroundFrictionSegment, quantizedGroundSpeed} from './ground-friction';
import {defaults} from './config';
import {Simulation} from './simulation';
import native from './native-ground-friction-fixture.json';

const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0}, velocity: {x: 0, z: 0},
  yaw: 0, feet: 0, verticalVelocity: 0, eyeHeight: 64 * UNIT, jumpHeld: false, grounded: true});

describe('native ground-friction cache and command boundaries', () => {
  it('matches native quantization, including exact zero and common weapon speeds', () => {
    for (const c of native.quantizer) expect(quantizedGroundSpeed(c.input)).toBe(c.native);
  });
  it('matches the native cache, marker and completed wish across all focused state cases', () => {
    for (const c of native.primitive) {
      const frozen = JSON.stringify(c.state);
      const actual = selectGroundFriction(c.state, c.velocity, c.wish, c.fraction);
      expect(JSON.stringify(c.state), c.id).toBe(frozen);
      expect(actual.state, c.id).toEqual(c.selected); expect(actual.controlSpeed, c.id).toBe(c.control);
      expect(groundFrictionVelocity(c.velocity, actual.controlSpeed, c.dt), c.id).toEqual(c.velocityAfterFriction);
      expect(finishGroundFrictionSegment(actual.state, c.wish), c.id).toEqual(c.completed);
    }
  });
  it.each(native.releases)('carries actual actor state through $id without supplying inserted fractions', c => {
    let actor: ActorKinematics = {...standing(), movementTime: c.startTime,
      velocity: {x: c.velocity.x * UNIT, z: c.velocity.z * UNIT}, friction: {command: 0, state: c.state}};
    for (const s of c.samples) {
      const prior = JSON.stringify(actor);
      const next = advanceActor(actor, idleInput(), c.speed * UNIT, s.at - actor.movementTime!);
      expect(JSON.stringify(actor)).toBe(prior);
      actor = next;
      expect(Math.hypot(actor.velocity.x / UNIT - s.velocity.x, actor.velocity.z / UNIT - s.velocity.z)).toBeLessThan(.0002);
      expect(Math.hypot(actor.position.x / UNIT - s.derivedPosition.x, actor.position.z / UNIT - s.derivedPosition.z)).toBeLessThan(.00003);
      // Native floating-point equality treats signed zero as equal. JSON
      // fixtures cannot retain -0, which the yaw transform can produce.
      const actual = actor.friction!.state;
      expect({...actual, previousWish: undefined}).toEqual({...s.state, previousWish: undefined});
      expect(actual.previousWish.x === s.state.previousWish.x).toBe(true);
      expect(actual.previousWish.z === s.state.previousWish.z).toBe(true);
    }
  });
  it('does not consume cache history during zero-time action processing or render prediction', () => {
    const sim = new Simulation({...defaults, weapon: 'm4a4', mode: 'spray'});
    sim.active = true; sim.input.side = 1; sim.step(STEP / 2); sim.input.side = 0; sim.step(STEP / 2);
    const before = JSON.stringify(sim.friction), velocity = {...sim.velocity};
    sim.step(0); expect(JSON.stringify(sim.friction)).toBe(before);
    sim.accumulator = STEP / 2;
    const a = sim.renderPosition(), b = sim.renderPosition();
    expect(a).toEqual(b); expect(JSON.stringify(sim.friction)).toBe(before); expect(sim.velocity).toEqual(velocity);
  });
  it('preserves movement history through equipment changes and clears it on cancellation and respawn', () => {
    const sim = new Simulation({...defaults, weapon: 'm4a4', mode: 'spray'});
    sim.input.side = 1; sim.step(STEP); const before = sim.friction;
    expect(before).toBeDefined(); sim.equip(2); expect(sim.friction).toBe(before);
    sim.cancel(); expect(sim.friction).toBeUndefined();
    const actor = advanceActor(standing(), {...idleInput(), side: 1}, 225 * UNIT, STEP);
    const reset = resetActorMovementHistory(actor);
    expect(reset.friction).toBeUndefined(); expect(reset.position).toEqual(actor.position);
  });
  it('does not duplicate an explicit jump edge when a cached fraction splits movement', () => {
    const actor: ActorKinematics = {...standing(), movementTime: 0,
      friction: {command: 0, state: {active: true, savedFraction: .25, storedSpeed: 225,
        commandMarked: false, previousWish: {x: 225, z: 0}}}};
    const input = {...idleInput(), jump: true, jumpPressed: true};
    const split = advanceActor(actor, input, 225 * UNIT, STEP);
    const first = advanceActor(actor, input, 225 * UNIT, STEP / 2);
    const separate = advanceActor(first, {...input, jumpPressed: false}, 225 * UNIT, STEP / 2);
    expect(split).toEqual(separate); expect(split.lastJumpPressTime).toBe(0);
  });
  it('handles a long action advance with bounded stack depth and one jump edge', () => {
    const actor: ActorKinematics = {...standing(), movementTime: 0,
      friction: {command: 0, state: {active: true, savedFraction: .25, storedSpeed: 225,
        commandMarked: false, previousWish: {x: 225, z: 0}}}};
    const input = {...idleInput(), side: 1, jump: true, jumpPressed: true};
    const frozen = JSON.stringify(actor), together = advanceActor(actor, input, 225 * UNIT, 32);
    let separate = actor;
    for (let i = 0; i < 32 * 64; i++)
      separate = advanceActor(separate, {...input, jumpPressed: i === 0}, 225 * UNIT, 1 / 64);
    expect(JSON.stringify(actor)).toBe(frozen);
    expect(together).toEqual(separate); expect(together.lastJumpPressTime).toBe(0);
  });
});
