import {describe, expect, it, vi} from 'vitest';
import {WeaponRecovery} from './ballistics';
import {defaults, gameData, recoilPattern, type Weapon} from './config';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';
import {PunchRecovery} from './punch-recovery';
import {recoilTableIndex, type RecoilSelection} from './recoil';
import {Simulation, STEP, type Shot} from './simulation';
import {viewPunchImpulse} from './view-punch';
import tables from './native-table-fixture.json';
import native from './native-pistol-selector-fixture.json';

const actor={position:{x:0,y:1.6,z:0},yaw:0,pitch:0,velocity:{x:0,z:0},feet:0,verticalVelocity:0,grounded:true};
const error=(a:{pitch:number;yaw:number},b:{pitch:number;yaw:number})=>Math.hypot(a.pitch-b.pitch,a.yaw-b.yaw);

describe('supplied native pistol recoil selection',()=>{
  it('matches every supplied branch/mask case from the current static proof',()=>{
    expect(native.selectionCases).toHaveLength(96);
    for(const c of native.selectionCases)
      expect(recoilTableIndex({...gameData.weapons.ak47,fullAuto:c.fullAuto},c.floatingIndex,
        {seed:c.suppliedSeed,burst:c.burstEnabled})).toBe(c.tableIndex);
  });

  it.each(native.recordings)('replays supplied anchors and reconstructed indices in $demo',recording=>{
    for(const row of recording.samples){
      const weapon=row.weapon as Weapon;
      const state=new WeaponRecovery(gameData.weapons[weapon]);
      Object.assign(state,{punch:new PunchRecovery(row.priorAngle,row.priorVelocity),
        anchorAt:0,time:row.elapsed,index:row.inferredPreShotIndex});
      state.fire(0,{seed:row.reconstructedTableIndex});
      expect(error(state.angle,row.actualAngle)).toBeLessThan(1e-5);
      expect(error(state.velocity,row.actualVelocity)).toBeLessThan(1e-5);
      expect(state.index).toBe(Math.fround(Math.fround(row.inferredPreShotIndex)+1));
      const reference=new PunchRecovery(row.actualAngle,row.actualVelocity);
      for(const t of [0,STEP,1/64,.05,.1,.2,.35,.5]){
        const p=reference.sample(t);
        expect(error(state.predict(t),{pitch:2*p.pitch,yaw:2*p.yaw})).toBeLessThan(1e-5);
      }
    }
  });

  it.each(['deagle','glock','usp'] as const)('%s uses the same selected entry for aim and camera while preserving accuracy',weapon=>{
    const a=new WeaponRecovery(gameData.weapons[weapon]),b=new WeaponRecovery(gameData.weapons[weapon]);
    a.index=b.index=1.75;
    a.fire(0,{seed:25});b.fire(0,{seed:56});
    const entry=tables[weapon][25];
    expect(a.lastViewPunch).toEqual(viewPunchImpulse(entry.angle,entry.magnitude));
    expect(a.index).toBe(b.index);expect(a.index).toBe(2.75);
    expect(a.penalty).toBe(b.penalty);expect(a.lastShot).toBe(b.lastShot);
    a.advance(.4);b.advance(.4);
    expect(a.index).toBe(b.index);expect(a.penalty).toBe(b.penalty);
  });

  it.each(['ak47','m4a4','m4a1s'] as const)('%s ordinary spray is independent of the supplied selector',weapon=>{
    const a=new WeaponRecovery(gameData.weapons[weapon]),b=new WeaponRecovery(gameData.weapons[weapon]);
    for(let shot=0;shot<12;shot++){
      a.fire(0,{seed:25});b.fire(0,{seed:56});
      expect(a.recoil).toEqual(b.recoil);expect(a.velocity).toEqual(b.velocity);
      expect(a.lastViewPunch).toEqual(b.lastViewPunch);
      a.advance(gameData.weapons[weapon].cycle);b.advance(gameData.weapons[weapon].cycle);
    }
  });

  it('preserves an imported capture even when a selector is supplied',()=>{
    const points=recoilPattern('ak47');
    const a=new WeaponRecovery(gameData.weapons.ak47,points),b=new WeaponRecovery(gameData.weapons.ak47,points);
    for(let shot=0;shot<12;shot++){
      a.fire(0,{seed:56,burst:true});b.fire();
      expect(a.recoil).toEqual(b.recoil);expect(a.velocity).toEqual(b.velocity);
      expect(a.lastViewPunch).toEqual(b.lastViewPunch);
      a.advance(.1);b.advance(.1);
    }
  });

  it.each(['deagle','glock','usp'] as const)('%s Range and Duel carry the same supplied selections through taps and rejected clicks',weapon=>{
    const supplied=[25,56,6],selection=(_weapon:string,ordinal:number):RecoilSelection=>({seed:supplied[ordinal] ?? 25});
    const random=vi.fn(()=>.5);
    const range=new Simulation({...defaults,mode:'spray',weapon,spread:false},random,selection);
    const duel=new DuelWeaponState(weapon,random,{spread:false,recoilSelection:selection});
    const shots:Shot[]=[];range.onShot=s=>shots.push(s);
    // Two short early taps must not use a selector or turn into delayed shots.
    const presses=new Set([0,4,8,64,128]);let held=false,rounds=0;
    for(let tick=0;tick<=130;tick++){
      if(tick)range.step(STEP);
      const pressed=presses.has(tick);
      if(pressed){held=true;range.pressTrigger();}
      else if(held){held=false;range.release('mouse');}
      const round=duel.advance(tick*STEP,tick?STEP:0,{...idleCommand(),firePressed:pressed,fireHeld:held},actor);
      if(round){
        const shot=shots[rounds++];expect(shot).toBeDefined();
        expect(round.ordinal).toBe(shot.ordinal);expect(round.direction).toEqual(shot.direction);
        expect(duel.recovery.recoil).toEqual(range.recovery.recoil);
        expect(duel.recovery.velocity).toEqual(range.recovery.velocity);
        expect(round.viewPunch).toEqual(range.recovery.lastViewPunch);
      }
      const snapshot=()=>JSON.stringify({angle:range.recovery.angle,velocity:range.recovery.velocity,
        index:range.recovery.index,penalty:range.recovery.penalty,time:range.recovery.time,
        lastShot:range.recovery.lastShot,viewPunch:range.recovery.lastViewPunch});
      const before=snapshot();
      const prediction=range.predictedRecoil(true);
      expect(range.predictedRecoil(true)).toEqual(prediction);
      expect(snapshot()).toBe(before);
    }
    expect(rounds).toBe(3);expect(shots).toHaveLength(3);
    expect(random).not.toHaveBeenCalled();
  });
});
