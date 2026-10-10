#!/usr/bin/env python3
"""Guarded supplied-segment friction/cache replay, preserving the v1 artifacts.

This executes the quantizer, cache, Friction, paired velocity helpers and the
proved per-segment wish copy. It deliberately omits acceleration/collision.
Run only in the parent's serialized, resource-capped execution slot.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT=Path(__file__).resolve().parent
V1=ROOT/'reaudit-friction-native-oracle.py'
V1_SHA='0091d61c3ba9985df1cc06ac3b7912117e5f80b61a04bf7e4d6539d9aaf60ceb'
SCHEMA='cs2.native-friction-segment-oracle.v2'
PRE=0x158da60;POST=0x158db30;COPY=0x15b0632;COPY_END=0x15b0641
EXTERNAL_VECTOR=0xd40960
PROOFS={
 'native-friction-oracle/native.json':'14cff2b71b2ed06b54434622b39575a6f1d08c6f81d4ed59d513489076d67502',
 'stash-wish-writer/proof.json':'1f33588cfd2d628ed14412fb88d24ab1962fc9435fdeb858488fa7c12c3c5fcd',
 'stash-wish-writer/tail-proof.json':'6325ea40a6167d96b127b9ff9ea884cb568037604af207cc0c7deafc656e2b92',
 'stash-velocity-pair/proof.json':'334d0d5994e5b66ba571332920944f00d5bc9661c01133faf2051362ca64217e',
 'stash-walk-tail/proof.json':'293f027941f66173db9e064a03698d6a6ad80c622f959ccafe6ce0cfb70f0287',
}
PROFILES={'nearest-gradual':0x1f80,'nearest-ftz-daz':0x9fc0}

def digest(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def canonical(obj):return json.dumps(obj,sort_keys=True,separators=(',',':'),allow_nan=False).encode()

assert digest(V1)==V1_SHA,'The preserved guarded v1 reader changed'
spec=importlib.util.spec_from_file_location('preserved_friction_v1',V1)
v1=importlib.util.module_from_spec(spec);spec.loader.exec_module(v1)
f32=v1.f32
v1.CODE.update({'pre-velocity-helper':(PRE,208),'post-velocity-helper':(POST,111),'segment-wish-copy':(COPY,15)})
assert sum(size for _,size in v1.CODE.values())==5038
v1.HOOKS[EXTERNAL_VECTOR]='supplied-zero-owner-velocity-vector'

class Native(v1.Native):
 def __init__(self):
  self.profile='nearest-gradual';self.mxcsr_calls={};super().__init__()
 def registers(self):
  super().registers();self.u.reg_write(v1.UC_X86_REG_MXCSR,PROFILES[self.profile])
 def run(self,entry,end=v1.END):
  super().run(entry,end)
  actual=self.u.reg_read(v1.UC_X86_REG_MXCSR)
  assert actual&~0x3f==PROFILES[self.profile],'MXCSR control changed'
  key=f'{self.profile}:{actual:#x}';self.mxcsr_calls[key]=self.mxcsr_calls.get(key,0)+1
 def hook(self,u,at,size,data):
  if at==EXTERNAL_VECTOR:
   assert u.reg_read(v1.UC_X86_REG_RDI)==v1.PAWN
   self.calls[v1.HOOKS[at]]=self.calls.get(v1.HOOKS[at],0)+1
   u.reg_write(v1.UC_X86_REG_XMM0,0);u.reg_write(v1.UC_X86_REG_XMM1,0)
   self.ret();return
  super().hook(u,at,size,data)
 def state(self):
  return {**super().state(),
   'previousWish':{'x':self.rf(v1.MOVE+0x7a8),'y':self.rf(v1.MOVE+0x7ac)},
   'currentWish':{'x':self.rf(v1.DATA+0xfc),'y':self.rf(v1.DATA+0x100)},
   'accelerationWork':{'x':self.rf(v1.DATA+0x104),'y':self.rf(v1.DATA+0x108)},
   'carriedDelta':{'x':self.rf(v1.DATA+0x110),'y':self.rf(v1.DATA+0x114)}}
 def seed(self,seed):
  # Every fixture owns all cache/wish/marker fields; none is inherited.
  required={'velocity','previousWish','active','savedFraction','storedSpeed','commandMarked'}
  assert set(seed)==required
  super().initialize(seed['velocity'][0],seed['active'],seed['savedFraction'],seed['storedSpeed'])
  self.wf(v1.DATA+0x3c,seed['velocity'][1]);self.wb(v1.DATA+0x136,seed['commandMarked'])
  self.wf(v1.MOVE+0x7a8,seed['previousWish'][0]);self.wf(v1.MOVE+0x7ac,seed['previousWish'][1])
 def cache_current(self,fraction,wish):
  self.wf(v1.DATA+0xdc,fraction)
  self.wf(v1.DATA+0xfc,wish[0]);self.wf(v1.DATA+0x100,wish[1])
  self.registers();self.u.reg_write(v1.UC_X86_REG_RSP,v1.FRAME-0x300)
  for r,value in [(v1.UC_X86_REG_RBP,v1.FRAME),(v1.UC_X86_REG_RBX,v1.MOVE),
                  (v1.UC_X86_REG_R13,v1.DATA),(v1.UC_X86_REG_R14,0xffffffffffffffff)]:self.u.reg_write(r,value)
  self.cache_running=True
  try:self.run(v1.CACHE,v1.CACHE_END)
  finally:self.cache_running=False
  return self.state()
 def prepare_segment(self):
  # Exact temporary spans cleared by the already-bound segment preparation;
  # the command marker and persistent previous wish are deliberately kept.
  for offset in (0xfc,0x10c,0x124):self.u.mem_write(v1.DATA+offset,b'\0'*16)
 def velocity_helper(self,entry):
  self.registers();self.u.reg_write(v1.UC_X86_REG_RDI,v1.MOVE);self.u.reg_write(v1.UC_X86_REG_RSI,v1.DATA)
  self.run(entry);return self.state()
 def copy_wish(self):
  self.registers();self.u.reg_write(v1.UC_X86_REG_R12,v1.DATA);self.u.reg_write(v1.UC_X86_REG_RBX,v1.MOVE)
  self.run(COPY,COPY_END);return self.state()

def seed(speed=215,prior=(0,0),active=False,saved=0,stored=0,marked=False,side=0):
 return {'velocity':[f32(speed),f32(side)],'previousWish':[f32(v)for v in prior],
   'active':active,'savedFraction':f32(saved),'storedSpeed':f32(stored),'commandMarked':marked}
def command(start=0,end=1,wish=(0,0),extra=(),events=(),begin=True,finish=True):
 return {'startFraction':f32(start),'endFraction':f32(end),'wishAtStart':[f32(v)for v in wish],
   'extraBoundaries':[f32(v)for v in extra],
   'events':[{'fraction':f32(t),'wish':[f32(v)for v in w]}for t,w in events],
   'beginCommand':begin,'finishCommand':finish}

def fixtures():
 out=[]
 for speed in [200,215,225,230,240,250]:
  for sign in [-1,1]:
   for fraction in [0,.25,.5,.75]:
    for halves in [False,True]:
     ident=f'release-{speed}-{sign:+d}-at-{fraction:g}-'+('half-grid'if halves else'events-only')
     extra=(.5,)if halves else()
     first=command(start=fraction,extra=extra,begin=fraction==0)
     commands=[first]+[command(extra=extra)for _ in range(19)]
     out.append({'id':ident,'kind':'release','suppliedSpeed':speed,
       'initialState':seed(sign*speed,(sign*speed,0)),
       'commands':commands,'mxcsrProfiles':['nearest-gradual'],
       'scope':'Supplied state at the release boundary; any preceding held movement is not simulated.'})
 assert len(out)==96
 q215=214.9845733642578
 focus=[
  ('multiple-wish-changes',seed(prior=(215,0)),[command(events=[(.125,(215,0)),(.375,(-215,0)),(.625,(100,100)),(.875,(0,0))]),command(),command()]),
  ('active-interior-insertion',seed(active=True,saved=.25,stored=240),[command(),command(),command()]),
  ('same-wish-changed-speed',seed(active=True,saved=.5,stored=225),[command(start=.5,begin=False),command()]),
  ('exact-unchanged-marker-false',seed(active=True,saved=.5,stored=q215),[command(start=.5,begin=False)]),
  ('exact-unchanged-marker-true',seed(active=True,saved=.5,stored=q215,marked=True),[command(start=.5,begin=False)]),
  ('adjacent-fraction-preserves',seed(active=True,saved=.5,stored=225),[command(start=v1.frombits(v1.bits(.5)+1),begin=False),command()]),
  ('unchanged-wish-no-cache',seed(prior=(0,0)),[command(extra=(.25,.5,.75)),command(extra=(.5,))]),
  ('partial-marker-preserved',seed(active=True,saved=.75,stored=225,marked=True),[command(start=.875,begin=False),command()]),
  ('diagonal-supplied-wish',seed(prior=(120,120),side=70),[command(wish=(120,120),events=[(.25,(100,100)),(.75,(-100,100))]),command(wish=(-100,100))]),
 ]
 for name,state,commands in focus:
  out.append({'id':'state-'+name,'kind':'cache-state-without-acceleration','initialState':state,
    'commands':commands,'mxcsrProfiles':['nearest-gradual'],
    'scope':'Supplied processed-wish and velocity state; nonzero inputs do not invoke acceleration.'})
 for ident in ['release-230-+1-at-0-half-grid','release-215--1-at-0.25-events-only','state-multiple-wish-changes']:
  next(f for f in out if f['id']==ident)['mxcsrProfiles'].append('nearest-ftz-daz')
 return out

def intervals(cmd,incoming):
 start,end=cmd['startFraction'],cmd['endFraction'];assert 0<=start<end<=1
 reasons={start:['supplied-start'],end:['supplied-end']}
 for fraction in cmd['extraBoundaries']:
  if start<fraction<end:reasons.setdefault(fraction,[]).append('supplied-extra-boundary')
 for event in cmd['events']:
  assert start<=event['fraction']<=end
  reasons.setdefault(event['fraction'],[]).append('supplied-wish-edge')
 saved=incoming['savedFraction']
 if incoming['stashActive']and 0<saved<1 and start<saved<end:
  reasons.setdefault(saved,[]).append('active-saved-fraction')
 boundaries=sorted(reasons)
 return boundaries,[{'fraction':v,'reasons':reasons[v]}for v in boundaries]

def replay(n,fixture,profile):
 n.profile=profile;n.seed(fixture['initialState'])
 rows=[];generated=[];release_start=fixture['commands'][0]['startFraction'];threshold=None;first=None
 if fixture['kind']=='release':threshold=f32(f32(.34)*fixture['suppliedSpeed'])
 for index,cmd in enumerate(fixture['commands']):
  incoming=n.state()
  if cmd['beginCommand']:n.command_start()
  after_begin=n.state();bounds,why=intervals(cmd,after_begin)
  generated.append({'command':index+1,'supplied':cmd,'beforeCommand':incoming,'afterBeginCommand':after_begin,'boundaries':why})
  wish=cmd['wishAtStart'];eventmap={e['fraction']:e['wish']for e in cmd['events']}
  for start,end in zip(bounds,bounds[1:]):
   if start in eventmap:wish=eventmap[start]
   duration=f32(f32(end-start)*f32(1/64));before_preparation=n.state()
   n.prepare_segment();before=n.state()
   after_cache=n.cache_current(start,wish);after_friction=n.friction(duration);control=n.last_control
   after_pre=n.velocity_helper(PRE);after_post=n.velocity_helper(POST);after_copy=n.copy_wish()
   assert after_copy['previousWish']=={'x':f32(wish[0]),'y':f32(wish[1])}
   when=(index+end-release_start)/64
   row={'command':index+1,'startFraction':start,'endFraction':end,'duration':duration,
     'startTimeFromFixtureStart':(index+start-release_start)/64,'endTimeFromFixtureStart':when,
     'beforePreparation':before_preparation,'before':before,'currentWish':{'x':wish[0],'y':wish[1]},'afterCache':after_cache,
     'nativeControlSpeed':control,'afterFriction':after_friction,'afterPreHelper':after_pre,
     'afterPostHelper':after_post,'afterWishCopy':after_copy,
     'derivedUncollidedDisplacement':{'x':f32(after_pre['speedX']*duration),'y':f32(after_pre['speedY']*duration)}}
   rows.append(row)
   speed=f32(math.sqrt(f32(f32(after_post['speedX']**2)+f32(after_post['speedY']**2))))
   if threshold is not None and first is None and speed<=threshold:
    first={'timeFromFixtureStart':when,'previousTimeFromFixtureStart':row['startTimeFromFixtureStart'],
      'command':index+1,'fraction':end,'speed':speed,'rowIndex':len(rows)-1}
  if cmd['finishCommand']:
   n.command_end();rows[-1]['afterCommandHandoff']=n.state()
  generated[-1]['afterCommand']=n.state()
 return {'fixtureId':fixture['id'],'mxcsrProfile':profile,'generatedCommands':generated,'rows':rows},(
  {'fixtureId':fixture['id'],'mxcsrProfile':profile,'threshold':threshold,'firstQualifiedBoundary':first}if threshold is not None else None)

def main():
 ap=argparse.ArgumentParser();ap.add_argument('--out',type=Path,default=ROOT/'reports/core-shooting-next/movement/native-friction-oracle-v2/run-001')
 args=ap.parse_args();args.out.mkdir(parents=True,exist_ok=False)
 base=ROOT/'reports/core-shooting-next/movement'
 for relative,expected in PROOFS.items():assert digest(base/relative)==expected,relative
 definition={'schema':'cs2.native-friction-segment-fixtures.v2','fixtures':fixtures(),
  'mxcsrProfiles':PROFILES,'friction':5.2,'stopSpeed':80,'surfaceFactor':1,'ownerFactor':1,'ownerExternalVector':[0,0,0],
  'initialAccelerationWork':[0,0,0],'initialCarriedDelta':[0,0,0]}
 fixture_hash=hashlib.sha256(canonical(definition)).hexdigest()
 (args.out/'fixtures.json').write_text(json.dumps(definition,indent=2,allow_nan=False)+'\n')
 n=Native();sequences=[];thresholds=[]
 for fixture in definition['fixtures']:
  for profile in fixture['mxcsrProfiles']:
   sequence,summary=replay(n,fixture,profile);sequences.append(sequence)
   if summary is not None:thresholds.append(summary)
 report={'schema':SCHEMA,'guardedNativeExecution':True,'fixtureDefinitionSha256':fixture_hash,
  'fixtureFileSha256':digest(args.out/'fixtures.json'),'readerSha256':digest(Path(__file__)),
  'preservedV1ReaderSha256':V1_SHA,'serverSha256':v1.SHA,'selectedNativeCodeBytes':5038,
  'proofInputHashes':PROOFS,'method':'Selected native supplied-segment execution with actual per-segment wish copy and paired velocity helpers',
  'units':'CS native x/y units per second; seconds and command fractions',
  'mxcsrProfiles':[{'id':k,'initial':value,'controlMask':hex(0xffffffc0),'runtimeObserved':False}for k,value in PROFILES.items()],
  'mxcsrExecutionResults':n.mxcsr_calls,'fixtures':definition['fixtures'],'sequences':sequences,
  'derivedReleaseThresholds':thresholds,'hooks':n.calls,'readLedger':n.reads,
  'memoryGuard':{'policy':'Every native instruction/data span is checked; exact imported bytes are read-only and supplied/initializer ranges are bounded read/write.',
   'counts':n.memory_counts,'unexpectedAccesses':0,
   'suppliedAndInitializerRanges':[{'address':hex(a),'bytes':s,'role':r}for a,s,r in v1.SUPPLIED_DATA],
   'accessLedger':[{'operation':op,'address':hex(at),'bytes':size,'count':count}for (op,at,size),count in sorted(n.memory_accesses.items())]},
  'limits':['All initial state, schedules and processed wish vectors are explicit supplied inputs; no live physical input replay.',
   'No Accelerate, collision, full WalkMove, pawn setter, complete command dispatch or live gameplay is invoked.',
   'Nonzero-wish fixtures test cache/Friction state only, not counter-strafe acceleration or accuracy.',
   'Owner external vector is supplied zero; owner/surface friction factors are supplied one.',
   'Generated active saved-fraction insertion, segment temporary clears and command marker lifecycle are byte-bound harness rules, not native outer-loop execution.',
   'Derived uncollided displacement is authored midpoint velocity times duration, not native collision/position execution.',
   'Release thresholds use supplied speeds and float32(.34); the native weapon inaccuracy function is not invoked.',
   'MXCSR is explicit supplied configuration; it was not read from a live process.']}
 target=args.out/'native.json';target.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
 print(json.dumps({'output':str(target),'sha256':digest(target),'fixtureDefinitionSha256':fixture_hash,
   'fixtures':len(definition['fixtures']),'sequences':len(sequences),'rows':sum(len(s['rows'])for s in sequences),
   'nativeCodeBytes':5038,'status':'passed'}))

if __name__=='__main__':main()
