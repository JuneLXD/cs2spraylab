// Independent graph-composed R8 reference: shoot1 frame 0 + relative DMX deltas.
// Does not import the production composition helper. Run under the mandatory cap.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4,Quaternion,Vector3} from 'three';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS),work='research/reaudit-animation';
const source=await io.read(`${work}/native-composed.glb`),dmx=JSON.parse(fs.readFileSync(`${work}/revolver-charge-dmx.json`));
const root=source.getRoot(),fire=root.listAnimations().find(a=>a.getName().endsWith('/shoot1_revolver'));
const charge=root.listAnimations().find(a=>a.getName().endsWith('/prepare_shoot_revolver'));
const map=new Map(charge.listChannels().map(c=>[c.getTargetNode().getName(),c.getTargetNode()]));
const states=root.listNodes().map(n=>[n,n.getTranslation(),n.getRotation(),n.getScale()]);
const reset=()=>states.forEach(([n,t,q,s])=>n.setTranslation(t).setRotation(q).setScale(s));
function sample(clip,time){for(const c of clip.listChannels()){
 const s=c.getSampler(),ts=s.getInput().getArray(),vs=s.getOutput().getArray(),size=s.getOutput().getElementSize();
 let i=0;while(i+1<ts.length&&ts[i+1]<=time+1e-7)i++;
 let v=Array.from(vs.slice(i*size,(i+1)*size));
 if(i+1<ts.length){const f=Math.max(0,Math.min(1,(time-ts[i])/(ts[i+1]-ts[i]))),next=vs.slice((i+1)*size,(i+2)*size);
 v=c.getTargetPath()==='rotation'?new Quaternion().fromArray(v).normalize().slerp(new Quaternion().fromArray(next).normalize(),f).toArray():v.map((x,j)=>x+(next[j]-x)*f);}
 const n=c.getTargetNode();if(c.getTargetPath()==='rotation')n.setRotation(v);else if(c.getTargetPath()==='translation')n.setTranslation(v);else if(c.getTargetPath()==='scale')n.setScale(v);
}}
const matrix=n=>new Matrix4().fromArray(n.getWorldMatrix());
const inverseBind=matrix(map.get('weapon')).invert();
const names=['arm_upper_L','arm_upper_R','arm_lower_L','arm_lower_R','hand_L','hand_R','finger_index_0_R','finger_index_1_R','finger_index_2_R','wpn'];
const parts=['weapon','weapon_offset','hammer','trigger','cylinder'];
function reference(index){reset();sample(fire,0);
 for(const c of dmx){const n=map.get(c.bone);if(!n)continue;
 const first=c.values[0],value=c.values[Math.min(index,c.values.length-1)];
 if(c.path==='orientation')n.setRotation(new Quaternion().fromArray(n.getRotation()).normalize().multiply(new Quaternion().fromArray(first).normalize().invert()).multiply(new Quaternion().fromArray(value).normalize()).normalize().toArray());
 else if(c.path==='position')n.setTranslation(n.getTranslation().map((x,j)=>x+(value[j]-first[j])*.0254));
 }
 const mount=matrix(map.get('wpn')).multiply(inverseBind);
 return Object.fromEntries([...names.filter(n=>map.has(n)).map(n=>[n,matrix(map.get(n))]),...parts.filter(n=>map.has(n)).map(n=>[n,mount.clone().multiply(matrix(map.get(n)))])]);
}
const sourceTimes=charge.listSamplers().map(s=>s.getInput().getArray()).sort((a,b)=>b.length-a.length)[0];
const rows=[],fixtureFrames=[];
for(const [label,file]of [['before',`${work}/before/view-revolver.glb`],['after','public/revamp/models/view-revolver.glb'],['after-legacy','public/revamp/models/view-revolver-legacy.glb']]){
 const document=await io.read(file),clip=document.getRoot().listAnimations().find(a=>a.getName()==='charge'),nodes=new Map(document.getRoot().listNodes().map(n=>[n.getName(),n]));
 const row={label,file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),frames:30,landmarkSamples:0,maxArmPositionMetres:0,maxPartPositionMetres:0,maxRotationDegrees:0,worstArm:null,worstPart:null};
 for(let i=0;i<30;i++){
  const time=sourceTimes[i],expected=reference(i);sample(clip,time);
  const frame={time,positions:{},rotations:{}};
  for(const [name,m]of Object.entries(expected)){
   const actual=nodes.get(name);if(!actual)continue;
   const p=new Vector3().setFromMatrixPosition(m),q=new Quaternion().setFromRotationMatrix(m).normalize(),am=matrix(actual);
   if(!m.elements.every(Number.isFinite)||!am.elements.every(Number.isFinite))throw new Error('Nonfinite reference/pose');
   const delta=p.distanceTo(new Vector3().setFromMatrixPosition(am)),angle=q.angleTo(new Quaternion().setFromRotationMatrix(am).normalize())*180/Math.PI;
   const field=parts.includes(name)?'maxPartPositionMetres':'maxArmPositionMetres',worst=parts.includes(name)?'worstPart':'worstArm';
   if(delta>row[field]){row[field]=delta;row[worst]={name,time};}row.maxRotationDegrees=Math.max(row.maxRotationDegrees,angle);row.landmarkSamples++;
   frame.positions[name]=p.toArray();frame.rotations[name]=q.toArray();
  }
  if(label==='after'&&[0,3,6,9,15,29].includes(i))fixtureFrames.push(frame);
 }
 rows.push(row);
}
const sha=f=>crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const fixture={source:'CS2 client 2000930',graph:'animation/graphs/viewmodel/viewmodel_gun_revolver.vnmgraph',base:'shoot1_revolver frame 0',layer:'prepare_shoot_revolver; Additive; RelativeToFrame / FirstFrame',derivation:'Fresh shoot1 first-frame local transforms plus independently decoded DMX first-relative deltas. Weapon part world = primary wpn world * inverse secondary weapon bind world * secondary part world.',sourceExportSha256:sha(`${work}/native-composed.glb`),dmxSha256:sha(`${work}/revolver-charge-dmx.json`),chargeSeconds:.9666999578475952,toleranceMetres:.0001,toleranceDegrees:.05,frames:fixtureFrames};
fs.writeFileSync('src/range/native-viewmodel-mount-fixture.json',JSON.stringify(fixture,null,2)+'\n');
fs.writeFileSync('tools/reaudit-animation-fix-results.json',JSON.stringify({schema:2,reference:fixture,rows,notes:['Reference uses graph composition, not the bind-composed VRF clip.','Previous mount-only test omitted the graph base and incorrectly accepted hanging arms; it is superseded.','Samples align corresponding native 30 Hz keys; runtime charge retiming is separately unverified.']},null,2)+'\n');
console.log(JSON.stringify(rows,null,2));
