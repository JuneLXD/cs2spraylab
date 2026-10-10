import {describe,expect,it} from 'vitest';
import {FootstepCadence} from './footsteps';
import native from './native-footsteps-fixture.json';
import {Simulation} from './simulation';
import {defaults} from './config';
import {DuelSimulation} from './duel/simulation';
import {sanitizeDuelConfig} from './duel/config';
import {testArena} from './duel/geometry';
import {STEP,UNIT,idleInput,type ActorKinematics} from './actor-physics';

const running=(speed:number):ActorKinematics=>({position:{x:0,y:64*UNIT,z:0},velocity:{x:speed*UNIT,z:0},
  yaw:0,feet:0,eyeHeight:64*UNIT,verticalVelocity:0,grounded:true,jumpHeld:false});

describe('native footstep timer and gates',()=>{
  it.each(native.rows)('$name',row=>{
    const clock=new FootstepCadence();clock.remainingMs=row.beforeMs;
    const input=row.input as {speed:number;dt?:number;grounded?:boolean;walking?:boolean;ducked?:boolean};
    expect(clock.advance(input.dt??1/64,input.speed,input.grounded??true,input.walking??false,input.ducked??false)).toBe(row.after.events.length>0);
    expect(clock.remainingMs).toBeCloseTo(row.after.remainingMs,4);
  });
  it.each(native.sequences)('matches every native steady $name event',row=>{
    const clock=new FootstepCadence(),times:number[]=[];
    for(let i=0;i<384;i++)if(clock.advance(STEP,row.speed,true,false,false))times.push((i+1)*STEP);
    expect(times).toEqual(row.events.map(e=>e.time));
  });
  it.each(native.commandSequences)('retains native64Hz $name timing across128Hz physics subdivisions',row=>{
    const clock=new FootstepCadence(),times:number[]=[];
    for(let i=0;i<384;i++)if(clock.update((i+1)*STEP,STEP,running(row.speed),idleInput()))times.push((i+1)*STEP);
    expect(times).toEqual(row.events.map(e=>e.time));
  });
  it('uses velocity at the start of the native command, before movement changes it',()=>{
    const clock=new FootstepCadence();clock.remainingMs=1;
    expect(clock.update(STEP,STEP,running(200),idleInput())).toBe(false);
    expect(clock.update(2*STEP,STEP,running(0),idleInput())).toBe(true);
  });
  it('splits an in-progress command when movement input changes',()=>{
    const clock=new FootstepCadence();clock.remainingMs=6;
    expect(clock.update(STEP,STEP,running(200),{...idleInput(),side:1})).toBe(false);
    expect(clock.update(2*STEP,STEP,running(200),{...idleInput(),side:1,walk:true})).toBe(true);
    // The first segment emits at the input edge; walking preserves its new countdown.
    expect(clock.remainingMs).toBe(400);
  });
  it('discards a pending partial command when the actor resets',()=>{
    const clock=new FootstepCadence();clock.remainingMs=1;clock.update(STEP,STEP,running(200),idleInput());
    clock.reset();expect(clock.update(2*STEP,STEP,running(200),idleInput())).toBe(false);
    expect(clock.remainingMs).toBe(300-1000*STEP);
  });
  it('preserves a partly elapsed countdown through walking, then consumes it on resuming',()=>{
    const clock=new FootstepCadence();clock.advance(.2,215,true,false,false);
    clock.advance(1,110,true,true,false);expect(clock.remainingMs).toBe(100);
    expect(clock.advance(.1,215,true,false,false)).toBe(true);expect(clock.remainingMs).toBe(400);
  });
  it('expires silently in air and emits after ground contact',()=>{
    const clock=new FootstepCadence();expect(clock.advance(.4,215,false,false,false)).toBe(false);
    expect(clock.remainingMs).toBe(0);expect(clock.advance(STEP,215,true,false,false)).toBe(true);
  });
});

