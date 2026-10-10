// Serial capped run; imports production code, no browser or game.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {Euler, Quaternion} from 'three';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const phase=process.argv[2]??'after';if(!['before','after'].includes(phase))throw new Error('Use before or after');
const fixture=JSON.parse(fs.readFileSync(path.join(root,'docs/evidence/reaudit-viewmodel-native.json')));
const vite=await createServer({root,server:{middlewareMode:true},appType:'custom',logLevel:'error'});
const radians=Math.PI/180;
const sourceQuaternion=([x,y,z,w])=>new Quaternion(-y,z,-x,w).normalize();
const angularError=(a,b)=>2*Math.atan2(Math.hypot(...a.clone().invert().multiply(b).toArray().slice(0,3)),Math.abs(a.clone().invert().multiply(b).w))/radians;
try {
 const {recoilView,applyViewmodelRecoil}=await vite.ssrLoadModule('/src/range/view-recoil.ts');
 const rows=fixture.rows.map(row=>{
  const recoil={pitch:-row.physical[0],yaw:-row.physical[1],roll:-row.physical[2]};
  const v=recoilView(row.base[1]*radians,-row.base[0]*radians,recoil,{pitch:-row.kick[0],yaw:-row.kick[1]});
  // Prescribe the observed base roll to compare model motion separately from
  // the caller's damage/death/roll ownership. Neither input timing nor clips are fitted.
  v.roll=(-row.base[2]-row.kick[2]-row.physical[2]*.45)*radians;
  const nativeCamera=sourceQuaternion(row.cameraQuaternion),nativeModel=sourceQuaternion(row.modelQuaternion);
  const nativeRelative=nativeCamera.clone().invert().multiply(nativeModel);
  const actual=new Quaternion();
  if(applyViewmodelRecoil)applyViewmodelRecoil(actual,v);
  else actual.setFromEuler(new Euler(v.weaponPitch,v.weaponYaw,0,'XYZ'));
  return {base:row.base,physical:row.physical,kick:row.kick,nativeRelative:nativeRelative.toArray(),actual:actual.toArray(),errorDegrees:angularError(nativeRelative,actual)};
 });
 const summary={cases:rows.length,maxErrorDegrees:Math.max(...rows.map(r=>r.errorDegrees)),rmsErrorDegrees:Math.sqrt(rows.reduce((s,r)=>s+r.errorDegrees**2,0)/rows.length),
  levelAimExampleError:rows.find(r=>r.base.every(x=>x===0)&&r.physical[0]===-24&&r.kick.every(x=>x===0))?.errorDegrees};
 const report={phase,baseline:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),summary,rows,
  limits:['Native angle add and quaternion instructions with supplied base/physical/kick values; not rendered landmarks or a complete native procedural frame.',
   'Before uses the production shared helper plus the actual XYZ root assignment. After uses the production shared helper and quaternion application. No coefficient or clock is fitted.']};
 fs.writeFileSync(path.join(root,'../native-audit/reports',`reaudit-viewmodel-${phase}.json`),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify(summary,null,2));
 if(phase==='after'&&summary.maxErrorDegrees>.00005)throw new Error('Native viewmodel rotation mismatch');
}finally{await vite.close();}
