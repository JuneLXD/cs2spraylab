"""Bounded read-only AK camera-anchor arithmetic, independent of live engine code.

Parses three fresh original demos plus the original 14-shot fixture demo using the retained demoparser2 package and hashes
both originals and their prior CSV exports. No game, Node, browser or REA call.
The script independently reproduces the published recoil RNG arithmetic and
compares fixed clock hypotheses. It does not fit or assert a native clock rule.
"""
import os
os.environ.setdefault('OPENBLAS_NUM_THREADS','1')
import csv, hashlib, json, math, struct, sys
from pathlib import Path
REPO=Path(__file__).resolve().parents[1];ROOT=REPO.parent/'native-audit'
sys.path.insert(0,str(ROOT/'python'))
from demoparser2 import DemoParser
F=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
CAM='CCSPlayerPawn.CCSPlayer_CameraServices.';AIM='CCSPlayerPawn.CCSPlayer_AimPunchServices.'
props=['game_time','last_shot_time','next_primary_attack_tick','next_primary_attack_tick_ratio','active_weapon_name','fl_recoil_idx',CAM+'m_vecCsViewPunchAngle',CAM+'m_nCsViewPunchAngleTick',CAM+'m_flCsViewPunchAngleTickRatio',AIM+'m_predictableBaseTick',AIM+'m_predictableBaseTickInterpAmount']
class Random:
 def __init__(self,seed):self.state=-abs(seed);self.shuffle=[0]*32;self.previous=0
 def integer(self):
  if self.state<=0 or self.previous==0:
   self.state=max(1,-self.state)
   for j in range(39,-1,-1):
    self.state=self.state*16807%2147483647
    if j<32:self.shuffle[j]=self.state
   self.previous=self.shuffle[0]
  self.state=self.state*16807%2147483647;index=self.previous//67108864;self.previous=self.shuffle[index];self.shuffle[index]=self.state
  return self.previous
 def uniform(self,lo,hi):
  unit=min(.9999998807907104,F(F(self.integer())*F(1/2147483647)))
  return F(F(unit*F(hi-lo))+lo)
w=json.loads((REPO/'src/range/game-data.json').read_text())['weapons']['ak47'];rng=Random(w['recoilSeed']);table=[];angle=magnitude=0
for i in range(64):
 a=F(F(w['recoilAngle'])+rng.uniform(-F(w['recoilVariance']),F(w['recoilVariance'])))
 m=F(F(w['recoilMagnitude'])+rng.uniform(-F(w['recoilMagnitudeVariance']),F(w['recoilMagnitudeVariance'])))
 angle=F(angle+F(F(a-angle)*F(.55))) if i else a
 magnitude=F(magnitude+F(F(m-magnitude)*F(.55))) if i else m
 if i<4:magnitude=F(magnitude*F(.75+i/16))
 rad=F(angle*F(math.pi/180));scale=F(F(magnitude)*F(.055))
 table.append(dict(angle=angle,magnitude=magnitude,pitch=-F(F(math.cos(rad))*scale),yaw=-F(F(math.sin(rad))*scale)))
