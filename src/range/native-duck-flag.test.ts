import {describe, expect, it} from 'vitest';
import {advanceActor, idleInput, STEP, UNIT, type ActorKinematics} from './actor-physics';
import movement from './native-movement-reaudit-fixture.json';
import native from './native-duck-flag-fixture.json';

const standing = (): ActorKinematics => ({position:{x:0,y:64*UNIT,z:0}, feet:0, eyeHeight:64*UNIT,
  velocity:{x:0,z:0}, verticalVelocity:0, yaw:0, duckAmount:0, duckFlag:false,
  duckSpeed:8, grounded:true, jumpHeld:false});

describe('native crouch flag separate from amount and transition state', () => {
  it.each(['groundDuck','groundUnduck'] as const)('replays every captured %s flag after the first supplied seed', name => {
    const phase = movement.phases.find(p => p.name === name)!;
    const flags = new Map(native[name].map(([tick,flag]) => [Number(tick),Boolean(flag)]));
    const first = phase.samples[0];
    let actor: ActorKinematics = {...standing(), duckAmount:first.amount, duckSpeed:first.speed,
      duckFlag:flags.get(first.tick), crouchHeld:phase.held,
      duckViewOffset:first.viewOffset*UNIT, duckRootOffset:first.rootOffset*UNIT};
    for (const sample of phase.samples.slice(1)) {
      actor = advanceActor(actor, {...idleInput(),crouch:phase.held},215*UNIT,movement.sampleInterval);
      expect(actor.duckAmount, `amount tick ${sample.tick}`).toBeCloseTo(sample.amount,5);
      expect(actor.duckFlag, `flag tick ${sample.tick}`).toBe(flags.get(sample.tick));
    }
  });

  it.each(native.airChanges)('carries the recorded air transition at tick $tick', source => {
    const actor = {...standing(), feet:100*UNIT, position:{x:0,y:164*UNIT,z:0}, grounded:false,
      duckAmount:source.beforeAmount, duckFlag:source.beforeFlag, crouchHeld:source.beforeFlag};
    const next = advanceActor(actor,{...idleInput(),crouch:source.afterFlag},215*UNIT,STEP);
    expect(next.duckAmount).toBe(source.afterAmount);
    expect(next.duckFlag).toBe(source.afterFlag);
  });

  it('clears at exactly .75, retaining the native strict-above boundary', () => {
    const actor = {...standing(),duckFlag:true,crouchHeld:false};
    expect(advanceActor({...actor,duckAmount:.75},idleInput(),215*UNIT,0).duckFlag).toBe(false);
    expect(advanceActor({...actor,duckAmount:.750001},idleInput(),215*UNIT,0).duckFlag).toBe(true);
  });

  it('preserves different flags at the same amount during initial duck and re-crouch', () => {
    for (const duckFlag of [false,true]) {
      const actor = {...standing(),duckAmount:.9,duckFlag,crouchHeld:true};
      expect(advanceActor(actor,{...idleInput(),crouch:true},215*UNIT,0).duckFlag).toBe(duckFlag);
    }
  });

  it('uses the latched flag for cooldown eligibility instead of the amount', () => {
    const actor = {...standing(),duckAmount:.9,crouchHeld:true,duckCooldown:.2};
    const clear = advanceActor({...actor,duckFlag:false},{...idleInput(),crouch:true},215*UNIT,STEP);
    const set = advanceActor({...actor,duckFlag:true},{...idleInput(),crouch:true},215*UNIT,STEP);
    expect(clear.duckAmount).toBeLessThan(.9);
    expect(clear.duckFlag).toBe(false);
    expect(set.duckAmount).toBeGreaterThan(.9);
    expect(set.duckFlag).toBe(true);
  });

  it.each([true,false])('retains fully crouched blocked release, grounded=%s', grounded => {
    const feet = grounded ? 0 : 100*UNIT;
    const actor = {...standing(),feet,position:{x:0,y:feet+46*UNIT,z:0},grounded,
      duckAmount:1,duckFlag:true,crouchHeld:true,eyeHeight:46*UNIT,duckViewOffset:-18*UNIT};
    const next = advanceActor(actor,idleInput(),215*UNIT,STEP,undefined,()=>false);
    expect(next.duckAmount).toBe(1);
    expect(next.duckFlag).toBe(true);
  });
});
