import {describe, expect, it} from 'vitest';
import {accelerateGround, advanceActor, airAcceleration, DUCK_SECONDS, UNDUCK_SECONDS, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import fixture from './native-movement-fixture.json';
import airFixture from './native-air-movement-fixture.json';

const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0},
  velocity: {x: 0, z: 0}, yaw: 0, feet: 0, verticalVelocity: 0,
  eyeHeight: 64 * UNIT, duckAmount: 0, jumpHeld: false});

describe('installed-build movement arithmetic', () => {
  it('matches the 240 offline native acceleration cases, including tagged and crouched motion', () => {
    for (const sample of fixture.cases) {
      const result = accelerateGround(sample.current * UNIT, 0, 1, 0, sample.wishSpeed * UNIT, sample.dt,
        {weaponSpeed: sample.weaponSpeed * UNIT, ducking: sample.stance === 'crouch', walking: sample.stance === 'walk'});
      expect(result.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.result, 4);
      expect(result.z).toBe(0);
    }
  });

  it('matches all 54 native air gain phases and integrates with the velocity before deferred gain', () => {
    for (const sample of airFixture.samples) {
      const phase = airAcceleration(sample.current * UNIT, 0, 1, 0, sample.wishSpeed * UNIT, sample.dt);
      expect(phase.movement.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.movementVelocity, 5);
      expect(phase.deferred.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.deferredGain, 5);
      const actor = {...standing(), position: {x: 0, y: 10 + 64 * UNIT, z: 0}, feet: 10,
        velocity: {x: sample.current * UNIT, z: 0}};
      const next = advanceActor(actor, {...idleInput(), side: 1}, sample.wishSpeed * UNIT, sample.dt);
      expect(next.velocity.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.finalVelocity, 5);
      expect(next.position.x / UNIT, JSON.stringify(sample)).toBeCloseTo(sample.movementVelocity * sample.dt, 6);
    }
  });

  it.each([
    ['walking', {walk: true}, 215], ['crouching', {crouch: true}, 215], ['slower weapon', {}, 150],
  ] as const)('includes the %s speed cap in midpoint ground displacement', (_label, command, weaponSpeed) => {
    const actor = {...standing(), velocity: {x: 215 * UNIT, z: 0}};
    const next = advanceActor(actor, {...idleInput(), side: 1, ...command}, weaponSpeed * UNIT, STEP);
    expect(next.velocity.x).toBeLessThan(actor.velocity.x);
    expect(next.position.x).toBeCloseTo((actor.velocity.x + next.velocity.x) * STEP / 2, 10);
  });

  it('matches native pre/post ground integration through acceleration, friction and stopping', () => {
    for (const sample of airFixture.groundPhases) {
      expect((sample.initialVelocity + sample.finalVelocity) / 2).toBeCloseTo(sample.movementVelocity, 4);
      expect(sample.restoredVelocity).toBeCloseTo(sample.finalVelocity, 4);
    }
    for (const [initial, side] of [[0, 1], [215, 0], [215, -1], [3, 0]]) {
      const actor = {...standing(), velocity: {x: initial * UNIT, z: 0}};
      const next = advanceActor(actor, {...idleInput(), side}, 215 * UNIT, STEP);
      expect(next.position.x).toBeCloseTo((actor.velocity.x + next.velocity.x) * STEP / 2, 10);
    }
  });

  it.each([100, 215, 250])('restores a %s u/s landing only when it exceeds the current weapon cap', speed => {
    const actor = {...standing(), movementTime: .001, landedAt: 0, landingVelocity: -300 * UNIT,
      velocity: {x: 50 * UNIT, z: 0}, landingVelocityXY: {x: speed * UNIT, z: 0}};
    const next = advanceActor(actor, {...idleInput(), jump: true}, 215 * UNIT, STEP);
    expect(next.velocity.x / UNIT).toBeCloseTo(speed > 215 ? 215 * 1.1 : 50, 5);
  });

  it('applies air strafing after restoring and capping bunnyhop momentum', () => {
    const actor = {...standing(), movementTime: .001, landedAt: 0, landingVelocity: -300 * UNIT,
      velocity: {x: 150 * UNIT, z: 0}, landingVelocityXY: {x: 250 * UNIT, z: 0}};
    const next = advanceActor(actor, {...idleInput(), jump: true, forward: 1}, 215 * UNIT, STEP);
    expect(next.velocity.x / UNIT).toBeCloseTo(215 * 1.1, 5);
    expect(next.velocity.z / UNIT).toBeCloseTo(-20.15625, 5);
    expect(next.position.z / UNIT).toBeCloseTo(-10.078125 * STEP, 6);
  });

  it('clamps ground speed to the stance cap on the next tick, before any landing has happened', () => {
    let actor = standing();
    for (let i = 0; i < 256; i++) actor = advanceActor(actor, {...idleInput(), forward: 1}, 215 * UNIT, STEP);
    expect(Math.hypot(actor.velocity.x, actor.velocity.z) / UNIT).toBeCloseTo(215, 3);
    expect(actor.landedAt).toBeUndefined();
    // Native WalkMove clamps to m_flMaxSpeed every ground tick: walking cuts
    // speed to 52% at once instead of bleeding it off through friction.
    const walking = advanceActor(actor, {...idleInput(), forward: 1, walk: true}, 215 * UNIT, STEP);
    expect(Math.hypot(walking.velocity.x, walking.velocity.z) / UNIT).toBeCloseTo(215 * .52, 5);
    // Crouching clamps to the current duck factor as the duck amount ramps.
    let ducking = actor;
    for (let i = 0; i < 4; i++) {
      ducking = advanceActor(ducking, {...idleInput(), forward: 1, crouch: true}, 215 * UNIT, STEP);
      expect(Math.hypot(ducking.velocity.x, ducking.velocity.z) / UNIT)
        .toBeCloseTo(215 * (1 - .66 * (ducking.duckAmount ?? 0)), 4);
    }
    // Damage tagging lowers the cap the same way.
    const tagged = advanceActor({...actor, velocityModifier: .5}, {...idleInput(), forward: 1}, 215 * UNIT, STEP);
    expect(Math.hypot(tagged.velocity.x, tagged.velocity.z) / UNIT).toBeCloseTo(215 * .5, 5);
  });

  it('limits a jump to 1.1x the weapon speed unless bunnyhopping is enabled', () => {
    const fast = {...standing(), velocity: {x: 300 * UNIT, z: 0}};
    const jumped = advanceActor(fast, {...idleInput(), forward: 0, jump: true}, 215 * UNIT, STEP);
    expect(jumped.verticalVelocity).toBeGreaterThan(0);
    expect(jumped.velocity.x / UNIT).toBeCloseTo(215 * 1.1, 4);
    const grounded = advanceActor(fast, idleInput(), 215 * UNIT, STEP);
    expect(grounded.velocity.x / UNIT).toBeCloseTo(215, 4); // ground clamp, no 1.1x allowance
    const free = advanceActor(fast, {...idleInput(), jump: true}, 215 * UNIT, STEP, undefined, undefined, undefined,
      {solids: [], floor: 0, jumpRules: {enableBunnyhopping: true}});
    expect(free.verticalVelocity).toBeGreaterThan(0);
    expect(free.velocity.x / UNIT).toBeCloseTo(300, 4);
  });

  it.each([150, 215, 225, 240, 250])('can reach the full %s u/s weapon crouch cap from rest', speed => {
    let actor = standing();
    for (let i = 0; i < 256; i++) actor = advanceActor(actor, {...idleInput(), crouch: true, side: 1}, speed * UNIT, STEP);
    expect(actor.velocity.x / UNIT).toBeCloseTo(speed * .34, 5);
  });

  it('uses the native maximum 6.4/s down and 8/s up rates when crouch speed is recovered', () => {
    let actor = standing();
    actor.crouchHeld = true;
    actor = advanceActor(actor, {...idleInput(), crouch: true}, 215 * UNIT, DUCK_SECONDS / 2);
    expect(actor.duckAmount).toBeCloseTo(.5);
    actor = advanceActor(actor, {...idleInput(), crouch: true}, 215 * UNIT, DUCK_SECONDS / 2);
    expect(actor.duckAmount).toBe(1);
    actor.crouchHeld = false;
    actor = advanceActor(actor, idleInput(), 215 * UNIT, UNDUCK_SECONDS / 2);
    expect(actor.duckAmount).toBeCloseTo(.5);
    actor = advanceActor(actor, idleInput(), 215 * UNIT, UNDUCK_SECONDS / 2);
    expect(actor.duckAmount).toBe(0);
    expect(actor.eyeHeight).toBe(64 * UNIT);
  });

  it('consumes speed on both crouch edges, recovers at rest and prevents crouch spam', () => {
    let actor = advanceActor(standing(), {...idleInput(), crouch: true}, 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBeCloseTo(6 + 3 * STEP);
    expect(actor.duckAmount).toBeCloseTo((6 + 3 * STEP) * .8 * STEP);
    actor = advanceActor(actor, idleInput(), 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBeCloseTo(4 + 6 * STEP);
    for (let i = 0; i < 20; i++) actor = advanceActor(actor, {...idleInput(), crouch: i % 2 === 0}, 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBeLessThan(1.5);
    expect(actor.duckAmount).toBe(0);
    for (let i = 0; i < 384; i++) actor = advanceActor(actor, idleInput(), 215 * UNIT, STEP);
    expect(actor.duckSpeed).toBe(8);
  });

  it('does not let repeated crouch/jump edges manufacture vertical momentum', () => {
    let actor = standing();
    let maxFeet = 0;
    for (let i = 0; i < 256; i++) {
      actor = advanceActor(actor, {...idleInput(), crouch: i % 8 < 4, jump: i < 180}, 215 * UNIT, STEP);
      maxFeet = Math.max(maxFeet, actor.feet);
      expect(Number.isFinite(actor.position.y)).toBe(true);
    }
    expect(maxFeet).toBeLessThan(76 * UNIT);
    expect(actor.feet).toBe(0);
    expect(actor.verticalVelocity).toBe(0);
  });

  it('retains momentum on release and counterstrafes faster without instantly reversing', () => {
    let released = {...standing(), velocity: {x: 215 * UNIT, z: 0}};
    let reversed = {...standing(), velocity: {x: 215 * UNIT, z: 0}};
    let releaseTicks = 0, reverseTicks = 0;
    while (released.velocity.x > 215 * .34 * UNIT) {
      released = advanceActor(released, idleInput(), 215 * UNIT, STEP); releaseTicks++;
    }
    while (reversed.velocity.x > 215 * .34 * UNIT) {
      reversed = advanceActor(reversed, {...idleInput(), side: -1}, 215 * UNIT, STEP); reverseTicks++;
    }
    expect(reverseTicks).toBeGreaterThan(1);
    expect(reverseTicks).toBeLessThan(releaseTicks);
    expect(reversed.velocity.x).toBeGreaterThan(0);
  });
});
