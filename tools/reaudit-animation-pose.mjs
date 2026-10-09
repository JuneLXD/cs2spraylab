// Global-space animation/skin bench, independent of runtime animation selection.
// Run after reaudit-animation.mjs --export, under the mandatory memory cap.
import fs from 'node:fs';
import {NodeIO} from '@gltf-transform/core';
import {ALL_EXTENSIONS} from '@gltf-transform/extensions';
import {Matrix4, Quaternion, Vector3} from 'three';
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS);
const work='research/reaudit-animation';
const native=await io.read(`${work}/native-composed.glb`);
const selection=JSON.parse(fs.readFileSync(`${work}/view-selection.json`));
const weapons=JSON.parse(fs.readFileSync('src/range/game-data.json')).weapons;
const hitboxes=JSON.parse(fs.readFileSync('src/range/duel/native-hitboxes.json')).hitboxes;
const qa=new Quaternion(),qb=new Quaternion();
function duration(clip){return Math.max(0,...clip.listSamplers().map(s=>s.getInput().getArray().at(-1)));}
function snapshot(doc){return doc.getRoot().listNodes().map(n=>({n,t:n.getTranslation(),r:n.getRotation(),s:n.getScale()}));}
const reset=states=>states.forEach(({n,t,r,s})=>n.setTranslation(t).setRotation(r).setScale(s));
function pose(clip,time,targets){for(const c of clip.listChannels()){
  const s=c.getSampler(),ts=s.getInput().getArray(),vs=s.getOutput().getArray(),size=s.getOutput().getElementSize();
  let i=0;while(i+1<ts.length&&ts[i+1]<=time+1e-7)i++;
  let v=Array.from(vs.slice(i*size,(i+1)*size));
  if(i+1<ts.length&&s.getInterpolation()!=='STEP'){
    const next=vs.slice((i+1)*size,(i+2)*size),f=Math.max(0,Math.min(1,(time-ts[i])/(ts[i+1]-ts[i])));
    v=c.getTargetPath()==='rotation'?qa.fromArray(v).normalize().slerp(qb.fromArray(next).normalize(),f).toArray():v.map((x,j)=>x+(next[j]-x)*f);
  }
  const n=targets?.get(c.getTargetNode().getName())??c.getTargetNode();if(c.getTargetPath()==='translation')n.setTranslation(v);else if(c.getTargetPath()==='rotation')n.setRotation(v);else if(c.getTargetPath()==='scale')n.setScale(v);
}}
function nodes(doc){return new Map(doc.getRoot().listNodes().map(n=>[n.getName(),n]));}
const baseline=snapshot(native),nativeNodes=nodes(native);
const rows=[];
const namedBones=['root_motion','pelvis','spine_0','spine_1','spine_2','neck_0','head_0','clavicle_L','clavicle_R','arm_upper_L','arm_upper_R','arm_lower_L','arm_lower_R','hand_L','hand_R','ankle_L','ankle_R','wpn','wpnPivot'];
function compare(source,doc,clip,kind,id){
  const importedNodes=nodes(doc),saved=snapshot(doc),end=duration(source);
  const times=Array.from({length:Math.ceil(end*30)+1},(_,i)=>Math.min(end,i/30));
  const row={kind,id,nativeSeconds:end,importedSeconds:duration(clip),frames:times.length,bones:0,maxBonePositionMetres:0,maxBoneRotationDegrees:0,maxHitboxEndpointMetres:0,maxWeaponPartPositionMetres:0,maxWeaponPartRotationDegrees:0,weaponPartSamples:0,worst:null};
  reset(baseline);
  const skeleton=kind==='view'?weapons[id.split('/')[0]]?.skeleton:undefined;
  const sourceRig=skeleton?native.getRoot().listNodes().find(n=>n.getName()===skeleton):undefined;
  const descendants=node=>[node,...node.listChildren().flatMap(descendants)];
  const sourceParts=sourceRig?new Map(descendants(sourceRig).map(n=>[n.getName(),n])):undefined;
  const weaponBind=sourceParts?.get('weapon');
  const bindInverse=weaponBind?new Matrix4().fromArray(weaponBind.getWorldMatrix()).invert():undefined;
  const importedSkin=kind==='view'?doc.getRoot().listSkins().find(s=>s.listJoints().some(n=>n.getName()==='weapon')):undefined;
  for(const t of times){reset(baseline);reset(saved);pose(source,t);pose(clip,t,importedNodes);
    for(const name of namedBones){
      const a=nativeNodes.get(name),b=importedNodes.get(name);if(!a||!b)continue;
      const am=new Matrix4().fromArray(a.getWorldMatrix()),bm=new Matrix4().fromArray(b.getWorldMatrix());
      const ae=am.elements,be=bm.elements;
      const delta=Math.hypot(ae[12]-be[12],ae[13]-be[13],ae[14]-be[14]);
      const angle=qa.setFromRotationMatrix(am).normalize().angleTo(qb.setFromRotationMatrix(bm).normalize())*180/Math.PI;
      if(delta>row.maxBonePositionMetres){row.maxBonePositionMetres=delta;row.worst={name,time:t};}
      row.maxBoneRotationDegrees=Math.max(row.maxBoneRotationDegrees,angle);row.bones++;
    }
    if(kind==='world')for(const h of hitboxes){
      const a=nativeNodes.get(h.bone),b=importedNodes.get(h.bone);if(!a||!b)continue;
      for(const endpoint of [h.start,h.end]){
        const ap=new Vector3(...endpoint).multiplyScalar(.0254).applyMatrix4(new Matrix4().fromArray(a.getWorldMatrix()));
        const bp=new Vector3(...endpoint).multiplyScalar(.0254).applyMatrix4(new Matrix4().fromArray(b.getWorldMatrix()));
        row.maxHitboxEndpointMetres=Math.max(row.maxHitboxEndpointMetres,ap.distanceTo(bp));
      }
    }
    if(bindInverse&&importedSkin){
      const mount=new Matrix4().fromArray(nativeNodes.get('wpn').getWorldMatrix()).multiply(bindInverse);
      for(const part of importedSkin.listJoints()){
        const sourcePart=sourceParts.get(part.getName());if(!sourcePart)continue;
        const expected=mount.clone().multiply(new Matrix4().fromArray(sourcePart.getWorldMatrix())),actual=new Matrix4().fromArray(part.getWorldMatrix());
        const delta=new Vector3().setFromMatrixPosition(expected).distanceTo(new Vector3().setFromMatrixPosition(actual));
        const angle=qa.setFromRotationMatrix(expected).normalize().angleTo(qb.setFromRotationMatrix(actual).normalize())*180/Math.PI;
        if(delta>row.maxWeaponPartPositionMetres){row.maxWeaponPartPositionMetres=delta;row.worstWeaponPart={bone:part.getName(),time:t,expected:new Vector3().setFromMatrixPosition(expected).toArray(),actual:new Vector3().setFromMatrixPosition(actual).toArray()};}
        row.maxWeaponPartRotationDegrees=Math.max(row.maxWeaponPartRotationDegrees,angle);row.weaponPartSamples++;
      }
    }
  }
  reset(saved);rows.push(row);
}
for(const id of ['ak47','aug','glock','awp','revolver','nova']){
  const doc=await io.read(`public/revamp/models/view-${id}.glb`);
  for(const [action,file]of Object.entries(selection[id])){
    // Charge is an additive graph layer, not an absolute pose. Separate DMX bench supplies its graph base.
    if(id==='revolver'&&action==='charge')continue;
    const source=native.getRoot().listAnimations().find(c=>c.getName()===file.replace(/\.vnmclip_c$/,''));
    const clip=doc.getRoot().listAnimations().find(c=>c.getName()===action);
    if(source&&clip)compare(source,doc,clip,'view',`${id}/${action}`);
  }
}
const target=await io.read('public/revamp/models/target.glb');
const motion=await io.read('public/revamp/models/duel-motion.glb');
// Transfer only channel values by bone name, preserving the shipped mesh skeleton's bind transforms.
const targetNodes=nodes(target),targetSaved=snapshot(target);
function posedBounds(doc,filter){
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];let vertices=0;
 for(const node of doc.getRoot().listNodes()){
  const mesh=node.getMesh();if(!mesh||!filter(mesh.getName()))continue;
  const skin=node.getSkin(),joints=skin?.listJoints(),ibm=skin?.getInverseBindMatrices()?.getArray();
  const transforms=joints?.map((j,i)=>new Matrix4().fromArray(j.getWorldMatrix()).multiply(new Matrix4().fromArray(ibm.slice(i*16,i*16+16))));
  for(const prim of mesh.listPrimitives()){
   const p=prim.getAttribute('POSITION'),js=prim.getAttribute('JOINTS_0'),ws=prim.getAttribute('WEIGHTS_0');
   for(let i=0;i<p.getCount();i++){
    const point=p.getElement(i,[]),v=new Vector3();
    if(transforms&&js&&ws){const ji=js.getElement(i,[]),w=ws.getElement(i,[]);for(let k=0;k<w.length;k++)if(w[k])v.addScaledVector(new Vector3(...point).applyMatrix4(transforms[ji[k]]),w[k]);}
    else v.fromArray(point).applyMatrix4(new Matrix4().fromArray(node.getWorldMatrix()));
    v.toArray().forEach((x,k)=>{min[k]=Math.min(min[k],x);max[k]=Math.max(max[k],x);});vertices++;
   }
  }
 }
 return {min,max,vertices};
}
const meshRows=[];
for(const name of ['idle_rifle','idle_crouch_rifle','walk_n_rifle','run_e_rifle','crouch_e_rifle','jump_stand_rifle']){
 const source=native.getRoot().listAnimations().find(c=>c.getName().endsWith('/'+name));
 const clip=motion.getRoot().listAnimations().find(c=>c.getName().endsWith('/'+name));
 if(!source||!clip)continue;
 // Map the animation-only pack's channels onto the target's nodes without copying its bind pose.
 compare(source,target,clip,'world',name);
 for(const fraction of [0,.5,1]){
  reset(baseline);reset(targetSaved);pose(source,duration(source)*fraction);pose(clip,duration(clip)*fraction,targetNodes);
  meshRows.push({name,fraction,native:posedBounds(native,n=>n.includes('thirdperson_body')),trainer:posedBounds(target,n=>n.includes('thirdperson_body'))});
 }
}
const report={schema:1,baseline:'c488943',rows,meshRows,notes:['Frame sampling uses absolute native seconds at 30 Hz plus exact endpoint.','Revolver charge is independently graph-composed in reaudit-animation-charge.mjs and excluded here.','Clip poses only: graph blends, event timing, runtime IK and rendering are excluded.','World capsule endpoint comparison uses existing capsule definitions on fresh-native vs shipped posed skeleton; it does not independently validate those definitions.','Mesh envelopes include all third-person body vertices, with joint weights and inverse bind matrices; no material, texture or lighting equality is implied.']};
fs.writeFileSync('tools/reaudit-animation-pose-results.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify(rows,null,2)+'\n');
