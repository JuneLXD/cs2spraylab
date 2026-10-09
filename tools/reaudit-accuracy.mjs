// Memory-capped offline bench. Run the companion native/demos Python tools first.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import {createServer}from'vite';import{parseKv3}from'./kv3.mjs';
const out=path.resolve('../native-audit/reports'),demos=JSON.parse(fs.readFileSync(path.join(out,'reaudit-accuracy-demos.json'))),native=JSON.parse(fs.readFileSync(path.join(out,'reaudit-accuracy-native.json')));
const raw=fs.readFileSync(path.join(out,'reaudit-combat/weapons.vdata'),'utf8'),data=parseKv3(raw),f=Math.fround,TICK=1/64,LOG=f(Math.log(10)),INDEX_DECAY=f(Math.exp(f(f(-2*LOG)*f(TICK))));
const names={ 'AK-47':'ak47','M4A4':'m4a4','M4A1-S':'m4a1s','Desert Eagle':'deagle','AUG':'aug','AWP':'awp','SSG 08':'ssg08','SCAR-20':'scar20','G3SG1':'g3sg1','USP-S':'usp','Glock-18':'glock','FAMAS':'famas','R8 Revolver':'revolver'};
const aliases={m4a4:'m4a1',m4a1s:'m4a1_silencer',galil:'galilar',sg553:'sg556',usp:'usp_silencer',zeus:'taser'};
const field={stand:'m_flInaccuracyStand',crouch:'m_flInaccuracyCrouch',jump:'m_flInaccuracyJump',land:'m_flInaccuracyLand',fire:'m_flInaccuracyFire',cycle:'m_flCycleTime',recovery:'m_flRecoveryTimeStand',recoveryCrouch:'m_flRecoveryTimeCrouch',recoveryFinal:'m_flRecoveryTimeStandFinal',recoveryCrouchFinal:'m_flRecoveryTimeCrouchFinal',recoveryStart:'m_nRecoveryTransitionStartBullet',recoveryEnd:'m_nRecoveryTransitionEndBullet'};
function stats(id,mode){const s=data[`weapon_${aliases[id]??id}`];return Object.fromEntries(Object.entries(field).map(([k,v])=>[k,f(Array.isArray(s[v])?s[v][mode??0]:s[v])]))}
function recovery(w,index,stance){
 if(stance==='air')return f(4*w.recoveryCrouch);
 const a=stance==='crouch'?w.recoveryCrouch:w.recovery,b=stance==='crouch'?w.recoveryCrouchFinal:w.recoveryFinal;
 if(b===-1)return a;const n=Math.trunc(index),lo=w.recoveryStart,hi=w.recoveryEnd;
 const t=lo===hi?+(n>=hi):Math.min(1,Math.max(0,f(f(n-lo)/f(hi-lo))));return f(a+f(t*f(b-a)));
}
function update(penalty,index,w,baseCycle,stance,time,last){
 penalty=f(penalty);index=f(index);time=f(time);last=f(last);
 const baseline=stance==='air'?f(w.stand+w.jump):stance==='crouch'?w.crouch:w.stand;
 const decay=f(Math.exp(f(f(LOG/recovery(w,index,stance))*f(-TICK))));
 penalty=penalty<baseline?baseline:f(baseline+f(f(penalty-baseline)*decay));
 if(index>0&&time>f(f(last+f(baseCycle))+f(TICK))){index=f(index*INDEX_DECAY);if(index<=f(.1))index=0;}
 return {penalty,index};
}
const max=xs=>xs.length?Math.max(...xs.map(Math.abs)):0;
const summary=rows=>({rows:rows.length,maxPenaltyError:max(rows.map(r=>r.penaltyError)),maxIndexError:max(rows.map(r=>r.indexError)),
 penaltyOver1e6:rows.filter(r=>Math.abs(r.penaltyError)>1e-6).length,indexOver1e6:rows.filter(r=>Math.abs(r.indexError)>1e-6).length});
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
const{gameData}=await vite.ssrLoadModule('/src/range/config.ts');const{WeaponRecovery}=await vite.ssrLoadModule('/src/range/ballistics.ts');
const grid=native.samples.map(r=>{const base=gameData.weapons[r.weapon],w=Object.fromEntries(Object.entries(r.mode?{...base,...base.alternate}:base).map(([k,v])=>[k,typeof v==='number'?f(v):v]));const candidate=update(r.penalty,r.index,w,base.cycle,r.stance,r.time,0);
 const before=new WeaponRecovery(w);before.time=r.time-TICK;before.lastShot=0;before.index=r.index;before.penalty=r.penalty;before.advance(TICK,r.stance==='crouch',r.stance==='air');
 return {...r,candidate,penaltyError:candidate.penalty-r.actual.penalty,indexError:candidate.index-r.actual.index,beforePenaltyError:before.penalty-r.actual.penalty,beforeIndexError:before.index-r.actual.index};});
