import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const output=path.resolve(process.argv.includes('--out') ? process.argv[process.argv.indexOf('--out')+1] : path.join(root,'../native-audit/reports/animation-timing'));
fs.mkdirSync(output,{recursive:true});
const require=createRequire(path.join(root,'package.json'));
const {build}=require('esbuild');
const outfile=path.join(output,'runtime-clock-module.mjs');
await build({stdin:{contents:`export * as THREE from 'three'; export {ViewAnimation} from './src/range/view-animation'; export {NativeReloadState} from './src/range/weapon-actions';`,resolveDir:root},bundle:true,format:'esm',platform:'node',outfile,logLevel:'silent'});
const {THREE,ViewAnimation,NativeReloadState}=await import(pathToFileURL(outfile));
const metadata=JSON.parse(fs.readFileSync(path.join(output,'metadata-results.json')));
function fixture(id) {
 const target=new THREE.Object3D(); target.name='clockProbe';
 const durations=Object.fromEntries(metadata.weapons[id].import.animations.map(a=>[a.name,Math.max(...a.inputs.map(i=>i.max?.[0]??0))]));
 const clips=['idle','draw','fire','reload'].map(name=>new THREE.AnimationClip(name,durations[name],[new THREE.NumberKeyframeTrack('clockProbe.position[x]',[0,durations[name]],[0,name==='idle'?0:durations[name]])]));
 const view=new ViewAnimation(target,clips);
 const sample=()=>({action:view.activeAction,clock:view.actions.get(view.activeAction)?.time,weight:view.actions.get(view.activeAction)?.getEffectiveWeight(),pose:target.position.x});
 return {view,durations,sample};
}
const rows=[];
for(const id of Object.keys(metadata.weapons)) {
 const w=metadata.weapons[id];
 const fire=fixture(id); fire.view.playFire(id); let previous=0;
 for(const at of [.1,.233333333333,.3,.6].filter(t=>t<fire.durations.fire-.08)) {
  fire.view.update(0,1,at-previous); previous=at;
  rows.push({id,kind:'fire',elapsed:at,...fire.sample(),expectedOneRate:at});
 }
 fire.view.dispose();
 for(const loadDelay of [0,.25,.75,1.5]) {
  const f=fixture(id), remaining=Math.max(.01,w.stats.deploy-loadDelay), sampleAt=remaining*.5;
  f.view.playDraw(remaining);f.view.update(0,1,sampleAt);
  rows.push({id,kind:'draw',loadDelay,remaining,elapsedSinceAttach:sampleAt,...f.sample(),rate:f.durations.draw/remaining,authoredOneRateReferenceAtSameEquipAge:Math.min(f.durations.draw,loadDelay+sampleAt)});
  f.view.dispose();
 }
 const state=new NativeReloadState(id); state.ammo=Math.max(1,state.stats.magazine-2);state.start(0,false);
 const f=fixture(id);let time=0,prior=0;
 while(state.active && time<5) {
  const phase=state.phase,start=time,duration=state.phaseDuration;
  for(const fraction of [.25,.5,.75]) {
   time=start+duration*fraction; state.advance(time,false);
   f.view.update(state.until-time,state.phaseDuration,time-prior,{equipment:id,reloadPhase:state.phase,reloadProgress:state.progress}); prior=time;
   rows.push({id,kind:'reload',phase,time,duration,progress:state.progress,work:state.clock.position,ammo:state.ammo,...f.sample()});
  }
  time=start+duration;state.advance(time,false);
 }
 f.view.dispose();
 // Measure visual pose's authored insertion instant against controller ammo event.
 if(id==='ak47'||id==='awp') {
  const insert=metadata.weapons[id].events.reload.doc.m_eventTracks.flatMap(t=>t.m_events).find(e=>e.m_ID==='WPN_RELOAD_ADD_AMMO').m_flStartTime/30;
  const s=new NativeReloadState(id);s.ammo=1;s.start(0,false);s.advance(insert,false);
  const v=fixture(id);v.view.update(s.until-insert,s.phaseDuration,insert,{equipment:id,reloadPhase:s.phase,reloadProgress:s.progress});
  rows.push({id,kind:'ammo-event',gameplayInsert:insert,ammo:s.ammo,authoredInsert:insert,...v.sample(),visualInsertWallTime:insert*s.phaseDuration/v.durations.reload});v.view.dispose();
 }
}
const files=['src/range/view-animation.ts','src/range/weapon-actions.ts','src/range/reload-clock.ts','src/range/native-view-actions.ts','src/range/native-reload-presentation.json','src/range/native-reload-timing.json','src/range/engine.ts','src/range/duel/DuelEngine.ts','src/range/sound-model.ts'];
const sources=files.map(p=>({path:p,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')}));
const fireRows=rows.filter(r=>r.kind==='fire');
const maxFireClockError=Math.max(...fireRows.map(r=>Math.abs(r.clock-r.expectedOneRate)));
assert(maxFireClockError < 1e-12, 'Fire playback no longer preserves the authored clip clock');
const manifestRows=Object.values(metadata.weapons).flatMap(w=>Object.values(w.clips));
assert(manifestRows.length===20 && manifestRows.every(c=>c.matchesCurrentManifest), 'Current native clip manifest differs from imported inventory');
const result={schema:1,checks:{fireSamples:fireRows.length,maxFireClockError,currentManifestMatches:manifestRows.length},method:'Actual ViewAnimation and NativeReloadState with linear clock tracks and measured imported GLB duration. Tests trainer clock only, not native live graph execution or full skeleton poses.',sources,rows};
fs.writeFileSync(path.join(output,'runtime-clock-results.json'),JSON.stringify(result,null,2)+'\n');
for(const row of rows)if(row.kind==='ammo-event'||row.kind==='draw'&&row.loadDelay===.25||row.kind==='reload'&&Math.abs(row.progress-.5)<1e-8||row.kind==='fire')console.log(JSON.stringify(row));
