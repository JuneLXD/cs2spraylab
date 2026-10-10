import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {parseKv3} from './kv3.mjs';

// Decode the retained current-build AK resource text again; do not trust an
// earlier derived graph JSON. No exporter, native process or renderer is used.
const root=path.resolve(import.meta.dirname,'..');
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
function source(p, expected) {
  const bytes=fs.readFileSync(path.join(root,p)),sha256=hash(bytes);
  assert.equal(sha256,expected);return {path:p,sha256,doc:parseKv3(bytes.toString())};
}
const graph=source('research/reaudit-animation/animation/graphs/viewmodel/viewmodel_gun.vnmgraph+ak47.vnmgraph','87908d9b2ff24890dc95503916452c64274f713b5452eda0497038ce1c7b1317');
const clip=source('research/reaudit-animation/animation/anims/viewmodel/rifle/rifle_ak/reload_ak.vnmclip','2b215e9df130368e007b3c7c707efff8ceba3f50a467da2fece3105722dc9326');
const nodes=[],connections=[],layers=[];
function walk(v) {
  if(!v||typeof v!=='object')return;
  if(Array.isArray(v)){for(const x of v)walk(x);return;}
  if(v.m_ID&&v._class?.endsWith('Node'))nodes.push(v);
  if(v.m_connections)connections.push(...v.m_connections);
  if(Object.hasOwn(v,'m_isSynchronized'))layers.push(v.m_isSynchronized);
  for(const [k,x]of Object.entries(v))if(k!=='m_connections')walk(x);
}
walk(graph.doc);assert.equal(nodes.length,459);
const byId=new Map(nodes.map(n=>[n.m_ID,n]));
const input=(n,pin)=>{
  const id=n.m_inputPins.find(p=>p.m_name===pin)?.m_ID;
  const links=connections.filter(c=>c.m_toNodeID===n.m_ID&&c.m_inputPinID===id);
  assert.equal(links.length,1);return byId.get(links[0].m_fromNodeID);
};
const outputs=n=>connections.filter(c=>c.m_fromNodeID===n.m_ID).map(c=>byId.get(c.m_toNodeID));
const reloads=nodes.filter(n=>n._class==='CNmGraphDocClipNode'&&n.m_pDefaultVariationData?.m_clip===clip.path.replace('research/reaudit-animation/',''));
assert.equal(reloads.length,4);
const paths=reloads.map(n=>{
  const d=n.m_pDefaultVariationData;
  assert.equal(d.m_flSpeedMultiplier,1);assert.equal(d.m_nStartSyncEventOffset,0);
  assert.equal(n.m_bAllowLooping,false);assert.deepEqual(n.m_overrides,[]);
  assert.equal(connections.filter(c=>c.m_toNodeID===n.m_ID).length,0);
  const next=outputs(n);assert.equal(next.length,1);assert(next[0]._class.includes('ClipSelector'));
  const end=outputs(next[0]);assert.equal(end.length,1);assert(end[0]._class.includes('PoseResult'));
  return {name:n.m_name,speed:d.m_flSpeedMultiplier,startSyncEventOffset:d.m_nStartSyncEventOffset,path:[n._class,next[0]._class,end[0]._class]};
});
const transition=byId.get('7927522a-c839-42e2-b4bc-5e6b746dad14');
assert.equal(transition.m_name,'Reload');assert.equal(transition.m_flDurationSeconds,.2);
assert.equal(transition.m_timeMatchMode,'MatchSyncEventID');assert.equal(transition.m_flTimeOffset,0);
assert.equal(transition.m_bClampDurationToSource,false);
const target=input(transition,'Target Sync ID');assert.equal(target._class,'CNmGraphDocIDSwitchNode');
const condition=input(target,'Bool'),yes=input(target,'If True'),no=input(target,'If False');
assert.equal(condition.m_comparison,'Matches');assert.deepEqual(condition.m_values,['stage_outro']);
assert.equal(input(condition,'ID').m_name,'reload_stage');
assert.equal(yes.m_value,'WPN_RELOAD_OUTRO');assert.equal(no.m_value,'');
assert.equal(clip.doc.m_eventTracks.length,10);
assert(clip.doc.m_eventTracks.every(t=>t.m_bIsSyncTrack===false));
const events=clip.doc.m_eventTracks.flatMap(t=>t.m_events);
const insert=events.filter(e=>e.m_ID==='WPN_RELOAD_ADD_AMMO');assert.equal(insert.length,1);assert.equal(insert[0].m_flStartTime,33);
assert(!events.some(e=>['WPN_RELOAD_LOOP','WPN_RELOAD_OUTRO'].includes(e.m_ID)));
assert.equal(layers.length,3);assert(layers.every(x=>x===false));
const listing=fs.readFileSync(path.join(root,'research/reaudit-animation/listing.txt'));
const nativePath=clip.path.replace('research/reaudit-animation/','')+'_c';
const line=listing.toString().split('\n').find(l=>l.startsWith(nativePath+' CRC:'));
assert.equal(line?.trim(),nativePath+' CRC:00c67cf7ca size:27253');
const result={schema:1,scope:'Ordinary AK partial/empty first-person reload only',
  graph:{path:graph.path,sha256:graph.sha256,nodes:nodes.length},decodedClip:{path:clip.path,sha256:clip.sha256},
  compiledClipManifest:{path:nativePath,crc:'00c67cf7ca',bytes:27253,listingSha256:hash(listing)},
  reloadPaths:paths,transition:{blendSeconds:.2,timeMatchMode:transition.m_timeMatchMode,timeOffset:0,clampToSource:false,targetSwitch:{input:'reload_stage',equals:'stage_outro',ifTrue:yes.m_value,ifFalse:no.m_value}},
  eventTracks:10,syncTracks:0,insertionFrame:33,unsynchronizedLayers:layers.length,
  conclusion:'Reload ClipNode paths have speed 1, no connected dynamic clip inputs, no temporal wrapper between clip and pose result, and no reload sync markers. Ordinary entry selects an empty sync target; outro alone selects WPN_RELOAD_OUTRO.',
  limits:['Graph entry/first-active-sample phase and empty-sync-target fallback are not measured by this resource inspection. Preserve existing trainer onset/blends; no exact native displayed-hand or audio alignment claim.',
    'Decoded-resource SHA-256s and compiled listing CRC/size have different provenance. This probe validates retained exports/listing, not a new package extraction.']};
const out=path.resolve(process.argv.includes('--out')?process.argv[process.argv.indexOf('--out')+1]:path.join(root,'docs/evidence/reaudit-animation-clock-graph.json'));
fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({nodes:nodes.length,reloadPaths:paths.length,eventTracks:10,syncTracks:0,ordinaryTarget:no.m_value,output:out}));
