// Run under systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0.
// First run reaudit-combat-native.py and export scripts/weapons.vdata_c with VRF.
// Writes per-tick comparisons and complete per-weapon grids, never just a pass flag.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
import {parseKv3} from './kv3.mjs';

const directory = path.resolve('../native-audit/reports/reaudit-combat');
const native = JSON.parse(fs.readFileSync(path.join(directory, 'native.json')));
const raw = fs.readFileSync(path.join(directory, 'weapons.vdata'), 'utf8');
const vdata = parseKv3(raw);
const aliases = {m4a4:'m4a1',m4a1s:'m4a1_silencer',galil:'galilar',sg553:'sg556',usp:'usp_silencer',zeus:'taser'};
const fields = {damage:'m_nDamage',penetration:'m_flPenetration',armorRatio:'m_flArmorRatio',headshotMultiplier:'m_flHeadshotMultiplier',
  range:'m_flRange',rangeModifier:'m_flRangeModifier',magazine:'m_iMaxClip1',cycle:'m_flCycleTime',speed:'m_flMaxSpeed',deploy:'m_flDeployDuration',
  reload:'m_flDisallowAttackAfterReloadStartDuration',spread:'m_flSpread',stand:'m_flInaccuracyStand',crouch:'m_flInaccuracyCrouch',
  move:'m_flInaccuracyMove',fire:'m_flInaccuracyFire',jump:'m_flInaccuracyJump',jumpInitial:'m_flInaccuracyJumpInitial',jumpApex:'m_flInaccuracyJumpApex',
  land:'m_flInaccuracyLand',recovery:'m_flRecoveryTimeStand',recoveryFinal:'m_flRecoveryTimeStandFinal',recoveryCrouch:'m_flRecoveryTimeCrouch',
  recoveryCrouchFinal:'m_flRecoveryTimeCrouchFinal',recoveryStart:'m_nRecoveryTransitionStartBullet',recoveryEnd:'m_nRecoveryTransitionEndBullet',
  recoilSeed:'m_nRecoilSeed',recoilAngle:'m_flRecoilAngle',recoilVariance:'m_flRecoilAngleVariance',recoilMagnitude:'m_flRecoilMagnitude',
  recoilMagnitudeVariance:'m_flRecoilMagnitudeVariance'};
