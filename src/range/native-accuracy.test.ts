import {describe, expect, it} from 'vitest';
import {WeaponRecovery} from './ballistics';
import {defaults, gameData, type Weapon} from './config';
import {weaponModeStats} from './equipment';
import {DuelWeaponState} from './duel/weapon-state';
import {idleCommand} from './duel/types';
import {Simulation} from './simulation';
import native from './native-accuracy-fixture.json';

const actor={position:{x:0,y:1.6,z:0},yaw:0,pitch:0,velocity:{x:0,z:0},feet:0,verticalVelocity:0,grounded:true};
type Row=(typeof native.episodes)[number]['rows'][number];
function seed(state:WeaponRecovery,row:Row){
  state.time=row.time;state.penalty=Math.fround(row.penalty);state.index=Math.fround(row.index);state.lastShot=row.lastShot;
  state.advance(0,false,false,false,row.time);
}
function snapshot(state:WeaponRecovery,row:Row){
  expect(state.penalty,`penalty tick ${row.tick}`).toBeCloseTo(row.penalty,7);
  expect(state.index,`index tick ${row.tick}`).toBeCloseTo(row.index,6);
}

describe('native accuracy arithmetic and phase',()=>{
  it.each(['awp','aug'] as const)('initializes %s recovery independently of the first mode lookup',weapon=>{
    const early=new Simulation({...defaults,weapon}),late=new Simulation({...defaults,weapon});
    const initial=early.recovery.penalty;
    early.actions.secondary(0);late.actions.secondary(0);
    expect(late.recovery.penalty).toBe(initial);
    expect(late.recovery.weapon).toBe(late.stats);
    early.active=true;late.active=true;
    early.step(1/64);late.step(1/64);
    expect(late.recovery.penalty).toBe(early.recovery.penalty);
  });
  it('reproduces 306 independent current-server invocations including alternate primary-cycle gates',()=>{
    for(const sample of native.nativeUpdates){
      const id=sample.weapon as Weapon,base=gameData.weapons[id];
      const state=new WeaponRecovery(weaponModeStats(id,!!sample.mode),undefined,base.cycle);
      state.penalty=Math.fround(sample.penalty);state.index=Math.fround(sample.index);
      state.advance(0,sample.stance==='crouch',sample.stance==='air',true,sample.time);
      state.lastShot=-sample.time; // local shot zero mapped to the supplied absolute clock
      // Exercise one native body invocation independently of the scheduler.
      Reflect.get(state,'updateAccuracy').call(state,sample.time);
      expect(state.penalty,JSON.stringify(sample)).toBe(sample.actual.penalty);
      expect(state.index,JSON.stringify(sample)).toBe(sample.actual.index);
    }
  });
  it.each(native.episodes)('replays native snapshots cumulatively: $demo',episode=>{
    const id=episode.weapon as Weapon,state=new WeaponRecovery(weaponModeStats(id,!!episode.rows[0].mode),undefined,gameData.weapons[id].cycle);
    seed(state,episode.rows[0]);
    for(let n=1;n<episode.rows.length;n++){
      const row=episode.rows[n],previous=episode.rows[n-1];
      state.setParameters(weaponModeStats(id,!!row.mode));
      state.advance(row.time-previous.time,false,false,true,row.time);
      if(row.shot!==null){state.beforeShot(row.time-row.shot);state.fire(row.time-row.shot);}
      state.finishAccuracy();snapshot(state,row);
    }
  });
  it.each([1,2,5,13])('preserves accuracy across %i subdivisions and prediction without extra ticks',parts=>{
    const whole=new WeaponRecovery(gameData.weapons.ak47),split=new WeaponRecovery(gameData.weapons.ak47);
    whole.fire();split.fire();
    for(let tick=1;tick<=64;tick++){
      whole.advance(1/64);
      for(let part=0;part<parts;part++)split.advance(1/64/parts);
      const before=JSON.stringify(split);split.predict(.017,true);expect(JSON.stringify(split)).toBe(before);
      expect(split.penalty).toBe(whole.penalty);expect(split.index).toBe(whole.index);
    }
  });
  it('keeps a newly equipped weapon and its prediction on the round clock',()=>{
    const clock=93.214599609375,local=new WeaponRecovery(gameData.weapons.ak47),absolute=new WeaponRecovery(gameData.weapons.ak47);
    absolute.time=clock;
    for(const state of [local,absolute]){state.advance(0,false,false,false,clock);state.fire();}
    for(let tick=1;tick<=90;tick++){
      local.advance(1/128);absolute.advance(1/128);
      expect(local.penalty).toBe(absolute.penalty);expect(local.index).toBe(absolute.index);
      const a=local.predict(.1,true),b=absolute.predict(.1,true);
      expect(a.pitch).toBeCloseTo(b.pitch,7);expect(a.yaw).toBeCloseTo(b.yaw,7);
    }
  });
  it.each(native.episodes.filter(e=>e.weapon==='ak47'))('both live engines preserve a native held burst and recovery: $demo',episode=>{
    const first=episode.rows[0],shots=episode.rows.filter(r=>r.shot!==null),press=shots[0].shot!;
    const range=new Simulation({...defaults,weapon:'ak47',spread:false}),duel=new DuelWeaponState('ak47',()=>.5,{spread:false});
    range.time=first.time;range.active=true;seed(range.recovery,first);seed(duel.recovery,first);
    let time=first.time,pressed=false,rangeShots=0,duelShots=0;
    range.onShot=()=>rangeShots++;
    for(const row of episode.rows.slice(1)){
      while(time<row.time-1e-10){
        const at=Math.min(row.time,(Math.floor(time*128+1e-8)+1)/128,!pressed?press:Infinity),dt=at-time;
        const down=!pressed&&at===press;
        range.step(dt);
        if(down){range.start();pressed=true;}
        const held=pressed&&duelShots<shots.length;
        if(duel.advance(at,dt,{...idleCommand(),fireHeld:held,firePressed:down},actor))duelShots++;
        if(rangeShots===shots.length)range.release('mouse');
        time=at;
      }
      snapshot(range.recovery,row);snapshot(duel.recovery,row);
    }
    expect(rangeShots).toBe(shots.length);expect(duelShots).toBe(shots.length);
  });
  it.each(native.reloads)('both engines apply the captured reload-start index order: $demo, automatic=$automatic',episode=>{
    const [a,b]=episode.rows,id=episode.weapon as Weapon;
    const range=new Simulation({...defaults,weapon:id}),duel=new DuelWeaponState(id,()=>.5);
    range.time=a.time;range.active=true;seed(range.recovery,a);seed(duel.recovery,a);
    range.reloadState.ammo=episode.automatic?0:1;duel.ammo=range.loadedAmmo;
    // Captured reload command time is supplied; this checks the accuracy hook,
    // not reconstruction of a player's unrecorded button input.
    range.step(b.time-a.time);if(!episode.automatic)range.reload();
    duel.advance(b.time,b.time-a.time,{...idleCommand(),reloadPressed:true,reloadAutomatic:episode.automatic},actor);
    snapshot(range.recovery,b);snapshot(duel.recovery,b);
  });

});