const reports=[];
const exclusions={'native_reaudit_airduck_001.dem':'Capture interrupted by Alt+Space window-menu/minimization; retained for diagnosis only.'};
for(const d of demos.recordings){
 let carried=null,carriedTick=-1,carriedWeapon=null,carriedBefore=null;
 const rows=[],fires=new Map((d.events.weapon_fire??[]).map(e=>[e.tick,e])),reloads=new Set((d.events.weapon_reload??[]).map(e=>e.tick));
 for(let n=1;n<d.rows.length;n++){
  const a=d.rows[n-1],b=d.rows[n],id=names[b.active_weapon_name];if(!id||a.active_weapon_name!==b.active_weapon_name||b.tick-a.tick!==1||!Number.isFinite(a.accuracy_penalty))continue;
  const flags=b['CCSPlayerPawn.m_fFlags'],stance=!(flags&1)?'air':flags&2?'crouch':'stand';
  const mode=b.weapon_mode??b['Weapon.m_weaponMode']??0,w=stats(id,mode),base=stats(id,0),shot=fires.has(b.tick),reloadStart=reloads.has(b.tick)||(!a.is_in_reload&&b.is_in_reload),reloadManual=reloads.has(b.tick),reloadEnd=a.is_in_reload&&!b.is_in_reload,land=a.is_airborne&&!b.is_airborne;
  const priorMode=a.weapon_mode??a['Weapon.m_weaponMode']??0,modeChange=priorMode!==mode,shotMode=shot&&gameData.weapons[id].unzoomsAfterShot?priorMode:mode,shotStats=stats(id,shotMode);
  const deadline=b.next_primary_attack_tick/128+b.next_primary_attack_tick_ratio/64;
  const exactShot=shot?deadline-shotStats.cycle:null,deadlineValid=shot&&Math.abs(exactShot-b.last_shot_time)<.00015;
  const fractional=deadlineValid?Math.abs(exactShot*64-Math.round(exactShot*64))>1e-5:Math.abs(b.last_shot_time*64-Math.round(b.last_shot_time*64))>1e-5;
  const fallVelocity=a['CCSPlayerPawn.CCSPlayer_MovementServices.m_flFallVelocity'];
  const baselineBefore=new WeaponRecovery({...gameData.weapons[id],...w});baselineBefore.time=a.game_time;baselineBefore.lastShot=a.last_shot_time;baselineBefore.index=a.fl_recoil_idx;baselineBefore.penalty=a.accuracy_penalty;
  if(land)baselineBefore.land(fallVelocity);
  baselineBefore.advance(TICK/2,stance==='crouch',stance==='air');baselineBefore.advance(TICK/2,stance==='crouch',stance==='air');if(shot)baselineBefore.fire(Math.max(0,b.game_time-exactShot));
  function candidateStep(state) {
   let {penalty,index,last}=state;
   if(land)penalty=f(f(penalty)+f(w.land*f(fallVelocity)));
   if(shot&&fractional){penalty=f(f(penalty)+shotStats.fire);index=f(f(index)+1);last=b.last_shot_time;}
   if(reloadStart&&!reloadManual)index=f(f(index)+1);
   const value=update(penalty,index,reloadManual?stats(id,priorMode):w,base.cycle,stance,b.game_time,last);
   if(reloadStart&&reloadManual)value.index=f(value.index+1);
   if(shot&&!fractional){value.penalty=f(value.penalty+shotStats.fire);value.index=f(value.index+1);last=b.last_shot_time;}
   if(reloadEnd)value.index=0;
   return {...value,last};
  }
  const seed={penalty:a.accuracy_penalty,index:a.fl_recoil_idx,last:a.last_shot_time};
  const candidate=candidateStep(seed);
  const cumulativeReset=carriedTick!==a.tick||carriedWeapon!==id;
  if(cumulativeReset){
   carried={...seed};carriedBefore=new WeaponRecovery({...gameData.weapons[id],...stats(id,priorMode)});
   carriedBefore.time=a.game_time;carriedBefore.lastShot=a.last_shot_time;carriedBefore.index=a.fl_recoil_idx;carriedBefore.penalty=a.accuracy_penalty;
  }
  carried=candidateStep(carried);carriedTick=b.tick;carriedWeapon=id;
  carriedBefore.setParameters({...gameData.weapons[id],...w});
  if(land)carriedBefore.land(fallVelocity);
  carriedBefore.advance(TICK/2,stance==='crouch',stance==='air');carriedBefore.advance(TICK/2,stance==='crouch',stance==='air');
  if(shot)carriedBefore.fire(Math.max(0,b.game_time-exactShot));
  // Fall speed is quantized to 1/64 u/s in the network field. This interval
  // tests the landing order without fitting an unknown exact speed to output.
  const landingTolerance=land?w.land/64+3e-8:0;
  const row={tick:b.tick,gameTime:b.game_time,weapon:id,mode,shot,exactShot,deadlineValid,fractional:shot?fractional:null,reloadStart,reloadManual,reloadEnd,land,modeChange,stance,flags,
    native:{penalty:b.accuracy_penalty,index:b.fl_recoil_idx},fallVelocity:land?fallVelocity:null,landingTolerance,cumulativeReset,cumulative:{...carried},cumulativeBefore:{penalty:carriedBefore.penalty,index:carriedBefore.index},cumulativePenaltyError:carried.penalty-b.accuracy_penalty,cumulativeIndexError:carried.index-b.fl_recoil_idx,cumulativeBeforePenaltyError:carriedBefore.penalty-b.accuracy_penalty,cumulativeBeforeIndexError:carriedBefore.index-b.fl_recoil_idx,before:{penalty:baselineBefore.penalty,index:baselineBefore.index},candidate,
    penaltyError:candidate.penalty-b.accuracy_penalty,indexError:candidate.index-b.fl_recoil_idx,beforePenaltyError:baselineBefore.penalty-b.accuracy_penalty,beforeIndexError:baselineBefore.index-b.fl_recoil_idx};
  rows.push(row);
 }
 const stable=rows.filter(r=>!r.land&&!r.modeChange&&!r.reloadStart&&!r.reloadEnd);
 reports.push({demo:d.demo,sha256:d.sha256,exclusion:exclusions[d.demo]??(rows.length?null:'No usable consecutive player rows.'),summary:summary(rows),cumulative:{maxPenaltyError:max(rows.map(r=>r.cumulativePenaltyError)),maxIndexError:max(rows.map(r=>r.cumulativeIndexError)),resets:rows.filter(r=>r.cumulativeReset).length},cumulativeBefore:{maxPenaltyError:max(rows.map(r=>r.cumulativeBeforePenaltyError)),maxIndexError:max(rows.map(r=>r.cumulativeBeforeIndexError))},stable:summary(stable),shots:summary(rows.filter(r=>r.shot)),
  reloadStarts:summary(rows.filter(r=>r.reloadStart)),reloadEnds:summary(rows.filter(r=>r.reloadEnd)),modeChanges:summary(rows.filter(r=>r.modeChange)),landings:summary(rows.filter(r=>r.land)),
  before:{maxStablePenaltyError:max(stable.map(r=>r.beforePenaltyError)),maxStableIndexError:max(stable.map(r=>r.beforeIndexError))},
  mismatches:rows.filter(r=>Math.abs(r.penaltyError)>Math.max(1e-6,r.landingTolerance)||Math.abs(r.indexError)>1e-6),rows});
}
const report={coverage:{acceptedRecordings:reports.filter(d=>!d.exclusion).length,acceptedRows:reports.filter(d=>!d.exclusion).reduce((n,d)=>n+d.rows.length,0),acceptedShots:reports.filter(d=>!d.exclusion).reduce((n,d)=>n+d.shots.rows,0),excluded:reports.filter(d=>d.exclusion).map(d=>({demo:d.demo,reason:d.exclusion})),rawWeaponNames:Object.fromEntries(demos.recordings.map(d=>[d.demo,[...new Set(d.rows.map(r=>r.active_weapon_name))]]))},method:'One-step native snapshot replay plus independently bounded native instruction grid. Candidate ordering is an inference tested against observed tick rows, not an emulation of item-postframe or movement ordering.',productionComparison:'Calls current WeaponRecovery at two 1/128 s advances per native tick with captured events. This is a class replay, not an end-to-end simulation/input replay.',nativeGridScope:'35 supplied trainer parameter sets x both supplied modes; USP/M4A1-S trainer defaults select silenced values. These are arithmetic inputs, not native gameplay captures of 70 modes. Turning/stack/ladders are outside this bounded grid.',serverSha256:native.serverSha256,vdataSha256:crypto.createHash('sha256').update(raw).digest('hex'),grid:{summary:summary(grid),before:{maxPenaltyError:max(grid.map(r=>r.beforePenaltyError)),maxIndexError:max(grid.map(r=>r.beforeIndexError))},mismatches:grid.filter(r=>Math.abs(r.penaltyError)>1e-7||Math.abs(r.indexError)>1e-7),samples:grid},demos:reports};
fs.writeFileSync(path.join(out,'reaudit-accuracy-results.json'),JSON.stringify(report,null,2)+'\n');fs.writeFileSync(path.join(out,'reaudit-accuracy-summary.json'),JSON.stringify({...report,grid:{...report.grid,samples:undefined},demos:reports.map(({rows,mismatches,...d})=>({...d,firstMismatches:mismatches.slice(0,12)}))},null,2)+'\n');
if(report.grid.mismatches.length||reports.some(d=>!d.exclusion&&(d.mismatches.length||d.cumulative.maxIndexError>1e-6||d.cumulative.maxPenaltyError>1e-5||d.rows.some(r=>r.shot&&!r.deadlineValid))))throw new Error('Native accuracy replay drift; inspect retained mismatches.');
const portable={...report,grid:{...report.grid,samples:undefined},demos:reports.map(({rows,mismatches,...d})=>({...d,transitionExamples:rows.filter(r=>r.modeChange||r.reloadStart||r.land||r.shot&&!r.fractional).map(({before,cumulativeBefore,...r})=>r)}))};
fs.writeFileSync('docs/evidence/reaudit-accuracy-summary.json',JSON.stringify(portable,null,2)+'\n');
console.log(JSON.stringify({grid:report.grid.summary,demos:reports.map(({demo,summary,before,mismatches})=>({demo,summary,before,mismatchTicks:mismatches.map(r=>r.tick)}))}));
}finally{await vite.close();}
