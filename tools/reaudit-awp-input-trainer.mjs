// Actual simulations and actual engine repeatZoom methods, without constructing a renderer.
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
const built=buildSync({stdin:{contents:`export {Simulation} from './src/range/simulation';export {defaults} from './src/range/config';export {DuelSimulation} from './src/range/duel/simulation';export {sanitizeDuelConfig} from './src/range/duel/config';export {testArena} from './src/range/duel/geometry';export {RangeEngine} from './src/range/engine';export {DuelEngine} from './src/range/duel/DuelEngine';`,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const mod=new Module(path.join(repo,'.awp-input-probe.cjs'));mod.filename=path.join(repo,'.awp-input-probe.cjs');mod.paths=Module._nodeModulePaths(repo);mod._compile(built.outputFiles[0].text,mod.filename);
const {Simulation,defaults,DuelSimulation,sanitizeDuelConfig,testArena,RangeEngine,DuelEngine}=mod.exports;
const e=(at,kind)=>({at,kind});
const fixtures=[
 ...[0,1,2].map(zoom=>({name:`atomic-both-zoom-${zoom}`,engine:'duel',zoom,events:[e(1,'both-down'),e(1.05,'both-up')]})),
 ...[1,2].map(zoom=>({name:`held-primary-secondary-tap-zoom-${zoom}`,zoom,events:[e(1,'primary-down'),e(2.6,'secondary-down'),e(2.61,'secondary-up'),e(2.8,'primary-up')]})),
 ...[false,true].flatMap(repeat=>[false,true].map(holdPrimary=>({name:`repeat-${repeat}-primary-${holdPrimary?'held':'released'}`,zoom:1,repeat,events:[e(1,'primary-down'),...(!holdPrimary?[e(1.005,'primary-up')]:[]),e(1.03,'secondary-down'),...(holdPrimary?[e(3,'primary-up')]:[]),e(3.2,'secondary-up')]}))),
 {name:'secondary-only',zoom:0,events:[e(1,'secondary-down'),e(1.01,'secondary-up')]},
 {name:'primary-only',zoom:1,events:[e(1,'primary-down'),e(1.01,'primary-up')]},
 {name:'scope-then-fire-ordered',zoom:0,events:[e(1,'secondary-down'),e(1,'secondary-up'),e(1,'primary-down'),e(1.01,'primary-up')]},
 {name:'fire-then-scope-ordered',zoom:0,events:[e(1,'primary-down'),e(1,'primary-up'),e(1,'secondary-down'),e(1.01,'secondary-up')]},
];
const rows=[];
for(const fixture of fixtures)for(const engine of fixture.engine?[fixture.engine]:['range','duel']){
 const range=engine==='range', settings={...defaults,weapon:'awp',mode:'guided',spread:false,burst:0,keyboard:{...defaults.keyboard,zoomRepeat:!!fixture.repeat}};
 const sim=range?new Simulation(settings,()=>.5):new DuelSimulation(sanitizeDuelConfig({botCount:1,roundSeconds:60}),1,testArena(),'awp');
 const state=range?sim:sim.actors[0].weapon,actions=state.actions,shots=[],trace=[];
 if(range)sim.active=true;else{sim.start();sim.actors[0].yaw=Math.PI;sim.command(1,{fireHeld:false});}
 let primaryHeld=false,secondaryHeld=false,last='',nextFrame=1/120;
 const host={sim,settings,paused:false,binds:{isHeld:key=>key==='attack2'?secondaryHeld:primaryHeld},audio:{playScope:()=>{}},secondary:RangeEngine.prototype.secondary};
 const after=actions.afterShot;actions.afterShot=function(time,scheduledAt,left){shots.push({processedAt:time,scheduledAt,zoomBefore:this.zoom});return after.call(this,time,scheduledAt,left);};
 const snapshot=()=>({zoom:actions.zoom,savedZoom:actions.resumeZoom,pending:actions.pendingZoom,fov:actions.fovAt(sim.time),secondaryReadyAt:actions.secondaryReadyAt,primaryReadyAt:range?sim.shotReady.get('awp')??0:state.nextShotAt,ammo:range?sim.loadedAmmo:state.ammo,primaryHeld,secondaryHeld});
 function sample(edge){if(!range)sim.drainEvents();const v=snapshot(),s=JSON.stringify(v);if(edge||s!==last)trace.push({at:sim.time,...(edge?{edge}:{}),...v});last=s;}
 function advance(to){let guard=0;while(sim.time<to-1e-10){if(++guard>10000)throw Error('Advance failed');const dt=Math.min(sim.untilEvent(),to-sim.time,nextFrame-sim.time);if(dt>1e-10){if(range)sim.step(dt);else sim.step(dt,true);}if(sim.time>=nextFrame-1e-10){(range?RangeEngine:DuelEngine).prototype.repeatZoom.call(host);nextFrame+=1/120;}sample();}}
 function input(kind){
   if(kind==='both-down'){primaryHeld=secondaryHeld=true;sim.command(0,{fireHeld:true,firePressed:true,secondaryHeld:true,secondaryPressed:true});sim.processInput();}
   else if(kind==='both-up'){primaryHeld=secondaryHeld=false;sim.command(0,{fireHeld:false,secondaryHeld:false});sim.processInput();}
   else if(kind.startsWith('primary-')){primaryHeld=kind==='primary-down';if(range){if(primaryHeld)sim.pressTrigger();else sim.release('mouse');}else{sim.command(0,{fireHeld:primaryHeld,firePressed:primaryHeld});sim.processInput();}}
   else {secondaryHeld=kind==='secondary-down';if(range){sim.secondaryHeld=secondaryHeld;if(secondaryHeld)RangeEngine.prototype.secondary.call(host,true);}else{sim.command(0,{secondaryHeld,secondaryPressed:secondaryHeld});sim.processInput();}}
   sample(kind);
 }
 sample('initial');
 if(fixture.zoom){advance(.4);input('secondary-down');input('secondary-up');}
 if(fixture.zoom===2){advance(.7);input('secondary-down');input('secondary-up');}
 for(const edge of fixture.events){advance(edge.at);input(edge.kind);}
 advance(3.5);rows.push({engine,scenario:fixture.name,shots,trace});
}
const hash=x=>createHash('sha256').update(x).digest('hex');
const report={method:'Actual Range/Duel simulations plus unmodified engine repeatZoom/Range secondary methods. Minimal host supplies settings, held-bind reads and a no-op audio sink; no renderer construction. Synthetic120Hz frame callbacks, production untilEvent boundaries and exact input edges. Duel repeatZoom queues an edge for the next simulation call, as its engine does. Atomic both-button fixtures are Duel-only; ordered Range DOM-equivalent edges are not called an atomic native command. No native execution or physical input timing.',commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),trackedChanges:execFileSync('git',['diff','--name-only'],{cwd:repo,encoding:'utf8'}).trim().split('\n').filter(Boolean),probeSha256:hash(fs.readFileSync(import.meta.filename)),bundleSha256:hash(built.outputFiles[0].contents),sourceHashes:Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>[p,hash(fs.readFileSync(path.resolve(repo,p)))])),fixtures,rows};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,cases:rows.length,atomic:rows.filter(r=>r.scenario.startsWith('atomic')).map(r=>({scenario:r.scenario,shots:r.shots}))},null,2));
