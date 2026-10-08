import {describe,expect,it} from 'vitest';
import {advanceActor,idleInput,STEP,UNIT,type ActorKinematics} from './actor-physics';
import {gameData} from './config';
import {movementInaccuracy} from './ballistics';

// Retained build-2000927 native_audit_ak_002.dem, 64 Hz position-derived velocity.
// Native measurements include up to one sample of derivative lag. Do not tune
// friction to cancel that lag; this is a bounded consistency check.
describe('recorded AK stopping and the movement-accuracy boundary',()=>{
  it.each([{side:0,nativeThreshold:.21875,nativeStop:.390625},{side:-1,nativeThreshold:.09375}])(
    'matches the recorded stopping envelope with side=$side',({side,nativeThreshold,nativeStop})=>{
      const gun=gameData.weapons.ak47;
      let actor:ActorKinematics={position:{x:0,y:64*UNIT,z:0},velocity:{x:215*UNIT,z:0},yaw:0,
        feet:0,verticalVelocity:0,eyeHeight:64*UNIT,jumpHeld:false,grounded:true};
      let threshold:number|undefined,stop:number|undefined;
      for(let tick=1;tick<=64;tick++) {
        const before=Math.hypot(actor.velocity.x,actor.velocity.z)/(215*UNIT);
        actor=advanceActor(actor,{...idleInput(),side},215*UNIT,STEP);
        const after=Math.hypot(actor.velocity.x,actor.velocity.z)/(215*UNIT);
        if(threshold===undefined&&after<=.34) {
          threshold=tick*STEP;
          expect(movementInaccuracy(gun,before)).toBeGreaterThan(0);
          expect(movementInaccuracy(gun,after)).toBe(0);
        }
        if(stop===undefined&&actor.velocity.x<=0)stop=tick*STEP;
      }
      expect(threshold).toBeDefined();expect(Math.abs(nativeThreshold-threshold!)).toBeLessThanOrEqual(1/64);
      if(nativeStop!==undefined)expect(Math.abs(nativeStop-stop!)).toBeLessThanOrEqual(1/64);
    });
});
