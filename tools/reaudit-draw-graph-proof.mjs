import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Fresh parse of retained decoded resources. This neither extracts packages nor
// executes native code. Compiled-resource provenance remains pass29's boundary.
const repo=path.resolve(import.meta.dirname,'..');
const out=path.join(repo,'docs/evidence');
const nativeTiming=path.resolve(repo,'../native-audit/reports/animation-timing');
const {parseKv3}=await import(pathToFileURL(path.join(repo,'tools/kv3.mjs')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ids=['ak47','awp','nova','xm1014'];
const weapons={};
for(const id of ids) {
  const retainedPath=path.join(nativeTiming,`${id}-graph.json`);
  const retained=JSON.parse(fs.readFileSync(retainedPath));
  const bytes=fs.readFileSync(path.join(repo,retained.path));
  assert.equal(sha(bytes),retained.sha256);
  const doc=parseKv3(bytes.toString()), nodes=[], edges=[];
  function walk(v,chain=[]) {
    if(!v||typeof v!=='object')return;
    if(Array.isArray(v)){for(const child of v)walk(child,chain);return;}
    const state=/State(Node|MachineNode)$/.test(v._class??'')&&v.m_name;
    const next=state?[...chain,v.m_name]:chain;
    if(v.m_ID&&v._class?.endsWith('Node'))nodes.push({doc:v,path:next.join('/')});
    if(v.m_connections)edges.push(...v.m_connections);
    for(const [k,child] of Object.entries(v))if(k!=='m_connections')walk(child,next);
  }
  walk(doc);
  const byId=new Map(nodes.map(n=>[n.doc.m_ID,n]));
  function inputTree(n,depth=0) {
    assert(depth<12);
    const v=n.doc;
    const keep=['_class','m_name','m_comparison','m_values','m_parameterID'];
    return {...Object.fromEntries(keep.filter(k=>k in v).map(k=>[k,v[k]])),
      inputs:edges.filter(e=>e.m_toNodeID===v.m_ID).map(e=>inputTree(byId.get(e.m_fromNodeID),depth+1))};
  }
  function global(name) {
    const matches=nodes.filter(n=>n.path==='actions/Actions/SM'&&n.doc._class==='CNmGraphDocGlobalTransitionNode'&&n.doc.m_name===name);
    assert.equal(matches.length,1);
    return matches[0];
  }
  const entry=global('Deploying'),exit=global('Idle');
  for(const [n,duration] of [[entry,0],[exit,.2]]) {
    assert.equal(n.doc.m_flDurationSeconds,duration);
    assert.equal(n.doc.m_timeMatchMode,'None');
    assert.equal(n.doc.m_flTimeOffset,0);
    assert.equal(n.doc.m_bClampDurationToSource,false);
    const predicate=inputTree(n).inputs;
    assert.equal(predicate.length,1);
    assert.equal(predicate[0]._class,'CNmGraphDocAndNode');
    assert(predicate[0].inputs.some(p=>p.m_name==='weapon_is_gun'));
    const comparison=predicate[0].inputs.find(p=>p._class==='CNmGraphDocIDComparisonNode');
    assert.equal(comparison.m_comparison,'Matches');
    assert.deepEqual(comparison.m_values,n===entry?['action_deploy']:['action_idle','']);
    assert.equal(comparison.inputs.length,1);
    assert.equal(comparison.inputs[0].m_name,'action');
  }
  const state=byId.get(entry.doc.m_stateID).doc;
  assert.equal(state.m_name,'Deploying');
  assert.deepEqual(state.m_timedStateEvents,[{m_ID:'WPN_ACTION_COMPLETE',m_type:'TimeRemaining',
    m_comparisonOperator:'LessThanEqual',m_flTimeValueSeconds:.1}]);
  const clipNodes=nodes.filter(n=>n.path.includes('/Deploying/')&&n.doc._class==='CNmGraphDocClipNode');
  assert.equal(clipNodes.length,4);
  for(const {doc:v} of clipNodes) {
    assert.equal(v.m_pDefaultVariationData.m_flSpeedMultiplier,1);
    assert.equal(v.m_pDefaultVariationData.m_nStartSyncEventOffset,0);
    assert.equal(v.m_bAllowLooping,false);
    assert.equal(edges.filter(e=>e.m_toNodeID===v.m_ID).length,0);
  }
  const resetNodes=nodes.filter(n=>n.path.startsWith('actions/Actions/SM/Deploying')&&
    n.doc._class.endsWith('TransitionNode')&&['Deploy0','Deploy2'].includes(n.doc.m_name));
  assert.equal(resetNodes.length,2);
  for(const {doc:v} of resetNodes) {
    assert.equal(v.m_flDurationSeconds,0);assert.equal(v.m_timeMatchMode,'None');assert.equal(v.m_flTimeOffset,0);
  }
  assert(!/weapon_action_speedscale|TimeScale|SpeedScale|playback/.test(bytes.toString()));
  const transition=n=>({duration:n.doc.m_flDurationSeconds,timeMatch:n.doc.m_timeMatchMode,
    timeOffset:n.doc.m_flTimeOffset,clampToSource:n.doc.m_bClampDurationToSource,condition:inputTree(n).inputs[0]});
  weapons[id]={path:retained.path,sha256:sha(bytes),nodes:nodes.length,
    entry:transition(entry),idleExit:transition(exit),completionEvents:state.m_timedStateEvents,
    drawClips:clipNodes.map(({doc:v})=>({name:v.m_name,clip:v.m_pDefaultVariationData.m_clip,
      rate:v.m_pDefaultVariationData.m_flSpeedMultiplier,syncOffset:v.m_pDefaultVariationData.m_nStartSyncEventOffset,
      loop:v.m_bAllowLooping,connectedInputs:0})),
    resetTransitions:resetNodes.map(n=>({name:n.doc.m_name,...transition(n)})),
    genericSpeedParameterDeclared:false};
}
const result={schema:1,scope:'Ordinary AK/AWP/Nova/XM draw relative rate and graph entry/exit conditions',
  parser:{path:'tools/kv3.mjs',sha256:sha(fs.readFileSync(path.join(repo,'tools/kv3.mjs')))},
  probeSha256:sha(fs.readFileSync(import.meta.filename)),weapons,
  conclusion:'All four graphs use unit-speed, unconnected, non-looping ordinary draw clips. Entry/reset has zero duration and no time match. Global idle requires external action_idle or empty action and uses a 200 ms transition. Deploying emits action complete with at most 100 ms of state time remaining.',
  boundaries:['The completion event is a graph event, not a proved gameplay readiness deadline or proved immediate exit.',
    'The external action_idle writer and event-consumer ordering remain unbound; no always-finish, cancel-at-readiness or seek-on-attachment behavior is certified.',
    'The proposed rate-only correction preserves the trainer onset, readiness-based lifetime and fade approximations.',
    'Pickup reuse in the trainer does not independently bind native pickup to action_deploy; keep pickup behavior unchanged.',
    'Decoded exports retain pass29 current compiled CRC/size corroboration; this is a fresh parser execution, not a fresh package extraction.']};
fs.writeFileSync(path.join(out,'reaudit-draw-graph-proof.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({weapons:ids,clipNodes:16,entrySeconds:0,idleExitSeconds:.2,completeTimeRemaining:.1}));
