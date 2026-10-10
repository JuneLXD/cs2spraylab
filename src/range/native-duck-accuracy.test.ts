import {describe, expect, it} from 'vitest';
import {Simulation} from './simulation';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';
import {defaults, type Weapon} from './config';
import {UNIT} from './actor-physics';
import type {WeaponRecovery} from './ballistics';
import native from '../../docs/evidence/reaudit-duck-accuracy-fixture.json';

describe('common-weapon accuracy consumes the native crouch flag', () => {
  it.each(['ak47','m4a4','m4a1s','deagle','awp','usp'] as Weapon[])('%s uses recorded entry/release flag with native recovery output', weapon => {
    // Two observed counterexamples to an amount threshold: almost fully down
    // with flag clear, and already rising with the flag still set.
    for (const pose of native.baselineDisagreements.slice(0,2)) {
      const source = native.nativeUpdates.find(row => row.weapon === weapon && row.stance === (pose.duckFlag?'crouch':'stand'))!;
      const range = new Simulation({...defaults,weapon,mode:'spray'});
      range.time=1/64; range.duckAmount=pose.amount; range.duckFlag=pose.duckFlag;
      range.duckSpeed=pose.speed; range.crouchHeld=pose.desiresDuck; range.input.crouch=pose.desiresDuck;
      range.eyeHeight=(64-18*pose.amount)*UNIT; range.duckViewOffset=-18*pose.amount*UNIT;
      range.position.y=range.eyeHeight;
      const duel = new DuelWeaponState(weapon,()=>.5);
      const seed = (recovery: WeaponRecovery) => {
        recovery.advance(1/64,false,false,true,1/64);
        recovery.penalty=Math.fround(source.penalty); recovery.index=source.index; recovery.lastShot=0;
      };
      seed(range.recovery); seed(duel.recovery);
      range.step(0);
      duel.advance(1/64,0,{...idleCommand(),crouch:pose.desiresDuck},range);
      expect(range.duckFlag).toBe(pose.duckFlag);
      expect(range.recovery.penalty).toBe(source.actual.penalty);
      expect(duel.recovery.penalty).toBe(source.actual.penalty);
    }
  });

  it.each(['pop','peek'] as const)('clears the flag together with a %s pose reset', mode => {
    const range = new Simulation({...defaults,mode:'spray'});
    range.duckFlag=true; range.duckAmount=.9;
    range.configure({...range.settings,mode});
    expect(range.duckAmount).toBe(0); expect(range.duckFlag).toBe(false);
  });

  it('clears the flag when leaving a positioned drill', () => {
    const range = new Simulation({...defaults,mode:'peek'});
    range.duckFlag=true; range.duckAmount=.9;
    range.configure({...range.settings,mode:'spray'});
    expect(range.duckAmount).toBe(0); expect(range.duckFlag).toBe(false);
  });
});
