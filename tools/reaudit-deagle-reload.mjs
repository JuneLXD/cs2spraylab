// Actual reload-clock and sound-timeline consumers; retain before/after reports.
import fs from 'node:fs';
import path from 'node:path';
import {createRequire, Module} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:path.resolve(process.argv[i+1]);};
const repo=option('--repo',path.join(here,'..'));
const output=option('--output',path.resolve(repo,'../reports/deagle-reload-next/trainer-current.json'));
if(fs.existsSync(output))throw Error('Refuse to overwrite '+output);
const require=createRequire(path.join(repo,'package.json'));
const {buildSync}=require('esbuild');
const hash=b=>createHash('sha256').update(b).digest('hex');
const built=buildSync({stdin:{contents:`export {NativeReloadState} from './src/range/weapon-actions';export {ActionSoundTimeline,nativeSoundTimelines} from './src/range/sound-model';`,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const compiled=new Module(path.join(repo,'.deagle-reload-probe.cjs'));
compiled.filename=path.join(repo,'.deagle-reload-probe.cjs');compiled.paths=Module._nodeModulePaths(repo);
compiled._compile(built.outputFiles[0].text,compiled.filename);
const {NativeReloadState,ActionSoundTimeline,nativeSoundTimelines}=compiled.exports;
const manifestBytes=fs.readFileSync(path.join(repo,'public/revamp/audio/events.json'));
const manifest=JSON.parse(manifestBytes),cases=[];
for(const weapon of ['ak47','m4a4','m4a1s','awp','glock','usp','deagle'])for(const empty of [false,true])for(const mode of ['normal','held','released'])for(const source of ['hearing','browser']){
 const reload=new NativeReloadState(weapon);reload.ammo=empty?0:reload.stats.magazine-1;
 const sound=new ActionSoundTimeline(source==='hearing'?nativeSoundTimelines:manifest.timelines);
 reload.start(0,mode!=='normal');const cues=[],events=[],states=[];let last='';
 for(let i=0;i<=8*960;i++){
  const now=i/960;
  reload.advance(now,mode==='held'||mode==='released'&&now<.5);
  const actor={id:0,equipment:weapon,alive:true,local:true,reloading:reload.active,silent:reload.silent,reloadEmpty:reload.empty,reloadPhase:reload.phase,reloadDuration:reload.phaseDuration,reloadProgress:reload.progress,actionId:1};
  sound.sync(actor,now);
  cues.push(...sound.update(now).map(c=>({observedAt:now,key:c.key,source:manifest.events[c.key]?.source,time:c.time})));
  events.push(...reload.drainActionEvents());
  const state={active:reload.active,ammo:reload.ammo,reserve:reload.reserve,silent:reload.silent};
  const key=JSON.stringify(state);if(key!==last)states.push({observedAt:now,...state});last=key;
  if(!reload.active)break;
 }
 cases.push({weapon,empty,mode,source,cues,events,states});
}
const sourceHashes=Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>[p,hash(fs.readFileSync(path.resolve(repo,p)))]));
const result={schema:1,method:'Actual NativeReloadState plus ActionSoundTimeline, using either shipped browser manifest or compiled hearing metadata, sampled at 960 Hz. No native runtime or audio-device timing is inferred.',probeSha256:hash(fs.readFileSync(fileURLToPath(import.meta.url))),bundleSha256:hash(built.outputFiles[0].contents),sourceHashes,manifestSha256:hash(manifestBytes),cases};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({output,cases:cases.length,deagle:cases.filter(c=>c.weapon==='deagle'&&c.source==='browser').map(c=>({empty:c.empty,mode:c.mode,cues:c.cues.map(x=>[x.source,x.observedAt]),events:c.events.map(e=>[e.kind,e.at,e.silent])}))},null,2));
