import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';

// Fresh parse of retained decoded resources. This neither extracts packages nor
// executes native code. Compiled-resource provenance remains pass29's boundary.
const repo=path.resolve(import.meta.dirname,'..');
const out=path.join(repo,'docs/evidence');
const read=p=>fs.readFileSync(path.join(repo,p));
const sourceInfo=p=>({path:p,sha256:sha(read(p))});
const {parseKv3}=await import(pathToFileURL(path.join(repo,'tools/kv3.mjs')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const ids=['m4a4','m4a1s','glock','usp','deagle','awp'];
const provenancePath='research/reaudit-animation/provenance.json';
const provenance=JSON.parse(read(provenancePath));
const listingPath='research/reaudit-animation/listing.txt';
const listing=read(listingPath).toString();
assert.equal(sha(listing),provenance.listingHash);
const listingEntries=new Map([...listing.matchAll(/^(.+?) CRC:(\w+) size:(\d+)\s*$/gm)]
  .map(m=>[m[1],{crc:parseInt(m[2],16),bytes:Number(m[3])}]));
const retainedGraphsPath='tools/reaudit-animation-graph-results.json';
const retainedGraphs=JSON.parse(read(retainedGraphsPath)).graphs;
const inventoryPath='docs/weapon-animation-inventory.json';
const inventory=JSON.parse(read(inventoryPath)).weapons;
const statsPath='src/range/game-data.json';
const stats=JSON.parse(read(statsPath)).weapons;
const vpkPath=path.resolve(repo,'../cs2-game/game/csgo/pak01_dir.vpk');
const directory=fs.readFileSync(vpkPath);
assert.equal(directory.readUInt32LE(0),0x55aa1234);
const version=directory.readUInt32LE(4);
assert([1,2].includes(version));
const header=version===2?28:12,treeSize=directory.readUInt32LE(8);
let cursor=header;
function token(){const end=directory.indexOf(0,cursor);assert(end>=cursor&&end<header+treeSize);
  const value=directory.toString('utf8',cursor,end);cursor=end+1;return value;}
const currentEntries=new Map();
for(let ext=token();ext;ext=token())for(let folder=token();folder;folder=token())for(let name=token();name;name=token()){
  assert(cursor+18<=header+treeSize);
  const crc=directory.readUInt32LE(cursor),preload=directory.readUInt16LE(cursor+4),
    archive=directory.readUInt16LE(cursor+6),offset=directory.readUInt32LE(cursor+8),
    length=directory.readUInt32LE(cursor+12);
  assert.equal(directory.readUInt16LE(cursor+16),0xffff);cursor+=18;
  const p=(folder===' '?'':folder+'/')+name+'.'+ext;
  currentEntries.set(p,{crc,bytes:preload+length,preload:directory.subarray(cursor,cursor+preload),archive,offset,length});
  cursor+=preload;assert(cursor<=header+treeSize);
}
function currentIdentity(p){
  const entry=currentEntries.get(p),listed=listingEntries.get(p);
  assert(entry&&listed,'Current/retained package entry missing: '+p);
  assert.equal(entry.crc,listed.crc,p+' CRC differs from retained extraction listing');
  assert.equal(entry.bytes,listed.bytes,p+' size differs from retained extraction listing');
  const archive=entry.archive===0x7fff?vpkPath:vpkPath.replace(/_dir\.vpk$/,'_'+String(entry.archive).padStart(3,'0')+'.vpk');
  const data=Buffer.alloc(entry.length),fd=fs.openSync(archive,'r');
  try{assert.equal(fs.readSync(fd,data,0,data.length,entry.offset+(entry.archive===0x7fff?header+treeSize:0)),data.length);}
  finally{fs.closeSync(fd);}
  return {path:p,crc:entry.crc.toString(16).padStart(8,'0'),bytes:entry.bytes,
    compiledSha256:sha(Buffer.concat([entry.preload,data])),matchesRetainedListing:true};
}
function imported(id){
  const p='public/revamp/models/view-'+id+'.glb',fd=fs.openSync(path.join(repo,p),'r');
  try{
    const head=Buffer.alloc(20);assert.equal(fs.readSync(fd,head,0,20,0),20);
    assert.equal(head.toString('ascii',0,4),'glTF');assert.equal(head.readUInt32LE(16),0x4e4f534a);
    const bytes=Buffer.alloc(head.readUInt32LE(12));assert.equal(fs.readSync(fd,bytes,0,bytes.length,20),bytes.length);
    const doc=JSON.parse(bytes.toString());
    return {path:p,jsonSha256:sha(bytes),bytes:fs.fstatSync(fd).size,
      durations:Object.fromEntries(doc.animations.map(a=>[a.name,Math.max(...a.samplers.map(s=>doc.accessors[s.input].max?.[0]??0))]))};
  }finally{fs.closeSync(fd);}
}
const weapons={};
for(const id of ids) {
  const graphFile='animation/graphs/viewmodel/viewmodel_gun.vnmgraph+'+id+'.vnmgraph';
  const graphPath='research/reaudit-animation/'+graphFile;
  const retained=retainedGraphs.find(g=>g.file===graphFile);assert(retained);
  const bytes=read(graphPath);assert.equal(sha(bytes),retained.sha256,'Retained decoded graph changed');
  const compiledGraph=currentIdentity(graphFile+'_c');
  const exportPath='research/weapon-actions/'+id+'-export.json';
  const exported=JSON.parse(read(exportPath));
  const assembly=imported(id);
  const clips=Object.fromEntries(Object.entries(exported.clips).map(([name,clip])=>{
    const current=currentIdentity(clip.path),documented=inventory[id].clips[name];
    const importedIdentity={crc:parseInt(clip.crc,16).toString(16).padStart(8,'0'),bytes:clip.bytes};
    const matchesImportedManifest=current.crc===importedIdentity.crc && current.bytes===importedIdentity.bytes;
    // This correction is draw-only. Preserve other action identity differences
    // as findings instead of certifying their old imported payloads as current.
    if(name==='draw')assert(matchesImportedManifest,id+' draw differs from the current package');
    assert.equal(documented.path,clip.path);
    // The older inventory preserves DMX decimal-clock rounding (up to 33.45 us).
    // The export manifest records the recovered 30 Hz frame count instead.
    const inventoryClockDifference=documented.seconds-clip.seconds;
    assert(Math.abs(inventoryClockDifference)<.000035,'Inventory clock discrepancy exceeds retained rounding');
    // A one-sample native idle is padded to one 30 Hz frame by the importer.
    // Keep that explicit; only moving clips must retain the authored duration.
    const constantPosePadding=clip.seconds===0 && clip.samples===1 && /^idle(?:-|$)/.test(name);
    assert(Math.abs(assembly.durations[name]-(constantPosePadding?1/30:clip.seconds))<.00001,
      'Imported clip duration changed: '+id+'/'+name);
    return [name,{path:clip.path,seconds:clip.seconds,importedIdentity,matchesImportedManifest,
      inventorySeconds:documented.seconds,inventoryClockDifference,
      constantPosePaddingSeconds:constantPosePadding?assembly.durations[name]:0,current}];
  }));
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
  weapons[id]={path:graphPath,sha256:sha(bytes),compiledGraph,nodes:nodes.length,
    export:sourceInfo(exportPath),importBuild:exported.build,import:assembly,clips,
    stats:Object.fromEntries(['deploy','cycle','reload'].map(k=>[k,stats[id][k]])),
    entry:transition(entry),idleExit:transition(exit),completionEvents:state.m_timedStateEvents,
    drawClips:clipNodes.map(({doc:v})=>({name:v.m_name,clip:v.m_pDefaultVariationData.m_clip,
      rate:v.m_pDefaultVariationData.m_flSpeedMultiplier,syncOffset:v.m_pDefaultVariationData.m_nStartSyncEventOffset,
      loop:v.m_bAllowLooping,connectedInputs:0})),
    resetTransitions:resetNodes.map(n=>({name:n.doc.m_name,...transition(n)})),
    genericSpeedParameterDeclared:false};
}
const result={schema:1,scope:'Ordinary M4A4/M4A1-S/Glock/USP/Deagle draw relative rate; AWP unchanged control',
  provenance:sourceInfo(provenancePath),retainedGraphIndex:sourceInfo(retainedGraphsPath),
  listing:sourceInfo(listingPath),inventory:sourceInfo(inventoryPath),stats:sourceInfo(statsPath),
  currentPackage:{path:vpkPath,sha256:sha(directory),metadataEntries:currentEntries.size},
  parser:{path:'tools/kv3.mjs',sha256:sha(fs.readFileSync(path.join(repo,'tools/kv3.mjs')))},
  probeSha256:sha(fs.readFileSync(import.meta.filename)),weapons,
  conclusion:'All six graphs use unit-speed, unconnected, non-looping ordinary draw clips. Entry/reset has zero duration and no time match. Global idle requires external action_idle or empty action and uses a 200 ms transition. Deploying emits action complete with at most 100 ms of state time remaining.',
  boundaries:['The completion event is a graph event, not a proved gameplay readiness deadline or proved immediate exit.',
    'The external action_idle writer and event-consumer ordering remain unbound; no always-finish, cancel-at-readiness or seek-on-attachment behavior is certified.',
    'The proposed rate-only correction preserves the trainer onset, readiness-based lifetime and fade approximations.',
    'Pickup reuse in the trainer does not independently bind native pickup to action_deploy; keep pickup behavior unchanged.',
    'The live VPK directory and selected compiled graph/clip bytes are read and hashed; CRC/size must match the retained extraction listing. Draw identity must also match imported export metadata; other action mismatches are recorded without certifying current native parity.',
    'Retained decoded graph hashes must match the prior extraction index. This does not perform a fresh compiled-to-decoded conversion.',
    'The imported GLB JSON, duration metadata and file size are bound; this probe does not revalidate binary animation poses.']};
fs.writeFileSync(path.join(out,'reaudit-common-draw-graph.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({weapons:ids,clipNodes:24,entrySeconds:0,idleExitSeconds:.2,completeTimeRemaining:.1}));
