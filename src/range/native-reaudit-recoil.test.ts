import {describe, expect, it} from 'vitest';
import {defaults, gameData} from './config';
import {WeaponRecovery} from './ballistics';
import {PunchRecovery} from './punch-recovery';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';
import native from './native-reaudit-recoil-fixture.json';
import {Simulation, type Shot} from './simulation';

const converted=([pitch,yaw,roll]:number[])=>({pitch:-pitch,yaw:-yaw,roll:-roll});
const actor={position:{x:0,y:1.6,z:0},yaw:0,pitch:0,velocity:{x:0,z:0},feet:0,verticalVelocity:0,grounded:true};

describe('fresh native scheduled recoil',()=>{
  it('anchors each impulse at its schedule and renders its decay through the processing tick',()=>{
    const recovery=new WeaponRecovery(gameData.weapons.ak47);let previous=0;
    for(const row of native.samples){
      const processed=Math.ceil((row.elapsed-1e-8)*64)/64;
      recovery.advance(processed-previous);recovery.fire(processed-row.elapsed);previous=processed;
      const reference=new PunchRecovery(converted(row.angle),converted(row.velocity));
      const angle=reference.sample(processed-row.elapsed),velocity=reference.velocity(processed-row.elapsed);
      for(const key of ['pitch','yaw'] as const){
        expect(recovery.angle[key]).toBeCloseTo(angle[key],5);
        expect(recovery.velocity[key]).toBeCloseTo(velocity[key],4);
      }
    }
  });
  it('preserves the native curve through the live held-trigger state machine',()=>{
    const state=new DuelWeaponState('ak47',()=>.5,{spread:false});
    let ordinal=0;
    for(let tick=0;tick<=64;tick++){
      const at=tick/128;
      const round=state.advance(at,tick?1/128:0,{...idleCommand(),fireHeld:true,firePressed:tick===0},actor);
      if(!round)continue;
      const row=native.samples[ordinal++];expect(row).toBeDefined();
      const reference=new PunchRecovery(converted(row.angle),converted(row.velocity));
      const angle=reference.sample(at-row.elapsed);
      expect(state.recovery.angle.pitch).toBeCloseTo(angle.pitch,5);
      expect(state.recovery.angle.yaw).toBeCloseTo(angle.yaw,5);
    }
    expect(ordinal).toBe(native.samples.length);
  });
  it.each([13,39])('keeps both guides on the scheduled trajectory after it is due, at step %i',tick=>{
    const sim=new Simulation({...defaults,weapon:'ak47',spread:false}),shots:Shot[]=[];
    sim.onShot=shot=>shots.push(shot);sim.start();
    for(let n=0;n<tick;n++)sim.step(1/128);
    expect(sim.time).toBeGreaterThan(sim.nextShot);
    expect(sim.time-sim.nextShot).toBeLessThan(1/64);
    const count=shots.length,next=sim.predictedRecoil(),following=sim.predictedRecoil(true);
    while(shots.length<count+2)sim.step(1/128);
    expect(next).toEqual(shots[count].recoil);
    expect(following).toEqual(shots[count+1].recoil);
  });
});
