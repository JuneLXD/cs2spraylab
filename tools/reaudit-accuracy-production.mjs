// Run under the project memory cap after reaudit-accuracy-demos.py/native.py.
// Historical before metrics remain in reaudit-accuracy-results.json unchanged.
import fs from 'node:fs';import {createHash}from'node:crypto';import path from 'node:path';import {createServer}from'vite';import{parseKv3}from'./kv3.mjs';
const out=path.resolve('../native-audit/reports'),read=name=>JSON.parse(fs.readFileSync(path.join(out,name)));
const demos=read('reaudit-accuracy-demos.json'),native=read('reaudit-accuracy-native.json'),old=read('reaudit-accuracy-results.json');
const data=parseKv3(fs.readFileSync(path.join(out,'reaudit-combat/weapons.vdata'),'utf8'));
const names={'AK-47':'ak47','M4A4':'m4a4','M4A1-S':'m4a1s','Desert Eagle':'deagle','AUG':'aug','AWP':'awp','SSG 08':'ssg08','SCAR-20':'scar20','G3SG1':'g3sg1','USP-S':'usp','Glock-18':'glock','FAMAS':'famas','R8 Revolver':'revolver'};
const aliases={m4a4:'m4a1',m4a1s:'m4a1_silencer',usp:'usp_silencer'};
const field={stand:'m_flInaccuracyStand',crouch:'m_flInaccuracyCrouch',jump:'m_flInaccuracyJump',land:'m_flInaccuracyLand',fire:'m_flInaccuracyFire',cycle:'m_flCycleTime',recovery:'m_flRecoveryTimeStand',recoveryCrouch:'m_flRecoveryTimeCrouch',recoveryFinal:'m_flRecoveryTimeStandFinal',recoveryCrouchFinal:'m_flRecoveryTimeCrouchFinal',recoveryStart:'m_nRecoveryTransitionStartBullet',recoveryEnd:'m_nRecoveryTransitionEndBullet'};
const max=xs=>xs.reduce((a,b)=>Math.max(a,Math.abs(b)),0),f=Math.fround;
const vite=await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try{
 const{gameData}=await vite.ssrLoadModule('/src/range/config.ts'),{WeaponRecovery}=await vite.ssrLoadModule('/src/range/ballistics.ts');
 function stats(id,mode){const raw=data[`weapon_${aliases[id]??id}`];return {...gameData.weapons[id],...Object.fromEntries(Object.entries(field).map(([key,field])=>[key,f(Array.isArray(raw[field])?raw[field][mode]:raw[field])]))};}
 const grid=native.samples.map(r=>{
  const base=gameData.weapons[r.weapon],state=new WeaponRecovery(r.mode?{...base,...base.alternate}:base,undefined,base.cycle);
  state.penalty=f(r.penalty);state.index=f(r.index);state.advance(0,r.stance==='crouch',r.stance==='air',true,r.time);state.lastShot=-r.time;state.updateAccuracy(r.time);
  return {penaltyError:state.penalty-r.actual.penalty,indexError:state.index-r.actual.index};
 });
 const reports=[];
 for(const d of demos.recordings){
  if(d.rows.some(r=>r.active_weapon_name==='R8 Revolver')){reports.push({demo:d.demo,sha256:d.sha256,exclusion:'R8 follow-up excluded at user request',rows:0,shots:0,mismatches:[],samples:[]});continue;}
  const fires=new Set((d.events.weapon_fire??[]).map(e=>e.tick)),reloads=new Set((d.events.weapon_reload??[]).map(e=>e.tick));
  const rows=[];let state=null,priorTick=-1,priorWeapon=null;
  for(let n=1;n<d.rows.length;n++){
   const a=d.rows[n-1],b=d.rows[n],id=names[b.active_weapon_name];
   if(!id||a.active_weapon_name!==b.active_weapon_name||b.tick!==a.tick+1||!Number.isFinite(a.accuracy_penalty))continue;
   const mode=b.weapon_mode??b['Weapon.m_weaponMode']??0,priorMode=a.weapon_mode??a['Weapon.m_weaponMode']??0;
   const w=stats(id,mode),base=stats(id,0),shot=fires.has(b.tick),manual=reloads.has(b.tick),reloadStart=manual||(!a.is_in_reload&&b.is_in_reload),reloadEnd=a.is_in_reload&&!b.is_in_reload;
   const land=a.is_airborne&&!b.is_airborne,flags=b['CCSPlayerPawn.m_fFlags'],crouch=!!(flags&2),air=!(flags&1);
   const shotMode=shot&&gameData.weapons[id].unzoomsAfterShot?priorMode:mode,shotStats=stats(id,shotMode);
   const exactShot=shot?b.next_primary_attack_tick/128+b.next_primary_attack_tick_ratio/64-shotStats.cycle:null;
   const reset=priorTick!==a.tick||priorWeapon!==id;
   if(reset){state=new WeaponRecovery(stats(id,priorMode),undefined,base.cycle);state.time=a.game_time;state.penalty=f(a.accuracy_penalty);state.index=f(a.fl_recoil_idx);state.lastShot=a.last_shot_time;state.advance(0,false,false,false,a.game_time);}
   // Raw mode and stance changes are exogenous replay inputs, not simulated buttons.
   state.setParameters(manual?stats(id,priorMode):w);
   if(land)state.land(a['CCSPlayerPawn.CCSPlayer_MovementServices.m_flFallVelocity']);
   state.advance(1/128,crouch,air,true,b.game_time-1/128);state.advance(1/128,crouch,air,true,b.game_time);
   if(reloadStart)state.reloadStarted(!manual);
   if(shot){state.setParameters(shotStats);state.beforeShot(b.game_time-exactShot);state.fire(b.game_time-exactShot);}
   state.setParameters(w);state.finishAccuracy();
   if(reloadEnd)state.reloadFinished();
   priorTick=b.tick;priorWeapon=id;
   rows.push({tick:b.tick,time:b.game_time,weapon:id,mode,shot,exactShot,reloadStart,reloadEnd,manual,land,reset,
    native:{penalty:b.accuracy_penalty,index:b.fl_recoil_idx},production:{penalty:state.penalty,index:state.index},penaltyError:state.penalty-b.accuracy_penalty,indexError:state.index-b.fl_recoil_idx});
  }
  const exclusion=d.demo==='native_reaudit_airduck_001.dem'?'Interrupted capture':/^native_reaudit_r8_00[12]\.dem$/.test(d.demo)?'Wrong selected weapon: AK, not R8':!rows.length?'No usable rows':null;
  const before=old.demos.find(r=>r.demo===d.demo)?.cumulativeBefore??null;
  reports.push({demo:d.demo,sha256:d.sha256,exclusion,rows:rows.length,shots:rows.filter(r=>r.shot).length,decodedWeapons:[...new Set(rows.map(r=>r.weapon))],before,
   maxPenaltyError:max(rows.map(r=>r.penaltyError)),maxIndexError:max(rows.map(r=>r.indexError)),mismatches:rows.filter(r=>Math.abs(r.penaltyError)>1e-5||Math.abs(r.indexError)>1e-6),samples:rows});
 }
 const report={serverSha256:native.serverSha256,beforeBaseline:'cb47b69',beforeArtifactSha256:createHash('sha256').update(fs.readFileSync(path.join(out,'reaudit-accuracy-results.json'))).digest('hex'),method:'Current production WeaponRecovery cumulative replay; original captured mode/stance/shot/reload/landing events are exogenous. This is not an input-command replay. The bounded arithmetic grid invokes the private native-update body directly; engine ordering is tested separately.',grid:{cases:grid.length,maxPenaltyError:max(grid.map(r=>r.penaltyError)),maxIndexError:max(grid.map(r=>r.indexError))},demos:reports};
 fs.writeFileSync(path.join(out,'reaudit-accuracy-production.json'),JSON.stringify(report)+'\n');
 const summary={...report,demos:reports.map(({samples,mismatches,...r})=>({...r,mismatchCount:mismatches.length,firstMismatches:mismatches.slice(0,6)}))};
 fs.writeFileSync('docs/evidence/reaudit-accuracy-production.json',JSON.stringify(summary,null,2)+'\n');
 console.log(JSON.stringify(summary));
 if(report.grid.maxPenaltyError||report.grid.maxIndexError||reports.some(r=>!r.exclusion&&r.mismatches.length))process.exitCode=1;
}finally{await vite.close()}
