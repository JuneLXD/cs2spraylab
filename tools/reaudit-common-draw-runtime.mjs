import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';

// Before loads the exact historical source through esbuild's onLoad hook;
// after loads the current application file. No hypothetical implementation.
const repo = path.resolve(import.meta.dirname,'..');
const out = path.join(repo,'docs/evidence');
const retained = path.resolve(repo,'../native-audit/reports/animation-common-draw');
fs.mkdirSync(retained,{recursive:true});
const stage = process.argv[2];
assert(['before', 'after'].includes(stage), 'Usage: reaudit-common-draw-runtime.mjs before|after');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = relative => fs.readFileSync(path.join(repo, relative));
const baselineRevision='90c756280839740754989183d034c607eda8c10d';
const baselinePath='docs/evidence/reaudit-common-draw-baseline-view-animation.txt';
const baseline=read(baselinePath);
const baselineSha256='9918b5f47f939f9fefb6f6c59307af4ae9ee62045e780213f8c0543f54e00969';
assert.equal(sha(baseline),baselineSha256,'Retained historical source changed');
assert.equal(sha(execFileSync('git',['show',`${baselineRevision}:src/range/view-animation.ts`],{cwd:repo})),baselineSha256,
  'Historical source must match the named git revision');
const actualSource=stage==='before'?baseline:read('src/range/view-animation.ts');
const ids = ['m4a4','m4a1s','glock','usp','deagle','awp'];
const targets = ids.filter(id=>id!=='awp');
const metadataPath = path.join(out, 'reaudit-common-draw-graph.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath));
const sourcePaths = ['src/range/view-animation.ts', 'src/range/animation-actions.ts',
  'src/range/native-view-actions.ts', 'src/range/engine.ts', 'src/range/duel/DuelEngine.ts'];
const sources = sourcePaths.map((p,i) => ({path:p, sha256:sha(i===0?actualSource:read(p))}));
for(const p of sourcePaths.slice(1,3))assert.equal(sha(read(p)),sha(execFileSync('git',['show',`${baselineRevision}:${p}`],{cwd:repo})),`${p} changed since baseline`);
// Other authorized input work may change a caller without changing draw. Pin
// its actual bytes across this experiment and record the historical difference.
const callerSources=sourcePaths.slice(3).map(p=>({path:p,sha256:sha(read(p)),
  historicalSha256:sha(execFileSync('git',['show',`${baselineRevision}:${p}`],{cwd:repo}))}));
assert(read('src/range/engine.ts').toString().includes("playDraw(Math.max(.01, this.sim.equipReadyAt - this.sim.time))"));
assert(read('src/range/duel/DuelEngine.ts').toString().includes('const duration = Math.max(.01, this.sim.actors[0].equipReadyAt - this.sim.time);'));
assert(read('src/range/duel/DuelEngine.ts').toString().includes('else entry.animation.playDraw(duration);'));
const require = createRequire(path.join(repo, 'package.json'));
const {build} = require('esbuild');
const bundle = path.join(retained, `common-draw-clock-${stage}-module.mjs`);
const built=await build({stdin:{contents:"export * as THREE from 'three'; export {ViewAnimation} from './src/range/view-animation';", resolveDir:repo},
  absWorkingDir:repo,bundle:true, format:'esm', platform:'node', outfile:bundle, logLevel:'silent',metafile:true,
  plugins:stage==='before'?[{name:'exact-historical-view-animation',setup(builder){
    builder.onLoad({filter:/[/\\]src[/\\]range[/\\]view-animation\.ts$/},args=>({contents:baseline.toString(),loader:'ts',resolveDir:path.dirname(args.path)}));
  }}]:[]});
const dependencies=Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>'&&p!=='src/range/view-animation.ts').sort().map(p=>({path:p,sha256:sha(read(p))}));
for(const dependency of dependencies.filter(d=>!d.path.startsWith('node_modules/')))
  assert.equal(dependency.sha256,sha(execFileSync('git',['show',`${baselineRevision}:${dependency.path}`],{cwd:repo})),`${dependency.path} changed since baseline`);
const toolchain={esbuild:require('esbuild/package.json').version,node:process.versions.node,
  lockSha256:sha(read('package-lock.json'))};
const {THREE, ViewAnimation} = await import(pathToFileURL(bundle));
const near = (actual, expected, label) => assert(Math.abs(actual-expected)<1e-9, `${label}: ${actual} != ${expected}`);

function imported(id) {
  const retained = metadata.weapons[id].import;
  const fd = fs.openSync(path.join(repo, retained.path), 'r');
  let json;
  try {
    const h = Buffer.alloc(20); fs.readSync(fd, h, 0, 20, 0);
    assert.equal(h.toString('ascii',0,4), 'glTF');
    assert.equal(h.readUInt32LE(16), 0x4e4f534a);
    const bytes = Buffer.alloc(h.readUInt32LE(12)); fs.readSync(fd, bytes, 0, bytes.length, 20);
    assert.equal(sha(bytes), retained.jsonSha256, `${id} imported JSON changed`);
    assert.equal(fs.fstatSync(fd).size, retained.bytes);
    json = JSON.parse(bytes.toString());
  } finally {fs.closeSync(fd);}
  return {path:retained.path, jsonSha256:retained.jsonSha256, bytes:retained.bytes,
    durations:Object.fromEntries(json.animations.map(a => [a.name,
      Math.max(...a.samplers.map(s => json.accessors[s.input].max?.[0] ?? 0))]))};
}
const imports = Object.fromEntries(ids.map(id => [id, imported(id)]));
const nativeReferences = Object.fromEntries(ids.map(id => {
  const graph=metadata.weapons[id];
  assert.equal(sha(read(graph.path)),graph.sha256,'Decoded graph identity changed');
  assert.equal(graph.drawClips.length,4);
  for(const clip of graph.drawClips){
    assert.equal(clip.rate,1);assert.equal(clip.connectedInputs,0);
    assert.equal(clip.syncOffset,0);assert.equal(clip.loop,false);
  }
  assert.equal(graph.compiledGraph.matchesRetainedListing,true);
  assert.equal(graph.clips.draw.matchesImportedManifest,true,'Draw import must match current package');
  for(const clip of Object.values(graph.clips))assert.equal(clip.current.matchesRetainedListing,true);
  return [id,{path:graph.path,sha256:graph.sha256,compiledGraph:graph.compiledGraph,
    clipNodes:graph.drawClips.length,authoredRate:1,completionEvents:graph.completionEvents,
    limit:'Relative clip clock while active only. Native first displayed sample, external action_idle/readiness ordering and late attachment policy remain unbound.'}];
}));

function fixture(id, distinctPickup=false) {
  const target = new THREE.Object3D(); target.name='clockProbe';
  const durations = {...imports[id].durations};
  if(distinctPickup) durations.pickup=.7;
  const names = ['idle','draw','fire','reload',...(distinctPickup?['pickup']:[])];
  const clips = names.map(name => new THREE.AnimationClip(name, durations[name], [
    new THREE.NumberKeyframeTrack('clockProbe.position[x]', [0,durations[name]], [0,name==='idle'?0:durations[name]])]));
  const view = new ViewAnimation(target, clips);
  function sample() {
    const action = view.actions.get(view.activeAction);
    return {action:view.activeAction, clock:action?.time ?? null, weight:action?.getEffectiveWeight() ?? null,
      pose:target.position.x, transient:view.transient ? {name:view.transient.name, elapsed:view.transient.elapsed,
        duration:view.transient.duration} : null};
  }
  return {view,sample,durations};
}
const rows = [], controls = [], pauseChecks = [];
const modes = [{name:'ordinary',equipment:'selected',method:'playDraw'},
  {name:'unknown-equipment',equipment:'unaudited',method:'playDraw'},
  {name:'omitted-equipment',method:'playDraw'},
  {name:'pickup-fallback',equipment:'selected',method:'playPickup'},
  {name:'distinct-pickup',equipment:'selected',method:'playPickup',distinct:true}];
for(const id of ids) {
  const deploy = metadata.weapons[id].stats.deploy;
  for(const attachmentDelay of [0,.25,.75,deploy+.1]) {
    const remaining = Math.max(.01,deploy-attachmentDelay);
    for(const mode of modes) {
      const f = fixture(id,mode.distinct);
      const equipment = mode.equipment==='selected' ? id : mode.equipment;
      const options = equipment===undefined ? {} : {equipment};
      assert(f.view[mode.method](remaining));
      let previous = 0;
      for(const fraction of [0,.1,.25,.5,.75,.9,.999999,1,1.001]) {
        const elapsed = remaining*fraction;
        f.view.update(0,1,elapsed-previous,options); previous=elapsed;
        const sample=f.sample();
        rows.push({id,mode:mode.name,attachmentDelay,remaining,fraction,elapsed,...sample,
          nativeUnitRateReference:Math.min(elapsed,f.durations.draw)});
        if(fraction===0) near(sample.clock,0,'zero onset');
        if(fraction>=1) assert.equal(sample.action,'idle','existing readiness-based lifetime');
        if(fraction<1 && mode.name==='ordinary') {
          const expected = stage==='before' && targets.includes(id) ? elapsed/remaining*f.durations.draw : Math.min(elapsed,f.durations.draw);
          near(sample.clock,expected,`${stage}/${id}/${attachmentDelay}/${fraction}`);
        }
      }
      f.view.dispose();
    }
    for(const interrupt of ['cancel','fire','reload']) {
      const f=fixture(id); f.view.playDraw(remaining);
      f.view.update(0,1,remaining*.25,{equipment:id});
      if(interrupt==='cancel') f.view.cancel();
      if(interrupt==='fire') {assert(f.view.playFire(id)); f.view.update(0,1,.1,{equipment:id});}
      if(interrupt==='reload') f.view.update(1,2,0,{equipment:id,reloadPhase:'magazine',reloadProgress:.5});
      const sample=f.sample();
      assert.equal(sample.action,interrupt==='cancel'?'idle':interrupt==='fire'?'fire':'reload');
      controls.push({id,attachmentDelay,remaining,interrupt,...sample}); f.view.dispose();
    }
    const f=fixture(id); f.view.playDraw(remaining); f.view.update(0,1,remaining*.25,{equipment:id});
    const before=f.sample(); f.view.update(0,1,0,{equipment:id}); const after=f.sample();
    assert.deepEqual(after,before,'zero-delta pause preserves all presentation state');
    pauseChecks.push({id,attachmentDelay,unchanged:true}); f.view.dispose();
  }
}
// A lifetime longer than the authored clip is a direct controller control, not
// a claim that either engine caller currently supplies such a duration.
for(const id of ids) {
  const f=fixture(id), lifetime=f.durations.draw+.25;
  f.view.playDraw(lifetime); f.view.update(0,1,f.durations.draw+.1,{equipment:id});
  const sample=f.sample();
  if(stage==='after' || id==='awp') near(sample.clock,f.durations.draw,'authored endpoint hold');
  rows.push({id,mode:'long-lifetime-control',attachmentDelay:null,remaining:lifetime,
    fraction:(f.durations.draw+.1)/lifetime,elapsed:f.durations.draw+.1,...sample,
    nativeUnitRateReference:f.durations.draw}); f.view.dispose();
}
const result = {schema:1,stage,targets,unchangedWeaponControl:'awp',method:'Actual untransformed ViewAnimation with current imported clip durations and linear tracks; synthetic delay schedules matching both real caller formulas. Numeric clock/weight/end behavior, not native live poses or absolute attachment onset.',
  probeSha256:sha(fs.readFileSync(import.meta.filename)),sources,callerSources,dependencies,toolchain,
  baseline:{revision:baselineRevision,path:baselinePath,sha256:baselineSha256},
  metadataSha256:sha(fs.readFileSync(metadataPath)),
  immediateCallerProofSha256:sha(fs.readFileSync(path.resolve(retained,'../animation-draw-shell/immediate-caller-proof.json'))),
  nativeReferences,imports,rows,controls,pauseChecks};
if(stage==='after') {
  const beforePath=path.join(out,'reaudit-common-draw-before.json');
  const before=JSON.parse(fs.readFileSync(beforePath));
  assert.equal(before.probeSha256,result.probeSha256,'Use one unchanged probe before and after');
  assert.equal(before.metadataSha256,result.metadataSha256);
  assert.deepEqual(before.dependencies,result.dependencies,'All other bundled dependencies must remain identical');
  assert.deepEqual(before.sources.slice(1),result.sources.slice(1),'Actual callers and companion sources must remain identical');
  assert.deepEqual(before.callerSources,result.callerSources);
  assert.deepEqual(before.toolchain,result.toolchain);
  assert.deepEqual(before.baseline,result.baseline);
  assert.deepEqual(before.nativeReferences,result.nativeReferences);
  assert.deepEqual(before.imports,result.imports);
  assert.deepEqual(before.controls,result.controls,'cancel/fire/reload behavior unchanged');
  assert.deepEqual(before.pauseChecks,result.pauseChecks);
  let unchangedControls=0,unchangedLifetimesAndWeights=0;
  for(let i=0;i<rows.length;i++) {
    const a=before.rows[i], b=rows[i];
    assert.equal(a.mode,b.mode); assert.equal(a.id,b.id);
    const envelope = r => ({action:r.action,weight:r.weight,transient:r.transient});
    assert.deepEqual(envelope(a),envelope(b),'Action lifetime, elapsed state and fade must remain unchanged');
    unchangedLifetimesAndWeights++;
    if(!['ordinary','long-lifetime-control'].includes(b.mode) || !targets.includes(b.id)) {
      assert.deepEqual(a,b,'Unaudited equipment, pickup and already-correct AWP controls unchanged'); unchangedControls++;
    }
  }
  const midpoints=rows.flatMap((r,i)=>r.mode==='ordinary' && r.fraction===.5 ? [{
    id:r.id,attachmentDelay:r.attachmentDelay,remaining:r.remaining,elapsed:r.elapsed,
    beforeClock:before.rows[i].clock,afterClock:r.clock,nativeUnitRateReference:r.nativeUnitRateReference,
    beforeRate:before.rows[i].clock/r.elapsed,afterRate:r.clock/r.elapsed}] : []);
  result.comparison={beforeSha256:sha(fs.readFileSync(beforePath)),beforeSourceSha256:before.sources[0].sha256,
    unchangedControls,unchangedLifetimesAndWeights,interruptControls:controls.length,pauseChecks:pauseChecks.length,midpoints};
}
fs.writeFileSync(path.join(out,`reaudit-common-draw-${stage}.json`),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({stage,sourceSha256:sources[0].sha256,rows:rows.length,controls:controls.length,
  pauseChecks:pauseChecks.length,...(result.comparison?{comparison:result.comparison}:{})},null,2));
