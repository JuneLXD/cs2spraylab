// Actual Range and Duel entry points; no browser, game, or test runner.
// systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node native-audit/reaudit-shell-reload-trainer.mjs
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire, Module} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const here=path.dirname(fileURLToPath(import.meta.url));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:path.resolve(process.argv[i+1]);};
const repo=option('--repo',path.basename(here)==='tools'?path.dirname(here):path.join(here,'../cs2spraylab'));
const root=option('--audit-root',path.join(repo,'../native-audit'));
const out=option('--output',path.join(root,'reports/reaudit-shell-reload/trainer-current.json'));
if(path.basename(out)==='trainer-before.json'&&fs.existsSync(out))throw new Error('The retained before fixture must not be overwritten');
const require=createRequire(path.join(repo,'package.json'));
const {buildSync}=require('esbuild');
const built=buildSync({stdin:{contents:`
 export {Simulation} from './src/range/simulation';
 export {defaults,gameData} from './src/range/config';
 export {DuelSimulation} from './src/range/duel/simulation';
 export {sanitizeDuelConfig} from './src/range/duel/config';
 export {testArena} from './src/range/duel/geometry';
 `,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const compiled=new Module(path.join(repo,'.reaudit-shell-reload.cjs'));
compiled.filename=path.join(repo,'.reaudit-shell-reload.cjs');compiled.paths=Module._nodeModulePaths(repo);
compiled._compile(built.outputFiles[0].text,compiled.filename);
const {Simulation,defaults,gameData,DuelSimulation,sanitizeDuelConfig,testArena}=compiled.exports;
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes=Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>{
 const file=path.resolve(repo,p);return [path.relative(repo,file),hash(fs.readFileSync(file))];
}));
const cases=[];
for(const id of ['nova','xm1014','sawedoff','mag7']){
 const lock=gameData.weapons[id].reload;
 const edges=[['early',.05],['before-lock',lock-1/32],['just-before-lock',lock-.001],['at-lock',lock],['just-after-lock',lock+.001],['after-lock',lock+.1]];
 for(const ammo of [1,gameData.weapons[id].magazine-1])for(const [label,press]of edges)for(const held of [true,false]){
  const release=held?null:press+1/128;
  for(const engine of ['range','duel']){
   const shots=[],transitions=[],events=[];
   const sim=engine==='range'?new Simulation({...defaults,weapon:id,mode:'guided',spread:false,burst:0},()=>.5)
    :new DuelSimulation(sanitizeDuelConfig({botCount:1,roundSeconds:60}),1,testArena(),id);
   const reload=engine==='range'?sim.reloadState:sim.actors[0].weapon.reload;
   reload.ammo=ammo;
   if(engine==='range'){sim.active=true;sim.onShot=s=>shots.push({at:s.at,ammo:reload.ammo});sim.reload(false);}
   else {sim.start();sim.actors[0].yaw=Math.PI;sim.command(1,{fireHeld:false});sim.command(0,{reloadPressed:true,reloadHeld:false});sim.processInput();}
   const end=lock+1,points=new Set([0,press,...release===null?[]:[release],end]);
   for(let i=1;i/128<end;i++)points.add(i/128);
   const times=[...points].sort((a,b)=>a-b);
   let prior=null;
   function sample(edge){
    const es=engine==='range'?sim.drainActionEvents():sim.drainEvents();
    for(const e of es){if(engine==='duel'&&e.kind==='fire'&&e.actorId===0)shots.push({at:sim.time,ammo:reload.ammo});
     if(engine==='range'||e.kind==='action'&&e.actorId===0)events.push({...e,observedAt:sim.time});}
    const state={phase:reload.phase,ammo:reload.ammo,until:reload.until};
    if(edge||JSON.stringify(state)!==prior)transitions.push({at:sim.time,edge,...state});
    prior=JSON.stringify(state);
   }
   sample('reload');
   for(const at of times){
    if(at>sim.time+1e-12){if(engine==='range')sim.step(at-sim.time);else sim.step(at-sim.time,true);sample(null);}
    if(at===press){if(engine==='range')sim.pressTrigger();else{sim.command(0,{fireHeld:true,firePressed:true});sim.processInput();}sample('press');}
    if(at===release){if(engine==='range')sim.release('mouse');else{sim.command(0,{fireHeld:false});sim.processInput();}sample('release');}
   }
   cases.push({engine,weapon:id,initialAmmo:ammo,case:label,held,press,release,nativeReloadStartLock:lock,
    firstShot:shots[0]?.at??null,pressDelay:shots.length?shots[0].at-press:null,shots,transitions,events});
  }
 }
}
const report={baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),
 method:'Actual current Simulation and DuelSimulation. Reload and attack edges enter public methods. Advance on the 128 Hz grid plus exact input times. Duel step playerOnly skips bot thinking, not player weapon/movement/reload code. One passive opponent is retained; aim faces away. No native insertion or complete-reload model is asserted.',
 limits:['Synthetic loaded inventory and zero prior fire/deploy cooldown. Ordinary released reload button only.',
  'Native comparison is an instruction-bounded attack gate/cancel rule, not a live shell-reload capture.',
  'Exact command-time float snapping and held-fire tick phase require the native deadline arithmetic probe; raw vdata lock is retained separately.'],
 sourceHashes,bundleSha256:hash(built.outputFiles[0].contents),caseCount:cases.length,cases};
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({baseline:report.baseline,caseCount:cases.length,output:out,
 examples:cases.filter(c=>c.engine==='range'&&c.initialAmmo===1&&['early','after-lock'].includes(c.case)).map(({transitions,events,shots,...c})=>c)},null,2));
