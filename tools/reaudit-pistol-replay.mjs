// Compare actual WeaponRecovery to historical anchors. The table match is an
// inverse reconstruction, not an independently recorded native command seed.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire, Module} from 'node:module';
import {execFileSync} from 'node:child_process';
const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];
if(!['--repo','--native','--output'].every(n=>args.includes(n)))throw Error('Use --repo PATH --native FILE[,FILE] --output NEW.json');
const repo=path.resolve(get('--repo')),output=path.resolve(get('--output'));
if(fs.existsSync(output))throw Error('Output already exists');
const hash=x=>createHash('sha256').update(x).digest('hex');
const require=createRequire(repo+'/package.json'),{buildSync}=require('esbuild');
const built=buildSync({stdin:{contents:`export {gameData} from './src/range/config';export {WeaponRecovery} from './src/range/ballistics';export {PunchRecovery} from './src/range/punch-recovery';`,resolveDir:repo},absWorkingDir:repo,bundle:true,platform:'node',format:'cjs',write:false,metafile:true,logLevel:'silent'});
const mod=new Module(repo+'/.pistol-selector-probe.cjs');mod.filename=repo+'/.pistol-selector-probe.cjs';mod.paths=Module._nodeModulePaths(repo);mod._compile(built.outputFiles[0].text,mod.filename);
const {gameData,WeaponRecovery,PunchRecovery}=mod.exports;
const tablePath=path.join(repo,'src/range/native-table-fixture.json'),tables=JSON.parse(fs.readFileSync(tablePath));
const paths=get('--native').split(',').map(p=>path.resolve(p));
const convert=([pitch,yaw,roll])=>({pitch:-pitch,yaw:-yaw,roll:-roll});
const anchor=p=>p.m_predictableBaseTick/128+p.m_predictableBaseTickInterpAmount/64;
const err=(a,b)=>Math.hypot(a.pitch-b.pitch,a.yaw-b.yaw);
const recordings=[];
for(const filename of paths)for(const record of JSON.parse(fs.readFileSync(filename)).recordings){
 const samples=[],excluded=[];
 for(const shot of record.shots){
  if(!shot.fireEvent||shot.before.active_weapon_ammo-shot.after.active_weapon_ammo!==1){excluded.push({tick:shot.after.tick,reason:'Missing fire event or one-round ammo decrease'});continue;}
  const a=shot.before,b=shot.after,pa=a.punch,pb=b.punch;
  if(!pa.m_predictableBaseAngle||!pb.m_predictableBaseAngle){excluded.push({tick:b.tick,reason:'Missing native anchor'});continue;}
  const elapsed=anchor(pb)-anchor(pa),index=b.fl_recoil_idx-1;
  if(elapsed<0||index<0){excluded.push({tick:b.tick,reason:'Invalid delta/index'});continue;}
  const priorAngle=convert(pa.m_predictableBaseAngle),priorVelocity=convert(pa.m_predictableBaseAngleVel);
  const actualAngle=convert(pb.m_predictableBaseAngle),actualVelocity=convert(pb.m_predictableBaseAngleVel);
  const prior=new PunchRecovery(priorAngle,priorVelocity),carried=prior.velocity(elapsed);
  const reconstructedImpulse={pitch:actualVelocity.pitch-carried.pitch,yaw:actualVelocity.yaw-carried.yaw};
  const candidates=tables[shot.weapon].map((entry,tableIndex)=>{
   const radians=Math.fround(entry.angle*Math.fround(Math.PI/180));
   const impulse={pitch:Math.fround(Math.cos(radians)*entry.magnitude),yaw:Math.fround(Math.sin(radians)*entry.magnitude)};
   return {tableIndex,impulse,error:err(impulse,reconstructedImpulse)};
  }).sort((a,b)=>a.error-b.error);
  const best=candidates[0],matches=candidates.filter(c=>c.error<1e-4).map(c=>c.tableIndex);
  const state=new WeaponRecovery(gameData.weapons[shot.weapon]);
  // Explicit supplied-state bench; these private fields are not an input replay.
  Object.assign(state,{punch:prior.clone(),anchorAt:0,time:elapsed,index,penalty:a.accuracy_penalty});
  const expectedIndex=Math.floor(index)&63;
  state.fire(0,{seed:best.tableIndex});
  const nativePunch=new PunchRecovery(actualAngle,actualVelocity);
  const trace=[0,1/128,1/64,.05,.1,.2,.35,.5].map(t=>{
   const actual=state.predict(t),reference=nativePunch.sample(t);
   const expected={pitch:reference.pitch*2,yaw:reference.yaw*2};
   return {t,actual,expected,error:err(actual,expected)};
  });
  samples.push({weapon:shot.weapon,tick:b.tick,elapsed,inferredPreShotIndex:index,
   actualAngle,actualVelocity,priorAngle,priorVelocity,reconstructedImpulse,
   reconstructedTableIndex:best.tableIndex,matchingTableIndices:matches,tableMatchError:best.error,
   secondCandidateError:candidates[1].error,oldTableIndex:expectedIndex,
   result:{angle:state.angle,velocity:state.velocity,index:state.index,penalty:state.penalty,viewPunch:state.lastViewPunch},
   angleError:err(state.angle,actualAngle),velocityError:err(state.velocity,actualVelocity),trace,
   boundary:'Supplied prior native state and inverse-reconstructed table index. This validates conditional selection and carry, not native seed prediction or cumulative input replay.'});
 }
 recordings.push({demo:record.demo,sha256:record.sha256,
  header:Object.fromEntries(['patch_version','map_name','demo_version_name'].map(k=>[k,record.header[k]])),samples,excluded,
  summary:{cases:samples.length,ambiguousMatches:samples.filter(s=>s.matchingTableIndices.length!==1).length,
   maxTableMatchError:Math.max(0,...samples.map(s=>s.tableMatchError)),
   maxAngleError:Math.max(0,...samples.map(s=>s.angleError)),
   maxVelocityError:Math.max(0,...samples.map(s=>s.velocityError)),
   maxTrajectoryError:Math.max(0,...samples.flatMap(s=>s.trace.map(t=>t.error)))}});
}
const report={method:'Actual WeaponRecovery with supplied historical anchors and inverse-reconstructed indices; no native seed prediction, native execution, or free-running input replay.',
 commit:execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),probeSha256:hash(fs.readFileSync(import.meta.filename)),
 sourceHashes:Object.fromEntries(Object.keys(built.metafile.inputs).filter(p=>p!=='<stdin>').sort().map(p=>[p,hash(fs.readFileSync(path.resolve(repo,p)))])),
 tableFixtureSha256:hash(fs.readFileSync(tablePath)),inputHashes:Object.fromEntries(paths.map(p=>[p,hash(fs.readFileSync(p))])),recordings};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(recordings.map(r=>({demo:r.demo,...r.summary,pistolIndices:r.samples.filter(s=>['glock','usp','deagle'].includes(s.weapon)).map(s=>({tick:s.tick,index:s.reconstructedTableIndex,matching:s.matchingTableIndices.length,error:s.tableMatchError}))})),null,2));
