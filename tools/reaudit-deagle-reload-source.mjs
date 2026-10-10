// Read current VPK bytes and freshly decoded clip/graph data; optionally refresh only Deagle normal-reload markers.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {parseKv3} from './kv3.mjs';
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:path.resolve(process.argv[i+1]);};
const repo=path.resolve(import.meta.dirname,'..');
const audit=option('--audit-root',path.resolve(repo,'../native-audit'));
const original=path.resolve(audit,'../cs2spraylab');
const work=path.join(audit,'reports/deagle-reload-next');
const game=path.resolve(audit,'../cs2-game/game/csgo');
const hash=b=>createHash('sha256').update(b).digest('hex');
const fileInfo=p=>({path:p,bytes:fs.statSync(p).size,sha256:hash(fs.readFileSync(p))});
const compiledPaths=['animation/anims/viewmodel/pistol/pistol_deagle/reload_deagle.vnmclip_c','animation/anims/viewmodel/pistol/pistol_deagle/reload_empty_deagle.vnmclip_c','animation/graphs/viewmodel/viewmodel_gun.vnmgraph+deagle.vnmgraph_c'];
const dirPath=path.join(game,'pak01_dir.vpk'),directory=fs.readFileSync(dirPath);
assert.equal(directory.readUInt32LE(0),0x55aa1234);assert.equal(directory.readUInt32LE(4),2);
const header=28,end=header+directory.readUInt32LE(8);let cursor=header;const entries=new Map();
function token(){const n=directory.indexOf(0,cursor);assert(n>=cursor&&n<end);const s=directory.toString('utf8',cursor,n);cursor=n+1;return s;}
for(let ext=token();ext;ext=token())for(let folder=token();folder;folder=token())for(let name=token();name;name=token()){
 const crc=directory.readUInt32LE(cursor),preload=directory.readUInt16LE(cursor+4),archive=directory.readUInt16LE(cursor+6),offset=directory.readUInt32LE(cursor+8),length=directory.readUInt32LE(cursor+12);
 assert.equal(directory.readUInt16LE(cursor+16),65535);cursor+=18;
 const key=(folder===' '?'':folder+'/')+name+'.'+ext;
 if(compiledPaths.includes(key))entries.set(key,{crc,preload:directory.subarray(cursor,cursor+preload),archive,offset,length});
 cursor+=preload;assert(cursor<=end);
}
function crc32(b){let crc=0xffffffff;for(const v of b){crc^=v;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
const compiled=compiledPaths.map(p=>{
 const e=entries.get(p);assert(e,p);const archive=e.archive===0x7fff?dirPath:dirPath.replace('_dir.vpk','_'+String(e.archive).padStart(3,'0')+'.vpk');
 const b=Buffer.alloc(e.length),fd=fs.openSync(archive,'r');try{assert.equal(fs.readSync(fd,b,0,b.length,e.offset+(e.archive===0x7fff?end:0)),b.length);}finally{fs.closeSync(fd);}
 const bytes=Buffer.concat([e.preload,b]);assert.equal(crc32(bytes),e.crc);
 return {path:p,bytes:bytes.length,crc:e.crc.toString(16).padStart(8,'0'),sha256:hash(bytes)};
});
assert.equal(compiled[0].sha256,'3966fb59252703eaf905a5cbda2c0c778a2837f0ab27e14a819a155a14ff8f3e');
const manifest=JSON.parse(fs.readFileSync(path.join(original,'research/weapon-actions/deagle-export.json')));
assert.equal(compiled[1].crc,parseInt(manifest.clips['reload-empty'].crc,16).toString(16).padStart(8,'0'));
const decoded=compiledPaths.map(p=>path.join(work,'fresh',p.replace(/_c$/,'')));
const [normal,empty,graph]=decoded.map(p=>parseKv3(fs.readFileSync(p,'utf8')));
const old=compiledPaths.slice(0,2).map(p=>parseKv3(fs.readFileSync(path.join(original,'research',path.basename(p).replace(/_c$/,'')),'utf8')));
const normalize=d=>({...d,m_sourceFilename:d.m_sourceFilename.replaceAll('\\','/')});
const expected=structuredClone(normalize(old[0]));
const events=d=>d.m_eventTracks.flatMap(t=>t.m_events);
const clipout=events(expected).find(e=>e.m_name==='Weapon_DEagle.Clipout');assert.equal(clipout.m_flStartTime,4);clipout.m_flStartTime=10;
const silent=events(expected).find(e=>e.m_ID==='WPN_RELOAD_SILENT');assert.equal(silent.m_flDuration,49);silent.m_flDuration=50;
assert.deepEqual(normalize(normal),expected,'Unexpected additional normal reload event change');
assert.deepEqual(normalize(empty),normalize(old[1]),'Empty reload must remain an unchanged control');
const motion=JSON.parse(fs.readFileSync(path.join(work,'motion-comparison.json')));
assert.equal(motion.differences.length,0);assert.equal(motion.rows.fresh.frameRate,30);assert.equal(motion.rows.fresh.duration,2.2);
assert.equal(motion.rows.fresh.sha256,hash(fs.readFileSync(decoded[0].replace('.vnmclip','.dmx'))));
assert.equal(motion.rows['import-era'].sha256,hash(fs.readFileSync(path.join(original,'research/reload_deagle.dmx'))));
const nodes=[],edges=[];
function walk(v){if(!v||typeof v!=='object')return;if(Array.isArray(v)){for(const x of v)walk(x);return;}if(v.m_ID&&v._class?.endsWith('Node'))nodes.push(v);if(v.m_connections)edges.push(...v.m_connections);for(const [k,x]of Object.entries(v))if(k!=='m_connections')walk(x);}
walk(graph);
const clipNodes=nodes.filter(n=>n._class==='CNmGraphDocClipNode'&&compiledPaths.slice(0,2).some(p=>p.replace(/_c$/,'')===n.m_pDefaultVariationData?.m_clip));
assert(clipNodes.length>0);
for(const n of clipNodes){assert.equal(n.m_pDefaultVariationData.m_flSpeedMultiplier,1);assert.equal(n.m_pDefaultVariationData.m_nStartSyncEventOffset,0);assert.equal(n.m_bAllowLooping,false);assert.deepEqual(n.m_overrides,[]);assert.equal(edges.filter(e=>e.m_toNodeID===n.m_ID).length,0);}
const fps=motion.rows.fresh.frameRate;
const sound=events(normal).filter(e=>e._class==='CNmClipDocEvent_Sound').map(e=>({source:e.m_name,time:e.m_flStartTime/fps,nativeFrame:e.m_flStartTime,audience:e.m_relevance==='ClientOnly'||e.m_relevance==='Client'?'local':'all',nativeRelevance:e.m_relevance}));
const windows=events(normal).filter(e=>e.m_ID==='WPN_RELOAD_SILENT').map(e=>({start:e.m_flStartTime/fps,end:(e.m_flStartTime+e.m_flDuration)/fps}));
const result={schema:1,importManifest:fileInfo(path.join(original,'research/weapon-actions/deagle-export.json')),importClipDefinitions:compiledPaths.slice(0,2).map(p=>fileInfo(path.join(original,'research',path.basename(p).replace(/_c$/,'')))),installedBuild:fs.readFileSync(path.join(game,'steam.inf'),'utf8').match(/ClientVersion=(\d+)/)?.[1],probeSha256:hash(fs.readFileSync(import.meta.filename)),package:fileInfo(dirPath),exporter:fileInfo(path.join(original,'.local-tools/vrf-linux/Source2Viewer-CLI')),compiled,decoded:decoded.map(fileInfo),motionComparison:motion,reloadNodes:clipNodes.map(n=>({name:n.m_name,clip:n.m_pDefaultVariationData.m_clip,rate:n.m_pDefaultVariationData.m_flSpeedMultiplier,connectedInputs:0})),normal:{fps,duration:2.2,insert:events(normal).find(e=>e.m_ID==='WPN_RELOAD_ADD_AMMO').m_flStartTime/fps,silent:windows,sound},changes:[{event:'Weapon_DEagle.Clipout',beforeFrame:4,currentFrame:10},{event:'WPN_RELOAD_SILENT',beforeEndFrame:49,currentEndFrame:50}],emptyUnchanged:true,boundaries:['Fresh selected static resource exports; no current Deagle live reload capture.','All decoded pose semantics match the import-era export, excluding generated UUIDs; this does not independently validate the assembled trainer skeleton.','Native silent-gate coefficients and runtime event-consumer ordering are not newly established by this resource update.']};
if(process.argv.includes('--apply')){
 const timingPath=path.join(repo,'src/range/native-reload-timing.json');const timing=JSON.parse(fs.readFileSync(timingPath));
 assert.equal(timing.weapons.deagle.normal.duration,2.2);assert.equal(timing.weapons.deagle.normal.insert,result.normal.insert);
 timing.weapons.deagle.normal.sha256=result.decoded[0].sha256;timing.weapons.deagle.normal.silent=windows;
 fs.writeFileSync(timingPath,JSON.stringify(timing,null,2)+'\n');
 const publicPath=path.join(repo,'public/revamp/audio/events.json'),audio=JSON.parse(fs.readFileSync(publicPath));
 const timeline=audio.timelines.deagle.reload;assert.equal(timeline.duration,2.2);
 timeline.sha256=result.decoded[0].sha256;
 timeline.cues=sound.map(c=>{const old=timeline.cues.find(x=>audio.events[x.key]?.source===c.source);assert(old,'Missing retained audio sample '+c.source);return {...old,time:c.time,nativeFrame:c.nativeFrame,audience:c.audience,nativeRelevance:c.nativeRelevance};});
 fs.writeFileSync(publicPath,JSON.stringify(audio,null,2)+'\n');
 const metadataPath=path.join(repo,'src/range/sound-events-data.json'),metadata=JSON.parse(fs.readFileSync(metadataPath));
 metadata.timelines.deagle.reload.cues=timeline.cues.map(({time,key,audience})=>({time,key,audience}));
 fs.writeFileSync(metadataPath,JSON.stringify(metadata,null,2)+'\n');
}
fs.writeFileSync(path.join(work,'source-proof.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({changes:result.changes,poseKeys:motion.rows.fresh.keys,reloadNodes:clipNodes.length,emptyUnchanged:true,applied:process.argv.includes('--apply')},null,2));
