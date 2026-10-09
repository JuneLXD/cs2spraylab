import {describe, expect, it} from 'vitest';
import {advanceActor, GRAVITY, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import native from './native-movement-reaudit-fixture.json';
import {Simulation} from './simulation';
import {defaults} from './config';

const standing = (): ActorKinematics => ({position: {x: 0, y: 64 * UNIT, z: 0}, feet: 0,
  eyeHeight: 64 * UNIT, velocity: {x: 0, z: 0}, verticalVelocity: 0, yaw: 0,
  duckAmount: 0, duckSpeed: 8, grounded: true, jumpHeld: false});

describe('fresh native movement recording: native_reaudit_airduck_003', () => {
  it.each(native.launch)('launch velocity recorded at demo tick $tick', source => {
    const crouch = source.duckAmount > 0;
    const actor = {...standing(), duckAmount: source.duckAmount, crouchHeld: crouch,
      eyeHeight: (64 - 18 * source.duckAmount) * UNIT};
    const next = advanceActor(actor, {...idleInput(), jump: true, crouch}, 215 * UNIT, 0);
    expect(next.verticalVelocity / UNIT).toBeCloseTo(source.velocity, 3);
  });

  it.each(native.originChanges)('air stance changes match the origin residual at demo tick $tick', source => {
    const crouch = source.afterAmount > 0;
    const actor = {...standing(), feet: 100 * UNIT, position: {x: 0, y: 164 * UNIT, z: 0},
      grounded: false, duckAmount: source.beforeAmount, crouchHeld: !crouch,
      eyeHeight: (64 - 18 * source.beforeAmount) * UNIT};
    const next = advanceActor(actor, {...idleInput(), crouch}, 215 * UNIT, STEP);
    const shift = (next.feet - actor.feet + GRAVITY * STEP * STEP / 2) / UNIT;
    expect(next.duckAmount).toBe(source.afterAmount);
    // Source network positions in this demo quantize to 1/64 unit.
    expect(Math.abs(shift - source.ballisticResidual)).toBeLessThan(1 / 64);
  });

  it.each(native.phases)('$name reproduces every recorded eye-offset state', phase => {
    const first = phase.samples[0], feet = phase.air ? 1000 * UNIT : 0;
    let actor: ActorKinematics = {...standing(), feet, grounded: !phase.air,
      position: {x: 0, y: feet + (64 + first.viewOffset + first.rootOffset) * UNIT, z: 0},
      eyeHeight: (64 + first.viewOffset + first.rootOffset) * UNIT,
      duckAmount: first.amount, duckSpeed: first.speed, crouchHeld: phase.held,
      duckViewOffset: first.viewOffset * UNIT, duckRootOffset: first.rootOffset * UNIT};
    for (const sample of phase.samples.slice(1)) {
      actor = advanceActor(actor, {...idleInput(), crouch: phase.held}, 215 * UNIT, native.sampleInterval);
      expect(actor.duckAmount, `amount at ${sample.tick}`).toBeCloseTo(sample.amount, 5);
      expect(actor.duckViewOffset! / UNIT, `view at ${sample.tick}`).toBeCloseTo(sample.viewOffset, 4);
      expect(actor.duckRootOffset! / UNIT, `root at ${sample.tick}`).toBeCloseTo(sample.rootOffset, 4);
      expect(actor.eyeHeight / UNIT).toBeCloseTo(64 + sample.viewOffset + sample.rootOffset, 4);
    }
  });
});

describe('duck camera state across terrain contacts and resets', () => {
  it('does not turn a floor penetration correction into a crouch camera offset', () => {
    const actor = {...standing(), feet: -UNIT, position: {x: 0, y: 63 * UNIT, z: 0}};
    const next = advanceActor(actor, idleInput(), 215 * UNIT, 0);
    expect(next.feet).toBe(0);
    expect(next.duckRootOffset).toBe(0);
    expect(next.eyeHeight).toBe(64 * UNIT);
  });

  it('retains the crouched camera when an airborne unduck lacks ceiling clearance', () => {
    const actor = {...standing(), feet: 100 * UNIT, position: {x: 0, y: 146 * UNIT, z: 0},
      grounded: false, duckAmount: 1, crouchHeld: true, eyeHeight: 46 * UNIT,
      duckViewOffset: -18 * UNIT, duckRootOffset: 0};
    const next = advanceActor(actor, idleInput(), 215 * UNIT, STEP, undefined, () => false);
    expect(next.duckAmount).toBe(1);
    expect(next.duckRootOffset).toBe(0);
    expect(next.eyeHeight).toBe(46 * UNIT);
    expect(next.feet).toBeCloseTo(actor.feet - GRAVITY * STEP * STEP / 2);
  });

  it('continues the existing camera recovery through landing without compensating contact motion', () => {
    const actor = {...standing(), feet: .02, verticalVelocity: -5, grounded: false,
      duckAmount: 1, crouchHeld: true, eyeHeight: 55 * UNIT,
      duckViewOffset: -2 * UNIT, duckRootOffset: -7 * UNIT};
    const next = advanceActor(actor, {...idleInput(), crouch: true}, 215 * UNIT, STEP);
    expect(next.grounded).toBe(true);
    expect(next.duckRootOffset! / UNIT).toBeCloseTo(-7 + 90 * STEP);
    expect(next.duckViewOffset! / UNIT).toBeCloseTo(-2 - 90 * STEP);
  });

  it('does not create root compensation for a subtick landing and immediate bounce', () => {
    const actor = {...standing(), feet: .003, verticalVelocity: -1, grounded: false};
    const next = advanceActor(actor, {...idleInput(), jump: true}, 215 * UNIT, STEP);
    expect(next.grounded).toBe(false);
    expect(next.verticalVelocity).toBeGreaterThan(0);
    expect(next.duckRootOffset).toBe(0);
  });

  it.each(['pop', 'peek'] as const)('clears both offset states when resetting the range pose for %s', mode => {
    const sim = new Simulation({...defaults, mode: 'spray'});
    sim.input.jump = true; sim.input.crouch = true;
    sim.step(STEP);
    expect(sim.duckRootOffset).toBeLessThan(0);
    expect(sim.duckViewOffset).toBeLessThan(0);
    sim.configure({...sim.settings, mode});
    expect(sim.duckRootOffset).toBe(0);
    expect(sim.duckViewOffset).toBe(0);
    expect(sim.eyeHeight).toBe(64 * UNIT);
  });
});
