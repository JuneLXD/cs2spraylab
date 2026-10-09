// Fresh installed-game animation bench. Run under the repository's systemd memory cap.
// --export saves primary VPK evidence; default samples native/imported channels at every authored frame.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Quaternion} from 'three';
import {selectViewClips, supportedViewIds} from './native-view-clips.mjs';
import {parseKv3} from './kv3.mjs';

const work = path.resolve('research/reaudit-animation');
const game = process.env.CS2_PATH || path.resolve('../cs2-game');
const cli = process.env.SOURCE2VIEWER || path.resolve('.local-tools/vrf-linux/Source2Viewer-CLI');
const vpk = `${game}/game/csgo/pak01_dir.vpk`;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const run = args => execFileSync(cli, ['-i', vpk, ...args], {encoding:'utf8',maxBuffer:100e6});
const representatives = ['ak47', 'aug', 'glock', 'awp', 'revolver', 'nova'];
fs.mkdirSync(work, {recursive:true});
const listFile = path.join(work,'listing.txt');
if (process.argv.includes('--export')) {
  fs.writeFileSync(listFile,run(['-l','-f','animation/']));
  run(['-f','animation/graphs/worldmodel/,animation/graphs/viewmodel/','-o',work,'-d']);
  const listing = fs.readFileSync(listFile,'utf8').split(/\r?\n/).map(x=>x.split(' ')[0]).filter(x=>x.endsWith('.vnmclip_c'));
  const motion = await io.read('public/revamp/models/duel-motion.glb');
  const clips = motion.getRoot().listAnimations().map(x=>x.getName().split('/').pop()).filter(x=>!x.startsWith('death_'));
  clips.push('flinch_head','flinch_chest','flinch_head_pistol','flinch_chest_knife');
  const view = Object.fromEntries(supportedViewIds.map(id=>[id,selectViewClips(id,listing)]));
  fs.writeFileSync(path.join(work,'view-selection.json'),JSON.stringify(view,null,2));
  for(const id of representatives) clips.push(...Object.values(view[id]).map(x=>path.posix.basename(x,'.vnmclip_c')));
  const selected = new Set(clips);
  const sources = listing.filter(x=>selected.has(path.posix.basename(x,'.vnmclip_c')));
  for(let i=0;i<sources.length;i+=40)run(['-f',sources.slice(i,i+40).join(','),'-o',work,'-d']);
  run(['-f','agents/models/ctm_sas/ctm_sas.vmdl_c','-o',path.join(work,'native-composed.glb'),'-d','--gltf_export_format','glb','--gltf_export_animations','--gltf_compose_additive','--gltf_animation_list',[...selected].join(',')]);
  run(['-f','agents/models/ctm_sas/ctm_sas.vmdl_c','-o',path.join(work,'native-flinch.glb'),'-d','--gltf_export_format','glb','--gltf_export_animations','--gltf_animation_list','flinch_head,flinch_chest,flinch_head_pistol,flinch_chest_knife']);
  fs.writeFileSync(path.join(work,'provenance.json'),JSON.stringify({build:fs.readFileSync(`${game}/game/csgo/steam.inf`,'utf8'),vpk,listingHash:hash(listFile),nativeHash:hash(path.join(work,'native-composed.glb')),selected:[...selected]},null,2));
  process.stdout.write(`Fresh evidence exported to ${work}\n`);
  process.exit(0);
}