describe('both engine sound callbacks',()=>{
  it.each(['range','duel'] as const)('%s samples before movement and closes the old segment at a walk edge',engine=>{
    for(const edge of [false,true]){
      const range=new Simulation({...defaults,mode:'guided'});
      const duel=new DuelSimulation(sanitizeDuelConfig({botCount:1}),42,testArena(),'ak47');
      const times:number[]=[];
      range.active=true;range.onSound=landing=>{if(!landing)times.push(range.time)};
      duel.command(1,{forward:0,side:0,fireHeld:false});duel.start();
      const actor=engine==='range'?range:duel.actors[0];
      const cadence=engine==='range'?range['footsteps']:duel.actors[0].footsteps;
      actor.velocity={x:(edge?200:136)*UNIT,z:0};
      cadence.remainingMs=edge?6:1;
      const advance=()=>{
        if(engine==='range')range.advance(STEP);
        else{duel.step(STEP);for(const e of duel.drainEvents())if(e.kind==='sound'&&e.sound==='footstep'&&e.actorId===0)times.push(duel.time);}
      };
      advance();expect(times).toEqual([]);
      if(edge){range.input.walk=true;duel.command(0,{walk:true});}
      else expect(Math.hypot(actor.velocity.x,actor.velocity.z)/UNIT).toBeLessThan(135.2);
      advance();expect(times).toEqual([2*STEP]);
      if(edge)expect(cadence.remainingMs).toBe(400);
    }
  });
  it.each(['range','duel'] as const)('%s uses native cadence and keeps walk/crouch silent',engine=>{
    for(const equipment of ['ak47','awp','knife'] as const)for(const stance of ['run','walk','crouch'] as const){
      const primary=equipment==='knife'?'ak47':equipment;
      const range=new Simulation({...defaults,mode:'guided',weapon:primary});
      const duel=new DuelSimulation(sanitizeDuelConfig({botCount:1}),42,testArena(),primary);
      const times:number[]=[];
      if(equipment==='knife'){range.equip(3);duel.equipPlayer(3);}
      range.active=true;range.onSound=landing=>{if(!landing)times.push(range.time)};
      duel.command(1,{forward:0,side:0,fireHeld:false});duel.start();
      const advance=()=>{
        if(engine==='range')range.advance(STEP);
        else{duel.step(STEP);for(const e of duel.drainEvents())if(e.kind==='sound'&&e.sound==='footstep'&&e.actorId===0)times.push(duel.time);}
      };
      for(let i=0;i<64;i++)advance();
      const input={side:1,walk:stance==='walk',crouch:stance==='crouch'};
      Object.assign(range.input,input);duel.command(0,input);
      for(let i=0;i<192;i++)advance();
      if(stance==='run'){
        expect(times.length).toBeGreaterThanOrEqual(3);
        for(let i=1;i<times.length;i++)expect(times[i]-times[i-1]).toBe(equipment==='knife'?40*STEP:52*STEP);
        const actor=engine==='range'?range:duel.actors[0];
        expect(Math.hypot(actor.velocity.x,actor.velocity.z)/UNIT).toBeCloseTo(equipment==='knife'?250:equipment==='ak47'?215:200,4);
      }else expect(times).toEqual([]);
    }
  });
  it('does not create footsteps while pressing into a solid wall',()=>{
    const sim=new Simulation({...defaults,mode:'guided'});sim.active=true;sim.input.side=1;sim.position.x=11.3;
    const times:number[]=[];sim.onSound=landing=>{if(!landing)times.push(sim.time)};
    for(let i=0;i<256;i++)sim.advance(STEP);
    expect(times).toEqual([]);
  });
  it('discards a pending sound when cancelling range movement',()=>{
    const sim=new Simulation({...defaults,mode:'guided'});sim.active=true;sim.input.side=1;
    sim.velocity={x:200*UNIT,z:0};sim['footsteps'].remainingMs=1;
    const times:number[]=[];sim.onSound=landing=>{if(!landing)times.push(sim.time)};
    sim.advance(STEP);sim.cancel();sim.active=true;sim.advance(STEP);
    expect(times).toEqual([]);expect(sim['footsteps'].remainingMs).toBe(300);
  });
  it.each(['pop','peek'] as const)('clears accumulated footstep state when the range changes pose for %s',mode=>{
    const sim=new Simulation({...defaults,mode:'spray'});sim.active=true;sim.input.side=1;
    for(let i=0;i<32;i++)sim.advance(STEP);
    expect(sim['footsteps'].remainingMs).toBeLessThan(300);
    sim.configure({...sim.settings,mode});
    expect(sim['footsteps'].remainingMs).toBe(300);
  });
});
