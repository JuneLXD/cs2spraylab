// Measures the actual engine transform statements before and after the fix.
// Run under the memory cap: node tools/reaudit-viewmodel-air-replay.mjs before|after
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {Group, Quaternion, Vector3} from 'three';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const phase=process.argv[2];if(!['before','after'].includes(phase))throw Error('Use before or after');
const baseline=process.argv[3]??'252a1e7';
const oldSource=file=>execFileSync('git',['show',`${baseline}:${file}`],{cwd:root,encoding:'utf8'});
const fixture=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/reaudit-viewmodel-air-native.json')));
const virtual='__air_baseline_recoil.ts';
const vite=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'error',plugins:[{
 name:'air-baseline',enforce:'pre',resolveId(id){if(id.endsWith(virtual))return path.join(root,'src/range',virtual);},
 load(id){if(id.endsWith(virtual))return oldSource('src/range/view-recoil.ts');},
}]});
const sourceQuaternion=([x,y,z,w])=>new Quaternion(-y,z,-x,w).normalize();
const angularError=(a,b)=>{const q=a.clone().invert().multiply(b);return 2*Math.atan2(Math.hypot(q.x,q.y,q.z),Math.abs(q.w))*180/Math.PI;};
try {
 const module=await vite.ssrLoadModule(phase==='before'?`/src/range/${virtual}`:'/src/range/view-recoil.ts');
 const Air=fs.existsSync(path.join(root,'src/range/viewmodel-air.ts'))?(await vite.ssrLoadModule('/src/range/viewmodel-air.ts')).ViewmodelAir:undefined;
 const rows=[];
 for(const mode of ['range','duel']) {
  const file=mode==='range'?'src/range/engine.ts':'src/range/duel/DuelEngine.ts';
  const source=phase==='before'?oldSource(file):fs.readFileSync(path.join(root,file),'utf8');
  const start=source.indexOf('    const offset = this.viewOffset ?? VIEWMODEL_OFFSET;',source.indexOf('    const modelKick=' )-400);
  if(start<0)throw Error('Transform start not found');
  const end=source.indexOf(mode==='range'?'    const point = vector(followCrosshairDirection':'    this.audio.updateListener(this.camera.position',start);
  if(end<start)throw Error('Transform end not found');
  const block=source.slice(start,end);
  const apply=new Function('applyViewmodelRecoil','VIEWMODEL_OFFSET',`return function(view,player,death,deathAge,moving,speed,scoped){${block}}`)(module.applyViewmodelRecoil,{x:0,y:0,z:0});
  for(const sequence of fixture.sequences) {
   const model=new Group(),actor={grounded:true,alive:true,equipment:'ak47'};
   const context={sim:{slot:1,equipped:'ak47',time:0,grounded:true},elapsed:0,kick:0,
     viewAnimations:new Map(),viewAnimation:undefined,weaponRoot:model,viewRoot:model,viewAir:Air?new Air():undefined};
   const view={pitch:-sequence.camera[0]*Math.PI/180,yaw:sequence.camera[1]*Math.PI/180,roll:-sequence.camera[2]*Math.PI/180,
     weaponPitch:-sequence.punch[0]*.325*Math.PI/180,weaponYaw:sequence.punch[1]*.325*Math.PI/180,weaponRoll:-sequence.punch[2]*.325*Math.PI/180};
   const inverseCamera=sourceQuaternion(sequence.cameraQuaternion).invert();
   for(const sample of sequence.rows) {
    actor.grounded=context.sim.grounded=sample.grounded;context.elapsed=context.sim.time=sample.frame*sequence.dt;
    apply.call(context,view,actor,{weaponDrop:0},0,0,0,false);
    const expectedPosition=new Vector3(sample.origin[1],sample.origin[2],sample.origin[0]).multiplyScalar(.0254).applyQuaternion(inverseCamera);
    const expectedQuaternion=inverseCamera.clone().multiply(sourceQuaternion(sample.modelQuaternion));
    rows.push({mode,sequence:sequence.name,frame:sample.frame,grounded:sample.grounded,
      position:model.position.toArray(),quaternion:model.quaternion.toArray(),
      positionErrorMm:model.position.distanceTo(expectedPosition)*1000,angleErrorDegrees:angularError(model.quaternion,expectedQuaternion)});
   }
  }
 }
 const summary={cases:rows.length,maxPositionErrorMm:Math.max(...rows.map(r=>r.positionErrorMm)),maxAngleErrorDegrees:Math.max(...rows.map(r=>r.angleErrorDegrees)),
  byMode:Object.fromEntries(['range','duel'].map(mode=>[mode,{maxPositionErrorMm:Math.max(...rows.filter(r=>r.mode===mode).map(r=>r.positionErrorMm)),maxAngleErrorDegrees:Math.max(...rows.filter(r=>r.mode===mode).map(r=>r.angleErrorDegrees))}]))};
 const report={phase,baseline,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),summary,rows,
  limits:['Executes the exact production model-transform statements with supplied zero-velocity frame state, offsets and clip kick disabled.',
   'Does not run the renderer, movement prediction, native HUD scheduling or lifecycle. Browser tests separately exercise live engine wiring.']};
 fs.writeFileSync(path.join(root,'../native-audit/reports',`reaudit-viewmodel-air-${phase}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));
 if(phase==='after'&&(summary.maxPositionErrorMm>.00002||summary.maxAngleErrorDegrees>.00005))throw Error('Native AIR mismatch');
}finally{await vite.close();}