def clock(row,prefix,tick,ratio):return row[prefix+tick]/128+row[prefix+ratio]/64
def length(v):return math.hypot(*v)
def impulse(row):return [table[row['recoilOrdinal']][axis]for axis in ['pitch','yaw']]
clocks={
 'schedule_delta':lambda a,b:b['schedule']-a['schedule'],
 'camera_anchor_delta':lambda a,b:b['cameraTime']-a['cameraTime'],
 'processing_tick_delta':lambda a,b:b['gameTime']-a['gameTime'],
 'schedule_now_minus_previous_camera':lambda a,b:b['schedule']-a['cameraTime'],
 'float32_schedule_now_minus_previous_camera':lambda a,b:F(F(b['schedule'])-F(a['cameraTime'])),
 'last_shot_now_minus_previous_camera':lambda a,b:F(b['lastShot']-F(a['cameraTime'])),
 'processing_now_minus_previous_camera':lambda a,b:b['gameTime']-a['cameraTime'],
 'previous_camera_plus_cycle':lambda a,b:F(w['cycle']),
}
reports=[]
for stem in ['native_reaudit_recovery_001','native_reaudit_recovery_002','native_reaudit_shooting_001','native_audit_ak_002']:
 demo=ROOT.parent/'cs2-game/game/csgo'/f'{stem}.dem';csv_path=ROOT/'reports'/stem/'ticks.csv'
 assert demo.stat().st_size<2*1024*1024, 'This lightweight analysis is bounded to the four small retained demos'
 parser=DemoParser(str(demo))
 rows=parser.parse_ticks(props).to_dict('records');events=parser.parse_event('weapon_fire').to_dict('records');fired={int(r['tick'])for r in events};shots=[]
 changes=[]
 for a,b in zip(rows,rows[1:]):
  if any(str(a[key])!=str(b[key])for key in [CAM+'m_vecCsViewPunchAngle',CAM+'m_nCsViewPunchAngleTick',CAM+'m_flCsViewPunchAngleTickRatio']) and int(b['tick'])not in fired:changes.append(int(b['tick']))
 for raw in rows:
  if int(raw['tick']) not in fired:continue
  assert raw['active_weapon_name']=='AK-47'
  camera=clock(raw,CAM,'m_nCsViewPunchAngleTick','m_flCsViewPunchAngleTickRatio');aim=clock(raw,AIM,'m_predictableBaseTick','m_predictableBaseTickInterpAmount')
  schedule=raw['next_primary_attack_tick']/128+raw['next_primary_attack_tick_ratio']/64-F(w['cycle'])
  shots.append(dict(tick=int(raw['tick']),gameTime=raw['game_time'],lastShot=raw['last_shot_time'],schedule=schedule,cameraTime=camera,aimTime=aim,
   cameraCarrier={"tick":raw[CAM+'m_nCsViewPunchAngleTick'],"fraction":raw[CAM+'m_flCsViewPunchAngleTickRatio']},
   aimCarrier={"tick":raw[AIM+'m_predictableBaseTick'],"fraction":raw[AIM+'m_predictableBaseTickInterpAmount']},
   camera=[float(x) for x in raw[CAM+'m_vecCsViewPunchAngle'][:2]],recoilIndexAfter=raw['fl_recoil_idx'],recoilOrdinal=max(0,math.floor(raw['fl_recoil_idx']-1))%64,
   cameraMinusSchedule=camera-schedule,aimMinusCamera=aim-camera,processingMinusSchedule=raw['game_time']-schedule))
 comparisons={name:[]for name in clocks};carried={name:None for name in clocks}
 for n,b in enumerate(shots):
  kick=impulse(b);b['impulse']=kick
  if not n:
   for name in clocks:carried[name]=kick[:]
   continue
  a=shots[n-1];prior=a['camera'];residual=[b['camera'][k]-kick[k] for k in range(2)]
  inferred=[]
  for k in range(2):
   factor=residual[k]/prior[k] if prior[k] else -1
   inferred.append(-math.log(factor)/18 if 0<factor<=1 else None)
  b['observedCarry']=residual;b['axisImpliedElapsed']=inferred
  b['vectorLeastSquaresFactor']=sum(prior[k]*residual[k]for k in range(2))/sum(x*x for x in prior)
  b['vectorImpliedElapsed']=-math.log(b['vectorLeastSquaresFactor'])/18 if 0<b['vectorLeastSquaresFactor']<=1 else None
  for name,elapsed in clocks.items():
   dt=elapsed(a,b);decay=F(math.exp(-F(max(0,dt)*18)))
   predicted=[F(F(prior[k]*decay)+kick[k])for k in range(2)]
   cumulative=[F(F(carried[name][k]*decay)+kick[k])for k in range(2)];carried[name]=cumulative
   comparisons[name].append(dict(tick=b['tick'],elapsed=dt,predicted=predicted,cumulative=cumulative,
    error=[predicted[k]-b['camera'][k] for k in range(2)],errorNorm=length([predicted[k]-b['camera'][k]for k in range(2)]),
    cumulativeErrorNorm=length([cumulative[k]-b['camera'][k]for k in range(2)]),
    impliedElapsedError=None if b['vectorImpliedElapsed'] is None else dt-b['vectorImpliedElapsed']))
 summary={name:dict(pairs=len(values),maxError=max(r['errorNorm']for r in values),rmsError=math.sqrt(sum(r['errorNorm']**2 for r in values)/len(values)),maxCumulativeError=max(r['cumulativeErrorNorm']for r in values))for name,values in comparisons.items()}
 # These observation-clock samples are diagnostics, not measured video angles.
 observation={}
 for name,anchor_key in [('processing_tick_delta','gameTime'),('schedule_delta','schedule'),('float32_schedule_now_minus_previous_camera','cameraTime')]:
  values=[]
  for n,shot in enumerate(shots):
   angle=shot['impulse'] if n==0 else comparisons[name][n-1]['cumulative']
   decay=F(math.exp(-F(max(0,F(shot['gameTime'])-F(shot[anchor_key]))*18)))
   native_decay=F(math.exp(-F(max(0,F(shot['gameTime'])-F(shot['cameraTime']))*18)))
   predicted=[F(value*decay)for value in angle];native_sample=[F(value*native_decay)for value in shot['camera']]
   values.append(dict(tick=shot['tick'],time=shot['gameTime'],prediction=predicted,nativeReference=native_sample,errorNorm=length([predicted[k]-native_sample[k]for k in range(2)])))
  observation[name]=dict(maxError=max(v['errorNorm']for v in values),samples=values)

 reports.append(dict(demo=demo.name,demoSha256=hashlib.sha256(demo.read_bytes()).hexdigest(),csvSha256=hashlib.sha256(csv_path.read_bytes()).hexdigest(),rows=len(rows),nonShotCameraChanges=changes,shotCount=len(shots),shots=shots,summary=summary,comparisons=comparisons,observationClockDiagnostics=observation))
