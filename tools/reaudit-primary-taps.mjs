// Ordinary common-weapon early presses through both actual simulation engines.
// Native state branches are proved separately; this is not a mouse-mask replay.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];
if(!['--repo','--output'].every(n=>args.includes(n)))throw Error('Use --repo PATH --output NEW.json');
const repo=path.resolve(get('--repo')),output=path.resolve(get('--output'));
if(fs.existsSync(output))throw Error('Output exists');
const require=createRequire(repo+'/package.json'),{buildSync}=require('esbuild');
const built=buildSync({stdin:{contents:`export {defaults,gameData} from './src/range/config';export {Simulation} from './src/range/simulation';export {DuelWeaponState} from './src/range/duel/weapon-state';export {idleCommand} from './src/range/duel/types';`,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const mod=new Module(repo+'/.primary-taps.cjs');mod.filename=repo+'/.primary-taps.cjs';mod.paths=Module._nodeModulePaths(repo);mod._compile(built.outputFiles[0].text,mod.filename);
const {defaults,gameData,Simulation,DuelWeaponState,idleCommand}=mod.exports;
const hash=x=>createHash('sha256').update(x).digest('hex'),cases=[];
const actor={position:{x:0,y:1.6,z:0},yaw:0,pitch:0,velocity:{x:0,z:0},feet:0,verticalVelocity:0,grounded:true};
for(const weapon of ['ak47','m4a4','m4a1s','glock','usp','deagle','awp']){
 const cycle=gameData.weapons[weapon].cycle,readyTick=Math.ceil((cycle+.04)*128);
 for(const scenario of ['released-early','held-early','repress-early','ready-tap']){
  const pressTicks=scenario==='ready-tap'?[0,readyTick]:scenario==='repress-early'?[0,4,10]:[0,4];
  const releaseTicks=scenario==='ready-tap'?[1,readyTick+1]:scenario==='held-early'?[1]
    :scenario==='repress-early'?[1,7]:[1,7];
  for(const engine of ['range','duel']){
   const state=engine==='range'?new Simulation({...defaults,weapon,mode:'spray',spread:false})
     :new DuelWeaponState(weapon,()=>.5,{spread:false});
   const shots=[],rows=[];let held=false;
   if(engine==='range')state.onShot=s=>shots.push({ordinal:s.ordinal,processedAt:s.at,scheduledAt:state.lastShotAt});
   for(let tick=0;tick<=Math.ceil((cycle+.16)*128);tick++){
    const time=tick/128,pressed=pressTicks.includes(tick),released=releaseTicks.includes(tick);
    if(engine==='range'&&tick)state.step(1/128);
    if(pressed){held=true;if(engine==='range')state.pressTrigger();}
    if(released){held=false;if(engine==='range')state.release('mouse');}
    if(engine==='duel'){
     const round=state.advance(time,tick?1/128:0,{...idleCommand(),firePressed:pressed,fireHeld:held},actor);
     if(round)shots.push({ordinal:round.ordinal,processedAt:time,scheduledAt:state.recovery.lastShot});
    }
    rows.push({time,held,pressed,released,ammo:engine==='range'?state.loadedAmmo:state.ammo,
      shots:shots.length,index:state.recovery.index,penalty:state.recovery.penalty});
   }
   const subsequent=shots.filter(s=>s.ordinal>0);
   cases.push({weapon,engine,scenario,cycle,pressTicks,releaseTicks,shots,rows,
     expectedSecond:scenario==='released-early'?null:scenario==='ready-tap'?readyTick/128:Math.ceil(cycle*64)/64,
     actualSecond:subsequent[0]?.processedAt??null});
  }
 }
}
const summary={cases:cases.length,expectationFailures:cases.filter(c=>c.expectedSecond!==c.actualSecond).map(c=>({weapon:c.weapon,engine:c.engine,scenario:c.scenario,expected:c.expectedSecond,actual:c.actualSecond})),
 pairs:cases.length/2,pairMismatches:[]};
for(let i=0;i<cases.length;i+=2){
 const a=cases[i],b=cases[i+1];
 if(JSON.stringify(a.shots)!==JSON.stringify(b.shots))summary.pairMismatches.push({weapon:a.weapon,scenario:a.scenario,range:a.shots,duel:b.shots});
}
const report={method:'Actual Range/Duel ordinary commands on supplied128Hz boundaries. The expected released/held branches are conditional on input state, not a claim about native DOM/mouse aggregation.',
 commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),probeSha256:hash(fs.readFileSync(import.meta.filename)),
 sourceHashes:Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>[p,hash(fs.readFileSync(path.resolve(repo,p)))])),summary,cases};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(summary,null,2));