const vite = await createServer({server:{middlewareMode:true},appType:'custom',logLevel:'error'});
try {
  const {gameData,weaponNames} = await vite.ssrLoadModule('/src/range/config.ts');
  const {WeaponRecovery,movementInaccuracy,airborneInaccuracy,recoveryTime} = await vite.ssrLoadModule('/src/range/ballistics.ts');
  const {WeaponActions,NativeReloadState} = await vite.ssrLoadModule('/src/range/weapon-actions.ts');
  const {DuelWeaponState} = await vite.ssrLoadModule('/src/range/duel/weapon-state.ts');
  const {resolveDamage} = await vite.ssrLoadModule('/src/range/duel/damage.ts');
  const {damageThroughSurface} = await vite.ssrLoadModule('/src/range/duel/penetration.ts');
  const {sampleShotSpread} = await vite.ssrLoadModule('/src/range/shot-model.ts');
  const {sourceRandom} = await vite.ssrLoadModule('/src/range/recoil.ts');
  const {PunchRecovery} = await vite.ssrLoadModule('/src/range/punch-recovery.ts');
  const {applyTagging,recoverTagging} = await vite.ssrLoadModule('/src/range/tagging.ts');
  const report = {baseline:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),
    vdataSha256:crypto.createHash('sha256').update(raw).digest('hex'),binaries:native.binaries,
    statComparisons:0,statMismatches:[],weapons:{},demos:[],spread:[],penetration:[],tagging:[]};
  const taggingData=JSON.parse(fs.readFileSync('src/range/tagging-data.json','utf8'));
  report.taggingComparisons=0;report.taggingMismatches=[];
  for(const [id,values]of Object.entries(taggingData.weapons)){
    const data=vdata[`weapon_${aliases[id]??id}`],slot=['usp','m4a1s'].includes(id)?1:0;
    const expected={large:data.m_flFlinchVelocityModifierLarge,small:data.m_flFlinchVelocityModifierSmall,
      speed:Array.isArray(data.m_flMaxSpeed)?data.m_flMaxSpeed[slot]:data.m_flMaxSpeed};
    for(const [key,value]of Object.entries(expected)){report.taggingComparisons++;if(values[key]!==value)report.taggingMismatches.push({id,key,expected:value,actual:values[key]});}
  }
  const command = {forward:0,right:0,jump:false,crouch:false,walk:false,fireHeld:false,firePressed:false,reloadPressed:false};
  const actor = {position:{x:0,y:1.6,z:0},yaw:0,pitch:0,velocity:{x:0,z:0},feet:0,verticalVelocity:0,grounded:true};
  for (const [id,base] of Object.entries(gameData.weapons)) {
    const data = vdata[`weapon_${aliases[id]??id}`];
    for (const [mode,stats] of [['primary',base],['alternate',base.alternate]]) {
      const slot = mode==='alternate'||['usp','m4a1s'].includes(id)?1:0;
      for (const [key,field] of Object.entries(fields)) {
        const expected=Array.isArray(data[field])?data[field][slot]:data[field];report.statComparisons++;
        if(stats[key]!==expected)report.statMismatches.push({id,mode,key,expected,actual:stats[key]});
      }
    }
    const controls={fullAuto:data.m_bIsFullAuto,zoomLevels:data.m_nZoomLevels,hideWhenZoomed:data.m_bHideViewModelWhenZoomed,
      hasBurst:data.m_bHasBurstMode,burstCycle:data.m_flCycleTimeWhenInBurstMode,burstInterval:data.m_flTimeBetweenBurstShots,
      unzoomsAfterShot:data.m_bUnzoomsAfterShot,isRevolver:data.m_bIsRevolver,showCrosshair:data.m_bShowCrosshair??true,
      zoomFov:[data.m_nZoomFOV1,data.m_nZoomFOV2],zoomTime:[data.m_flZoomTime0,data.m_flZoomTime1,data.m_flZoomTime2],
      pellets:data.m_nNumBullets,reserveAsClips:data.m_bReserveAmmoAsClips??false,
      reserve:data.m_nPrimaryReserveAmmoMax*(data.m_bReserveAmmoAsClips?data.m_iMaxClip1:1),
      reloadsSingleShells:data.m_bReloadsSingleShells??false,spreadSeed:data.m_nSpreadSeed};
    for(const [key,expected]of Object.entries(controls)){report.statComparisons++;if(JSON.stringify(base[key])!==JSON.stringify(expected))report.statMismatches.push({id,key,expected,actual:base[key]});}
    const actions = new WeaponActions(id), zoom=[];
    for(let n=0;n<base.zoomLevels;n++){actions.secondary(n);zoom.push({level:actions.zoom,fov:actions.horizontalFov,stand:actions.stats.stand,crouch:actions.stats.crouch,speed:actions.stats.speed});}
    const reload=[];
    for(const empty of [false,true])for(const silent of [false,true]){
      const r=new NativeReloadState(id);r.ammo=empty?0:Math.max(0,base.magazine-1);const initial=r.ammo;r.start(0,silent);
      const phases=[];let previous=r.ammo;
      for(let i=0;i<=128*60&&r.active;i++){const at=i/128;r.advance(at,silent);if(r.ammo!==previous){phases.push({at,ammo:r.ammo});previous=r.ammo;}}
      const events=r.drainActionEvents();reload.push({empty,silent,initial,insertions:phases,events});
    }
    const fire=[];
    for(const alternate of [false,true]){
      const state=new DuelWeaponState(id,sourceRandom(1),{spread:false});if(alternate){state.actions.secondary(0);if(id==='revolver')state.actions.alternateFire=true;}
      const shots=[];for(let i=0;i<=256&&shots.length<8;i++){
        const at=i/128,cmd={...command,fireHeld:!alternate||id!=='revolver',firePressed:i===0&&(!alternate||id!=='revolver'),secondaryHeld:alternate&&id==='revolver',secondaryPressed:alternate&&id==='revolver'&&i===0};
        if(state.advance(at,i?1/128:0,cmd,actor))shots.push(at);
      }fire.push({alternate,shots});
    }
    const r=new WeaponRecovery(base);r.fire();const recovery=[];
    for(let i=1;i<=128;i++){r.advance(1/128);if([8,16,32,64,128].includes(i))recovery.push({time:i/128,index:r.index,penalty:r.penalty,recoil:r.recoil});}
    report.weapons[id]={rawReloadPenalty:data.m_flInaccuracyReload,rawLadderPenalty:data.m_flInaccuracyLadder,
      zoom,fire,reload,recovery,stand:base.stand,crouch:base.crouch,
      movement:[0,.34,.52,.75,.95,1].map(ratio=>({ratio,run:movementInaccuracy(base,ratio),walk:movementInaccuracy(base,ratio,true)})),
      airborne:[0,75,151,301.993,603.986].map(speed=>({speed,inaccuracy:airborneInaccuracy(base,speed)})),
      recoveryTimes:[0,2,3,4,5,10].map(index=>({index,stand:recoveryTime(base,index,false),crouch:recoveryTime(base,index,true),air:recoveryTime(base,index,false,true)})),
      damage:['head','chest','stomach','arm','leg'].flatMap(group=>[0,12.7,30].flatMap(distance=>[0,1,100].map(armor=>({group,distance,armor,...resolveDamage(id,group,distance,armor,true)}))))};
  }
  const ids = Object.fromEntries(Object.entries(weaponNames).map(([id,label])=>[label,id]));
  Object.assign(ids,{'M4A1-S':'m4a1s','USP-S':'usp','R8 Revolver':'revolver'});
  for(const capture of native.recordings){
    const comparisons=[],shots=[];const actualWeapons=[...new Set(capture.rows.map(r=>r.active_weapon_name))];
    for(let i=1;i<capture.rows.length;i++){
      const a=capture.rows[i-1],b=capture.rows[i],id=ids[b.active_weapon_name];if(!id||a.active_weapon_name!==b.active_weapon_name||b.tick-a.tick!==1)continue;
      const base=gameData.weapons[id],stats=b.zoom_lvl>0?{...base,...base.alternate}:base;
      if(!Number.isFinite(a.accuracy_penalty)||!Number.isFinite(b.accuracy_penalty))continue;
      const shot=b.last_shot_time!==a.last_shot_time&&b.last_shot_time>0;
      const w=new WeaponRecovery(stats);w.penalty=a.accuracy_penalty;w.index=a.fl_recoil_idx;w.time=a.game_time;w.lastShot=a.last_shot_time;
      w.advance(1/64,b.duck_amount>=.95,b.is_airborne);if(shot)w.fire();
      const nativeOrder=new WeaponRecovery(stats);nativeOrder.penalty=a.accuracy_penalty+(shot?stats.fire:0);nativeOrder.index=a.fl_recoil_idx+(shot?1:0);
      nativeOrder.time=a.game_time;nativeOrder.lastShot=shot?b.last_shot_time:a.last_shot_time;nativeOrder.advance(1/64,b.duck_amount>=.95,b.is_airborne);
      comparisons.push({tick:b.tick,id,shot,airborne:b.is_airborne,duck:b.duck_amount,penalty:b.accuracy_penalty,trainerPenalty:w.penalty,
        nativeFireThenDecayPenalty:nativeOrder.penalty,penaltyError:w.penalty-b.accuracy_penalty,index:b.fl_recoil_idx,trainerIndex:w.index,indexError:w.index-b.fl_recoil_idx});
      if(shot)shots.push({tick:b.tick,at:b.last_shot_time,weapon:id,baseAngle:b['CCSPlayerPawn.CCSPlayer_AimPunchServices.m_predictableBaseAngle'],
        baseVelocity:b['CCSPlayerPawn.CCSPlayer_AimPunchServices.m_predictableBaseAngleVel'],baseTick:b['CCSPlayerPawn.CCSPlayer_AimPunchServices.m_predictableBaseTick'],
        baseFraction:b['CCSPlayerPawn.CCSPlayer_AimPunchServices.m_predictableBaseTickInterpAmount']});
    }
    const measured=comparisons.filter(r=>!r.airborne&&r.duck===0),fireRows=measured.filter(r=>r.shot);
    const anchors=[];
    for(let i=1;i<shots.length;i++){
      const a=shots[i-1],b=shots[i];if(a.weapon!==b.weapon||!a.baseAngle||!a.baseVelocity)continue;
      const dt=(b.baseTick-a.baseTick)/128+(b.baseFraction-a.baseFraction)/64;
      const toVector=([pitch,yaw,roll])=>({pitch,yaw,roll});
      const p=new PunchRecovery(toVector(a.baseAngle),toVector(a.baseVelocity));
      const expected=p.sample(dt+1/128),actual=toVector(b.baseAngle);
      anchors.push({tick:b.tick,dt,native:actual,trainer:expected,error:Math.hypot(expected.pitch-actual.pitch,expected.yaw-actual.yaw)});
    }
    // The fresh held burst begins after a >1 second rest. Reproduce the actual
    // live weapon class, including server-tick shot processing, rather than only
    // calling WeaponRecovery at idealized 0.1-second intervals.
    const heldReplay=[];
    const replayRow=(nativeShot,at,state)=>{
      const v=([pitch,yaw,roll])=>({pitch:-pitch,yaw:-yaw,roll:-roll});
      const p=new PunchRecovery(v(nativeShot.baseAngle),v(nativeShot.baseVelocity)),delay=at-(nativeShot.exactSchedule??nativeShot.at);
      const nativeAngle=p.sample(delay),nativeVelocity=p.velocity(delay);
      return {tick:nativeShot.tick,shot:nativeShot.at,exactSchedule:nativeShot.exactSchedule,processed:at,nativeAngle,trainerAngle:{...state.recovery.angle},nativeVelocity,
        trainerVelocity:{...state.recovery.velocity},angleError:Math.hypot(nativeAngle.pitch-state.recovery.angle.pitch,nativeAngle.yaw-state.recovery.angle.yaw),
        velocityError:Math.hypot(nativeVelocity.pitch-state.recovery.velocity.pitch,nativeVelocity.yaw-state.recovery.velocity.yaw)};
    };
    for(let i=1;i<shots.length-1;i++){
      const first=shots[i],next=shots[i+1],stats=gameData.weapons[first.weapon];
      if(first.at-shots[i-1].at<1||Math.abs(next.at-first.at-stats.cycle)>.001)continue;
      const burst=[first];for(let j=i+1;j<shots.length&&Math.abs(shots[j].at-shots[j-1].at-stats.cycle)<.001;j++)burst.push(shots[j]);
      // last_shot_time is float32 seconds and loses precision late in a match.
      // Anchor tick+fraction differences preserve the native command cadence.
      for(const shot of burst)shot.exactSchedule=first.at+(shot.baseTick-first.baseTick)/128+(shot.baseFraction-first.baseFraction)/64;
      const state=new DuelWeaponState(first.weapon,sourceRandom(1),{spread:false});state.recovery.time=first.at;
      state.advance(first.at,0,{...command,firePressed:true,fireHeld:true},actor);
      heldReplay.push(replayRow(first,first.at,state));
      let previous=first.at;
      for(let tick=Math.ceil(first.at*128);tick<=Math.ceil(burst.at(-1).at*128)+2;tick++){
        const at=tick/128,round=state.advance(at,at-previous,{...command,fireHeld:true},actor);previous=at;
        if(round){const nativeShot=burst[heldReplay.length];if(!nativeShot)break;heldReplay.push(replayRow(nativeShot,at,state));}
      }break;
    }
    const max=arr=>arr.length?Math.max(...arr.map(Math.abs)):null;
    report.demos.push({demo:capture.demo,sha256:capture.sha256,actualWeapons,shots,
      standSamples:measured.length,maxStandPenaltyError:max(measured.map(r=>r.penaltyError)),maxStandIndexError:max(measured.map(r=>r.indexError)),
      shotSamples:fireRows.length,maxShotPenaltyError:max(fireRows.map(r=>r.penaltyError)),
      maxFireThenDecayError:max(fireRows.map(r=>r.nativeFireThenDecayPenalty-r.penalty)),anchors,heldReplay,comparisons});
  }
  for(const [weaponId,alternateFire,recoilIndex] of [['ak47',false,0],['revolver',true,0],['negev',false,0],['negev',false,1],['negev',false,2],['negev',false,3]]){
    const random=sourceRandom(77);let sum=0,sum2=0;const bins=Array(10).fill(0);for(let n=0;n<100000;n++){
      const s=sampleShotSpread({inaccuracy:1,spread:0,weaponId,alternateFire,recoilIndex},random),r=Math.hypot(s.horizontal,s.vertical);sum+=r;sum2+=r*r;bins[Math.min(9,Math.floor(r*10))]++;
    }report.spread.push({weaponId,alternateFire,recoilIndex,count:100000,meanRadius:sum/100000,meanSquaredRadius:sum2/100000,bins});
  }
  for(const material of ['concrete','metal','wood','plastic','glass','grate','water','flesh'])for(const units of [1,5.99,6,10,24])
    report.penetration.push({material,units,...damageThroughSurface(36,'ak47',{entry:{x:0,y:0,z:0},exit:{x:units*.0254,y:0,z:0}},material)});
  for(const held of ['ak47','awp','knife']){const s={flinchStack:1,velocityModifier:1};applyTagging(s,'ak47',held);const first={...s};applyTagging(s,'ak47',held);const second={...s};recoverTagging(s,.5,true);report.tagging.push({held,first,second,afterHalfSecond:s});}
  const output=path.resolve(process.argv[2]??path.join(directory,'trainer-before.json'));
  const beforeFile=path.join(directory,'trainer-before.json');
  if(output!==beforeFile&&fs.existsSync(beforeFile)){
    const before=JSON.parse(fs.readFileSync(beforeFile,'utf8'));
    report.recoilComparison=report.demos.filter(d=>d.heldReplay.length).map(d=>{
      const previous=before.demos.find(p=>p.demo===d.demo);if(!previous?.heldReplay?.length)return {demo:d.demo,baselineMissing:true};
      const errors=d.heldReplay.map((r,i)=>{const p=previous.heldReplay[i];return Math.hypot(p.trainerAngle.pitch-r.nativeAngle.pitch,p.trainerAngle.yaw-r.nativeAngle.yaw);});
      return {demo:d.demo,beforeMaxAngleError:Math.max(...errors),afterMaxAngleError:Math.max(...d.heldReplay.map(r=>r.angleError)),
        afterMaxVelocityError:Math.max(...d.heldReplay.map(r=>r.velocityError)),beforeErrors:errors,afterErrors:d.heldReplay.map(r=>r.angleError)};
    });
    fs.writeFileSync(path.join(directory,'recoil-before-after.json'),JSON.stringify(report.recoilComparison,null,2)+'\n');
  }
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  fs.writeFileSync(output.replace(/\.json$/,'.summary.json'),JSON.stringify({...report,demos:report.demos.map(({comparisons,...r})=>r),weapons:Object.fromEntries(Object.entries(report.weapons).map(([id,w])=>[id,{rawReloadPenalty:w.rawReloadPenalty,zoom:w.zoom,fire:w.fire}]))},null,2)+'\n');
}finally{await vite.close();}
