// Observe actual AWP shot arguments, attack deadlines and scope transitions.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire, Module} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2), option=n=>args[args.indexOf(n)+1];
if(!args.includes('--repo')||!args.includes('--output'))throw Error('Use --repo PATH --output NEW.json');
const repo=path.resolve(option('--repo')),output=path.resolve(option('--output'));
if(fs.existsSync(output))throw Error('Refusing to overwrite evidence');
const require=createRequire(path.join(repo,'package.json')),{buildSync}=require('esbuild');
const built=buildSync({stdin:{contents:`export {Simulation} from './src/range/simulation'; export {defaults,gameData} from './src/range/config'; export {DuelSimulation} from './src/range/duel/simulation'; export {sanitizeDuelConfig} from './src/range/duel/config'; export {testArena} from './src/range/duel/geometry';`,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const mod=new Module(path.join(repo,'.awp-clock-probe.cjs'));mod.filename=path.join(repo,'.awp-clock-probe.cjs');mod.paths=Module._nodeModulePaths(repo);mod._compile(built.outputFiles[0].text,mod.filename);
const {Simulation,defaults,gameData,DuelSimulation,sanitizeDuelConfig,testArena}=mod.exports;
const first=1.003,cycle=gameData.weapons.awp.cycle,ready=first+cycle;
const edge=(at,kind)=>({at,kind});
const shot=[edge(first,'fire-down'),edge(first+.002,'fire-up')];
const scope=[edge(.5,'secondary')],deeper=[...scope,edge(.85,'secondary')];
const cases=[
 {name:'unscoped-single',events:shot},
 {name:'settled-single',events:[...scope,...shot]},
 {name:'quick-scope-single',events:[edge(1,'secondary'),...shot]},
 {name:'second-level-single',events:[...deeper,...shot]},
 ...[scope,deeper].map((zoom,i)=>({name:`level-${i+1}-early-held`,events:[...zoom,...shot,edge(ready-.02,'fire-down'),edge(ready+.07,'fire-up')]})),
 {name:'late-rescope-update',events:[...scope,...shot,{at:ready+.025,kind:'sample',singleStep:true}]},
 {name:'last-round-no-reserve',lastRound:true,events:[...scope,...shot]},
 {name:'exact-ready-tap',events:[...scope,...shot,edge(ready,'fire-down'),edge(ready+.002,'fire-up')]},
 {name:'late-held-update',events:[...scope,...shot,edge(ready-.02,'fire-down'),{at:ready+.042,kind:'sample',singleStep:true},edge(ready+.05,'fire-up')]},
];
const rows=[];
for(const fixture of cases)for(const engine of ['range','duel']){
 const range=engine==='range';
 const sim=range?new Simulation({...defaults,weapon:'awp',mode:'guided',spread:false,burst:0},()=>.5):new DuelSimulation(sanitizeDuelConfig({botCount:1,roundSeconds:60}),1,testArena(),'awp');
 const state=range?sim:sim.actors[0].weapon, actions=state.actions;
 if(fixture.lastRound){const reload=range?sim.reloadState:state.reload;reload.ammo=1;reload.reserve=0;}
 if(range)sim.active=true;else{sim.start();sim.actors[0].yaw=Math.PI;sim.command(1,{fireHeld:false});}
 const trace=[],shots=[];let previous='';
 const snapshot=()=>({zoom:actions.zoom,fov:actions.fovAt(sim.time),primary:range?sim.shotReady.get('awp')??0:state.nextShotAt,secondary:actions.secondaryReadyAt,resumeAt:Number.isFinite(actions.nextEventAt)?actions.nextEventAt:null,pendingZoom:actions.pendingZoom,ammo:range?sim.loadedAmmo:state.ammo});
 const after=actions.afterShot;
 actions.afterShot=function(processedAt,scheduledAt,pending){const before=snapshot();const result=after.call(this,processedAt,scheduledAt,pending);shots.push({processedAt,scheduledAt,processingDelay:processedAt-scheduledAt,passedBurstCount:pending,before,after:snapshot()});return result;};
 if(range)sim.onShot=event=>Object.assign(shots.at(-1),{callbackAt:event.at,lastShotAt:sim.lastShotAt});
 function sample(edge){if(!range)sim.drainEvents();const value=snapshot(),serialized=JSON.stringify(value);if(edge||serialized!==previous)trace.push({at:sim.time,...(edge?{edge}:{}),...value});previous=serialized;}
 function advance(at,singleStep=false){let steps=0;while(sim.time<at-1e-10){if(++steps>10000)throw Error('Advance did not converge');const dt=singleStep?at-sim.time:Math.min(sim.untilEvent(),at-sim.time);if(!(dt>0))throw Error('Invalid production event duration');if(range)sim.step(dt);else sim.step(dt,true);sample();}}
 sample('initial');
 for(const event of fixture.events){advance(event.at,event.singleStep);if(event.kind==='secondary'){if(range)sim.secondary();else{sim.command(0,{secondaryPressed:true});sim.processInput();}}else if(event.kind.startsWith('fire-')){const down=event.kind==='fire-down';if(range){if(down)sim.pressTrigger();else sim.release('mouse');}else{sim.command(0,{firePressed:down,fireHeld:down});sim.processInput();}}sample(event.kind);}
 advance(4.25);rows.push({scenario:fixture.name,engine,shots,trace});
}
const hash=b=>createHash('sha256').update(b).digest('hex');
const report={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),trackedChanges:execFileSync('git',['diff','--name-only'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean),probeSha256:hash(fs.readFileSync(import.meta.filename)),bundleSha256:hash(built.outputFiles[0].contents),sourceHashes:Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>[p,hash(fs.readFileSync(path.resolve(repo,p)))])),method:'Actual Range/Duel simulations. Wrapped afterShot forwards unchanged arguments and records processing and scheduled times separately; Range lastShotAt independently checks schedule. Each production untilEvent() selects the actual global128Hz/action boundary, with partial input edges, except one declared late-update fixture. Actual secondary and primary input entry points; no native execution.',cycle,fixtures:cases,rows};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,cycle,cases:rows.length,delayedShots:rows.flatMap(r=>r.shots.map(s=>({scenario:r.scenario,engine:r.engine,...s}))).filter(s=>s.processingDelay>1e-9).map(s=>({scenario:s.scenario,engine:s.engine,processedAt:s.processedAt,scheduledAt:s.scheduledAt,delayMs:s.processingDelay*1000,secondary:s.after.secondary,resumeAt:s.after.resumeAt}))},null,2));