report=dict(method=__doc__,units='seconds and native-sign pitch/yaw degrees',parameterSha256=hashlib.sha256((REPO/'src/range/game-data.json').read_bytes()).hexdigest(),recoilTable=table,recordings=reports,
 limitations=['The first shot in each recording has no prior-shot carry comparison. Non-shot camera writes are listed separately; all precede the first analyzed shot in these recordings.','Network camera-angle quantization limits inverse elapsed precision, especially when carried angle is small.','Clock comparisons are fixed arithmetic hypotheses. Native sampler/caller/time-control evidence is required to identify actual global sampling time.','The recoil table is independently reproduced from shipped trainer parameters with float32 arithmetic; this script does not emulate the native recoil generator.'])
report['implementationBoundary']='A two-clock camera primitive is supported by the separate native sampler/setter call evidence. Native demo fields supply both clocks for replay, but retained trainer input lacks a proven mapping from shot schedule to the original native recoil command anchor. Do not fit a constant offset or claim full live parity from scheduled time alone.'
report['nativeEvidenceNeeded']=[
 'Establish the global/predicted current-time value at the exact virtual camera-sampler call, including delayed held shots and the game-time override/restoration scope.',
 'Confirm that the camera setter stores the original incoming command pair while the sampler reads that separate current-time clock.',
 'Identify how the original command pair differs from the next-attack-derived shot schedule, including shooting_001 tick289 where the camera anchor is schedule+1/64.',
 'Confirm server/client equivalence of the time-control path; demo network anchors alone do not identify local predicted rendering time.',
 'Read the camera-angle network quantization schema to set a justified residual tolerance; small inverse-elapsed differences are not evidence for fitted decay constants.'
]
report['priorBoundaryReview']={'sha256':hashlib.sha256((ROOT/'reports/reaudit-combat/viewpunch-boundary-review.json').read_bytes()).hexdigest(),'reportedMaxScheduledError':max(r['scheduledError'] for r in json.loads((ROOT/'reports/reaudit-combat/viewpunch-boundary-review.json').read_text())),'reproducedMaxScheduleAnchorError':reports[0]['summary']['schedule_delta']['maxCumulativeError']}
old_fixture=json.loads((REPO/'src/range/native-view-punch-anchor-fixture.json').read_text())
old=reports[-1]
report['old14ShotFixture']={'source':old_fixture['source'],'hashMatchesOriginal':old_fixture['sourceSha256']==old['demoSha256'],'samples':len(old_fixture['samples']),'maxRelativeTimeError':max(abs(sample['elapsed']-(shot['cameraTime']-old['shots'][0]['cameraTime']))for sample,shot in zip(old_fixture['samples'],old['shots'])),'cameraMinusScheduleRange':[min(s['cameraMinusSchedule']for s in old['shots']),max(s['cameraMinusSchedule']for s in old['shots'])]}
report['totalShots']=sum(r['shotCount']for r in reports)
report['nonInitialShotPairs']=sum(r['shotCount']-1 for r in reports)
report['summary']={'maxMixedClockCumulativeAnchorError':max(r['summary']['float32_schedule_now_minus_previous_camera']['maxCumulativeError']for r in reports),'maxMixedClockOneStepAnchorError':max(r['summary']['float32_schedule_now_minus_previous_camera']['maxError']for r in reports),'maxAimMinusCameraDeviationFrom1Over128':max(abs(s['aimMinusCamera']-1/128)for r in reports for s in r['shots'])}
report['scriptSha256']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
out=ROOT/'reports/reaudit-camera-anchor-clocks.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({r['demo']:{'shots':r['shotCount'],'summary':r['summary']}for r in reports},indent=2));print('Saved',out)