const rows = [];
const rotation = new Quaternion(), other = new Quaternion();
function channels(clip) {return new Map(clip.listChannels().map(c=>[`${c.getTargetNode().getName()}/${c.getTargetPath()}`,c]));}
function duration(clip) {return Math.max(0,...clip.listSamplers().map(s=>s.getInput().getArray().at(-1)));}
function valueAt(channel,t) {
  const sampler=channel.getSampler(),times=sampler.getInput().getArray(),values=sampler.getOutput().getArray();
  const size=sampler.getOutput().getElementSize();
  let i=0;while(i+1<times.length && times[i+1]<=t+1e-7)i++;
  const value=Array.from(values.slice(i*size,(i+1)*size));
  if(i+1===times.length||sampler.getInterpolation()==='STEP')return value;
  const fraction=Math.max(0,Math.min(1,(t-times[i])/(times[i+1]-times[i])));
  const next=values.slice((i+1)*size,(i+2)*size);
  if(channel.getTargetPath()==='rotation')return rotation.fromArray(value).normalize().slerp(other.fromArray(next).normalize(),fraction).toArray();
  return value.map((v,j)=>v+(next[j]-v)*fraction);
}
function compare(native,imported,{kind,filter=()=>true,id}) {
  const nc=channels(native),ic=channels(imported),row={kind,id,native:native.getName(),imported:imported.getName(),nativeSeconds:duration(native),importedSeconds:duration(imported),nativeChannels:nc.size,importedChannels:ic.size,comparedChannels:0,samples:0,maxTranslationMetres:0,maxRotationDegrees:0,maxScale:0,missing:[],worst:null};
  for(const [key,c]of nc){
    if(!filter(key))continue;
    const match=ic.get(key);if(!match){row.missing.push(key);continue;}
    row.comparedChannels++;
    const times=c.getSampler().getInput().getArray();
    // Include every original keyframe, not a few percentage landmarks.
    for(const t of times){
      const a=valueAt(c,t),b=valueAt(match,t),p=c.getTargetPath();
      const error=p==='rotation'?2*Math.acos(Math.min(1,Math.abs(rotation.fromArray(a).normalize().dot(other.fromArray(b).normalize()))))*180/Math.PI:Math.hypot(...a.map((v,i)=>v-b[i]));
      const metric=p==='rotation'?'maxRotationDegrees':p==='translation'?'maxTranslationMetres':'maxScale';
      if(error>row[metric]){row[metric]=error;if(p==='rotation')row.worst={key,time:t,native:a,imported:b};}
      row.samples++;
    }
  }
  rows.push(row);return row;
}
const native=await io.read(path.join(work,'native-composed.glb'));
const motion=await io.read('public/revamp/models/duel-motion.glb');
for(const clip of motion.getRoot().listAnimations()){
  const source=native.getRoot().listAnimations().find(c=>c.getName()===clip.getName());
  if(source)compare(source,clip,{kind:'world-locomotion',id:clip.getName().split('/').pop()});
}
const sourceFlinch=await io.read(path.join(work,'native-flinch.glb')),flinch=await io.read('public/revamp/models/duel-flinch.glb');
for(const source of sourceFlinch.getRoot().listAnimations()){
  const clip=flinch.getRoot().listAnimations().find(c=>c.getName()===source.getName());
  if(clip)compare(source,clip,{kind:'world-flinch',id:clip.getName().split('/').pop(),filter:key=>key.endsWith('/rotation')&&!/^(root_motion|pelvis|wpn|wpnPivot)\/|AIM|jiggle/.test(key)&&channels(clip).has(key)});
}
const view=JSON.parse(fs.readFileSync(path.join(work,'view-selection.json')));
const inventory=[];
for(const id of supportedViewIds){
  const file=`public/revamp/models/view-${id}.glb`;
  if(!fs.existsSync(file))continue;
  const imported=await io.read(file),root=imported.getRoot();
  inventory.push({id,file,sha256:hash(file),clips:root.listAnimations().map(c=>({name:c.getName(),seconds:duration(c),channels:c.listChannels().length})),meshes:root.listMeshes().map(m=>({name:m.getName(),primitives:m.listPrimitives().map(p=>({vertices:p.getAttribute('POSITION')?.getCount(),indices:p.getIndices()?.getCount(),skinJoints:p.getAttribute('JOINTS_0')?.getCount()}))})),materials:root.listMaterials().map(m=>({name:m.getName(),metalness:m.getMetallicFactor(),roughness:m.getRoughnessFactor(),extensions:m.listExtensions().map(e=>e.extensionName)}))});
  if(!representatives.includes(id))continue;
  for(const [action,name]of Object.entries(view[id])){
    const source=native.getRoot().listAnimations().find(c=>c.getName()===name.replace(/\.vnmclip_c$/,''));
    const clip=root.listAnimations().find(c=>c.getName()===action);
    if(!source||!clip)continue;
    // Blender remaps each bone's local basis; global pose validation belongs in the companion pose bench.
    if(id==='revolver'&&action==='charge')continue; // Separately graph-composed in reaudit-animation-charge.mjs.
    const row=compare(source,clip,{kind:'view-local-basis-diagnostic',id:`${id}/${action}`,filter:key=>/^(?:hand_|arm_|head_|spine_|wpn|finger_|root_motion|pelvis)/.test(key)});
    row.interpretation='Different local bind bases expected after Blender. Do not interpret this as global pose error.';
  }
}
const report={schema:1,baseline:'c488943',provenance:JSON.parse(fs.readFileSync(path.join(work,'provenance.json'))),rows,inventory};
fs.writeFileSync('tools/reaudit-animation-results.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({clips:rows.length,samples:rows.reduce((n,r)=>n+r.samples,0),world:rows.filter(r=>r.kind==='world-locomotion').map(r=>({id:r.id,seconds:r.nativeSeconds,translation:r.maxTranslationMetres,rotation:r.maxRotationDegrees,missing:r.missing.length})),view:rows.filter(r=>r.kind.startsWith('view')).map(r=>({id:r.id,native:r.nativeSeconds,imported:r.importedSeconds}))},null,2)+'\n');
