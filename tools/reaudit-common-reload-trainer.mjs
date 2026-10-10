// Measure common-weapon reload readiness through actual Range and Duel entry points.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire, Module} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:path.resolve(process.argv[i+1]);};
const repo=option('--repo',path.join(here,'..'));
const output=option('--output',path.resolve(repo,'../native-audit/reports/reaudit-common-reload/trainer-current.json'));
if(fs.existsSync(output))throw new Error(`Refuse to overwrite retained run: ${output}`);
const require=createRequire(path.join(repo,'package.json'));
const {buildSync}=require('esbuild');
const built=buildSync({stdin:{contents:`
export {Simulation} from './src/range/simulation';
export {defaults,gameData} from './src/range/config';
export {DuelSimulation} from './src/range/duel/simulation';
export {sanitizeDuelConfig} from './src/range/duel/config';
export {testArena} from './src/range/duel/geometry';
`,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const compiled=new Module(path.join(repo,'.reaudit-common-reload.cjs'));
compiled.filename=path.join(repo,'.reaudit-common-reload.cjs');compiled.paths=Module._nodeModulePaths(repo);
compiled._compile(built.outputFiles[0].text,compiled.filename);
const {Simulation,defaults,gameData,DuelSimulation,sanitizeDuelConfig,testArena}=compiled.exports;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const cases=[];
for(const weapon of ['ak47','m4a4','m4a1s','awp','glock','usp','deagle'])for(const scenario of ['early-tap','early-held','ready-tap','ready-held'])for(const engine of ['range','duel']){
 const sim=engine==='range'?new Simulation({...defaults,weapon,mode:'guided',spread:false,burst:0},()=>.5)
  :new DuelSimulation(sanitizeDuelConfig({botCount:1,roundSeconds:60}),1,testArena(),weapon);
 const reload=engine==='range'?sim.reloadState:sim.actors[0].weapon.reload;
 const actions=engine==='range'?sim.actions:sim.actors[0].weapon.actions;
 const cycle=actions.stats.cycle;
 const early=scenario.startsWith('early');
 const requestAt=early?1/32:Math.ceil(cycle*128)/128;
 const held=scenario.endsWith('held');
 const releaseAt=held?requestAt+2:requestAt+1/64;
 const shots=[],events=[],states=[];
 if(engine==='range'){sim.active=true;sim.onShot=shot=>shots.push({at:shot.at,ammo:reload.ammo});}
 else{sim.start();sim.actors[0].yaw=Math.PI;sim.command(1,{fireHeld:false});}
 let last='';
 function sample(edge){
  for(const event of engine==='range'?sim.drainActionEvents():sim.drainEvents()){
   if(engine==='duel'&&event.kind==='fire'&&event.actorId===0)shots.push({at:sim.time,ammo:reload.ammo});
   if(engine==='range'||event.kind==='action'&&event.actorId===0)events.push({...event,observedAt:sim.time});
  }
  const state={ammo:reload.ammo,reserve:reload.reserve,phase:reload.phase};
  const key=JSON.stringify(state);
  if(edge||key!==last)states.push({at:sim.time,edge,...state});
  last=key;
 }
 sample('initial');
 for(let tick=0;tick<=8*128;tick++){
  const at=tick/128;
  if(tick){if(engine==='range')sim.step(1/128);else sim.step(1/128,true);sample();}
  const edge=at===0?'fire-down':at===1/128?'fire-up':at===requestAt?'reload-down':at===releaseAt?'reload-up':undefined;
  if(edge){
   if(engine==='range'){
    if(edge==='fire-down')sim.pressTrigger();
    else if(edge==='fire-up')sim.release('mouse');
    else {sim.reloadHeld=edge==='reload-down';if(sim.reloadHeld)sim.reload(true);}
   }else{
    sim.command(0,edge==='fire-down'?{fireHeld:true,firePressed:true}:edge==='fire-up'?{fireHeld:false}:
      {reloadHeld:edge==='reload-down',reloadPressed:edge==='reload-down'});
    sim.processInput();
   }
   sample(edge);
  }
 }
 const starts=events.filter(e=>e.kind==='reload-start'||e.action==='reload-start');
 cases.push({engine,weapon,scenario,cycle,requestAt,releaseAt,
  firstReloadObserved:starts[0]?.observedAt??null,firstAmmoGain:states.find((s,i)=>i&&s.ammo>states[i-1].ammo)?.at??null,
  shots,states,events});
}
const sourceHashes=Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>[p,hash(fs.readFileSync(path.resolve(repo,p)))]));
const report={baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
 method:'Actual Range/Duel simulations with browser-equivalent public input/reload calls and 128 Hz steps; synthetic initial inventory only. Eight seconds per case, player-only Duel steps, passive opponent, aim away.',
 limits:['Observed engine event time is separate from native player-clock scheduling.','Unmeasured native cases are coverage controls, not correctness assertions.','R8 is excluded.'],
 scriptSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),bundleSha256:hash(built.outputFiles[0].contents),sourceHashes,cases};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,cases:cases.length,early:cases.filter(c=>c.scenario==='early-tap').map(c=>({engine:c.engine,weapon:c.weapon,cycle:c.cycle,reload:c.firstReloadObserved}))}));
