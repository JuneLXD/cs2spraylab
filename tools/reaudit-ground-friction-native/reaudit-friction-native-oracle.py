#!/usr/bin/env python3
"""Offline supplied-state native friction oracle. Run only in the serial slot.

This executes selected current-server instructions, not a running game. All
wish histories and segment schedules are declared inputs. It does not infer
the missing native previous-wish writer or emulate complete WalkMove/collision.
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent
sys.path.insert(0,str(ROOT/'python'))
from capstone import Cs,CS_ARCH_X86,CS_MODE_64,CS_OP_MEM
from capstone.x86_const import X86_REG_RIP
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE,UC_HOOK_MEM_READ,UC_HOOK_MEM_WRITE,UC_MEM_READ,UC_MEM_WRITE
from unicorn.x86_const import *

BINARY=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
SHA='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
OUT=ROOT/'reports/core-shooting-next/movement/native-friction-oracle'
CODE={
 'quantizer':(0x158c560,0x220),'quantizer-initializer':(0x1580840,0x800),
 'friction':(0x158c960,0x470),
 'cache-entry':(0x15d6585,0x7b),'cache-clear':(0x15d6cb8,0xc8),
 'cache-compare':(0x15d6e30,0x59),'cache-setters':(0x15d71d8,0x234),
}
Q=0x158c560;FRICTION=0x158c960;CACHE=0x15d6585;CACHE_END=0x15d6600
MOVE=0x5000000;PAWN=0x5004000;DATA=0x5008000;PVT=0x500a000
GLOBALS=0x500b000;FRICVAR=0x500c000;STOPVAR=0x500c100;NOTIFY=0x500d000
GROUND_STUB=0x500e000;END=0x500e100;FRAME=0x5038000;STACK=0x503fff0
HOOKS={0x9f3120:'initialization-guard-acquire',0x9f3140:'initialization-guard-release',
 0xa3db40:'notification-array-allocation',0xa3d650:'notification-array-release',
 0x228b960:'field-change-notification',0xd40980:'owner-friction-accessor',
 GROUND_STUB:'ground-entity-accessor'}
# Native writes are permitted only in declared, private supplied objects or
# the precise quantizer initializer storage. Mapping the surrounding address
# space is an emulator convenience, never authorization to read its zeros.
SUPPLIED_DATA=[
 (MOVE,0x800,'supplied-movement-services'),(PAWN,0x1000,'supplied-owner'),
 (DATA,0x200,'supplied-movement-data'),(PVT,0x700,'supplied-owner-vtable'),
 (GLOBALS,0x60,'supplied-global-timing'),(FRICVAR,0x60,'supplied-friction-convar'),
 (STOPVAR,0x60,'supplied-stop-speed-convar'),(NOTIFY,0x100,'supplied-notification-array'),
 (0x5030000,0x10000,'private-stack'),
 (0x29a3d48,8,'native-quantizer-initialization-guard'),
 (0x29a3d60,0x20,'native-quantizer-object'),
 (0x2796428,8,'supplied-global-timing-pointer'),
 (0x2a19208,8,'supplied-friction-convar-pointer'),
 (0x2a19308,8,'supplied-stop-speed-convar-pointer'),
]

def digest(path):
 h=hashlib.sha256()
 with path.open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 return h.hexdigest()
def f32(v):return struct.unpack('<f',struct.pack('<f',v))[0]
def bits(v):return struct.unpack('<I',struct.pack('<f',v))[0]
def frombits(v):return struct.unpack('<f',struct.pack('<I',v))[0]

class Native:
 def __init__(self):
  assert digest(BINARY)==SHA,'Current server digest changed'
  self.u=Uc(UC_ARCH_X86,UC_MODE_64)
  self.u.mem_map(0,0x4000000);self.u.mem_map(MOVE,0x40000)
  self.reads=[];self.calls={};self.cache_running=False;self.last_control=None
  self.memory_counts={'reads':0,'writes':0};self.memory_accesses={}
  cs=Cs(CS_ARCH_X86,CS_MODE_64);cs.detail=True
  with BINARY.open('rb')as f:
   elf=ELFFile(f)
   loads=[(int(s['p_vaddr']),int(s['p_offset']),int(s['p_filesz']))for s in elf.iter_segments()if s['p_type']=='PT_LOAD']
   def read(at,size,role):
    va,off,_=next(s for s in loads if s[0]<=at and at+size<=s[0]+s[2])
    f.seek(off+at-va);raw=f.read(size);assert len(raw)==size
    self.reads.append({'address':hex(at),'bytes':size,'role':role,'sha256':hashlib.sha256(raw).hexdigest()})
    self.u.mem_write(at,raw);return raw
   refs=set()
   for name,(at,size)in CODE.items():
    raw=read(at,size,name)
    for ins in cs.disasm(raw,at):
     for op in ins.operands:
      if op.type==CS_OP_MEM and op.mem.base==X86_REG_RIP:
       target=ins.address+ins.size+op.mem.disp
       if target not in refs and any(va<=target and target+16<=va+size for va,_,size in loads):
        read(target,16,'direct-rip-data');refs.add(target)
  self.readable=[(int(r['address'],16),r['bytes'],r['role'])for r in self.reads]+SUPPLIED_DATA
  self.writable=SUPPLIED_DATA
  self.u.hook_add(UC_HOOK_CODE,self.hook)
  self.u.hook_add(UC_HOOK_MEM_READ|UC_HOOK_MEM_WRITE,self.memory_hook)
  self.wq(MOVE+0x38,PAWN);self.wq(PAWN,PVT);self.wq(PVT+0x660,GROUND_STUB)
  self.wq(0x2796428,GLOBALS);self.wq(0x2a19208,FRICVAR);self.wq(0x2a19308,STOPVAR)
  self.wf(FRICVAR+0x58,5.2);self.wf(STOPVAR+0x58,80);self.wf(MOVE+0x26c,1)
 def wq(self,a,v):self.u.mem_write(a,struct.pack('<Q',v))
 def wf(self,a,v):self.u.mem_write(a,struct.pack('<f',v))
 def rf(self,a):return struct.unpack('<f',self.u.mem_read(a,4))[0]
 def wb(self,a,v):self.u.mem_write(a,bytes([int(v)]))
 def rb(self,a):return bool(self.u.mem_read(a,1)[0])
 def xmm(self,r,v):self.u.reg_write(r,bits(v))
 def memory_hook(self,u,access,at,size,value,_):
  assert access in (UC_MEM_READ,UC_MEM_WRITE),'Unexpected data-access hook kind'
  writing=access==UC_MEM_WRITE
  permitted=self.writable if writing else self.readable
  assert any(start<=at and at+size<=start+count for start,count,_ in permitted),(
   f'Undeclared native {"write" if writing else "read"} at {at:x} size {size}; instruction {u.reg_read(UC_X86_REG_RIP):x}')
  label='writes'if writing else'reads';self.memory_counts[label]+=1
  key=(label,at,size);self.memory_accesses[key]=self.memory_accesses.get(key,0)+1
 def ret(self):
  sp=self.u.reg_read(UC_X86_REG_RSP);target=struct.unpack('<Q',self.u.mem_read(sp,8))[0]
  self.u.reg_write(UC_X86_REG_RSP,sp+8);self.u.reg_write(UC_X86_REG_RIP,target)
 def hook(self,u,at,size,_):
  if self.cache_running and at==CACHE_END:u.emu_stop();return
  if at==0x158c9dc:self.last_control=self.rf(u.reg_read(UC_X86_REG_RBP)-0x24)
  if at in HOOKS:
   self.calls[HOOKS[at]]=self.calls.get(HOOKS[at],0)+1
   if at==0x9f3120:u.reg_write(UC_X86_REG_RAX,1)
   elif at==0x9f3140:self.wb(u.reg_read(UC_X86_REG_RDI),1)
   elif at==0xa3db40:
    arg=u.reg_read(UC_X86_REG_RDI);assert FRAME-0x400<=arg<FRAME
    self.wq(arg,NOTIFY)
   elif at==0x228b960:assert u.reg_read(UC_X86_REG_RDI)==MOVE+8
   elif at==0xd40980:
    assert u.reg_read(UC_X86_REG_RDI)==PAWN;self.xmm(UC_X86_REG_XMM0,1)
   elif at==GROUND_STUB:u.reg_write(UC_X86_REG_RAX,1)
   self.ret();return
  assert any(start<=at<start+count for start,count in CODE.values()),f'Unexpected native execution at {at:x}'
 def registers(self):
  for r in [UC_X86_REG_RAX,UC_X86_REG_RBX,UC_X86_REG_RCX,UC_X86_REG_RDX,UC_X86_REG_RSI,
            UC_X86_REG_RDI,UC_X86_REG_RBP,UC_X86_REG_R8,UC_X86_REG_R9,UC_X86_REG_R10,
            UC_X86_REG_R11,UC_X86_REG_R12,UC_X86_REG_R13,UC_X86_REG_R14,UC_X86_REG_R15]:self.u.reg_write(r,0)
  self.u.reg_write(UC_X86_REG_EFLAGS,2)
  for r in [UC_X86_REG_XMM0,UC_X86_REG_XMM1,UC_X86_REG_XMM2,UC_X86_REG_XMM3,
            UC_X86_REG_XMM4,UC_X86_REG_XMM5,UC_X86_REG_XMM6,UC_X86_REG_XMM7]:self.u.reg_write(r,0)
  self.u.reg_write(UC_X86_REG_RSP,STACK);self.wq(STACK,END)
 def run(self,entry,end=END):
  self.u.emu_start(entry,end,count=50000)
  assert self.u.reg_read(UC_X86_REG_RIP)==end,'Native instruction cap or unexpected stop'
 def quantize(self,v):
  self.registers();self.xmm(UC_X86_REG_XMM0,v);self.run(Q)
  return frombits(self.u.reg_read(UC_X86_REG_XMM0)&0xffffffff)
 def initialize(self,speed,active=False,saved_fraction=0,stored_speed=0):
  self.u.mem_write(DATA,b'\0'*0x200)
  self.wf(DATA+0x38,speed);self.wb(MOVE+0x690,active)
  self.wf(MOVE+0x694,saved_fraction);self.wf(MOVE+0x698,stored_speed)
 def state(self):
  return {'speedX':self.rf(DATA+0x38),'speedY':self.rf(DATA+0x3c),
    'stashActive':self.rb(MOVE+0x690),'savedFraction':self.rf(MOVE+0x694),
    'storedSpeed':self.rf(MOVE+0x698),'commandMarker':self.rb(DATA+0x136)}
 def cache(self,fraction,previous_wish,current_wish):
  self.wf(DATA+0xdc,fraction)
  for a,v in [(MOVE+0x7a8,previous_wish[0]),(MOVE+0x7ac,previous_wish[1]),
              (DATA+0xfc,current_wish[0]),(DATA+0x100,current_wish[1])]:self.wf(a,v)
  self.registers();self.u.reg_write(UC_X86_REG_RSP,FRAME-0x300)
  for r,v in [(UC_X86_REG_RBP,FRAME),(UC_X86_REG_RBX,MOVE),(UC_X86_REG_R13,DATA),
              (UC_X86_REG_R14,0xffffffffffffffff)]:self.u.reg_write(r,v)
  self.cache_running=True
  try:self.run(CACHE,CACHE_END)
  finally:self.cache_running=False
  return self.state()
 def friction(self,dt):
  self.last_control=None
  self.u.mem_write(DATA+0x104,b'\0'*0x18);self.wf(DATA+0x124,0)
  self.wf(GLOBALS+0x34,dt);self.registers()
  self.u.reg_write(UC_X86_REG_RDI,MOVE);self.u.reg_write(UC_X86_REG_RSI,DATA)
  self.run(FRICTION);return self.state()
 def command_start(self):self.wb(DATA+0x136,0)
 def command_end(self):self.wb(MOVE+0x690,self.rb(DATA+0x136))

def main():
 n=Native();quantizer=[]
 for v in [0,.09,.099,.1,.101,1,79.99,80,80.01,150,197.53125,200,215,225,230,240,250,-215]:
  quantizer.append({'input':v,'native':n.quantize(v)})
 cache_cases=[]
 q215=n.quantize(215)
 for name,active,saved,stored,frac,prev,wish in [
  ('release-new-cache',False,0,0,0,(215,0),(0,0)),
  ('counter-strafe-new-cache',False,0,0,.25,(215,0),(-215,0)),
  ('active-before-boundary',True,.5,225,.25,(0,0),(0,0)),
  ('active-exact-boundary-changed-speed',True,.5,225,.5,(0,0),(0,0)),
  ('active-exact-boundary-unchanged-speed',True,.5,q215,.5,(0,0),(0,0)),
  ('active-next-f32-after-boundary',True,.5,225,frombits(bits(.5)+1),(0,0),(0,0)),
 ]:
  n.initialize(215,active,saved,stored);before=n.state()
  after=n.cache(frac,prev,wish);after_friction=n.friction(1/128)
  cache_cases.append({'name':name,'fraction':frac,'previousWish':prev,'currentWish':wish,'before':before,
    'after':after,'afterNativeFrictionOnly':after_friction,'nativeControlSpeed':n.last_control,'duration':1/128})
 sequences=[];threshold_summaries=[]
 for weapon_speed in [200,215,225,230,240,250]:
  for sign in [-1,1]:
   for split in [1,2]:
    for prior_policy in ['supplied-original-throughout','supplied-zero-after-first-command']:
     n.initialize(sign*weapon_speed);rows=[];first=None;elapsed=0
     threshold=f32(f32(.34)*weapon_speed)
     for command in range(1,65):
      n.command_start();prior=(sign*weapon_speed,0)if command==1 or prior_policy=='supplied-original-throughout'else(0,0)
      for segment in range(split):
       fraction=segment/split;dt=1/(64*split);before=n.state()
       after_cache=n.cache(fraction,prior,(0,0));after=n.friction(dt);elapsed+=dt
       crossed=math.hypot(after['speedX'],after['speedY'])<=threshold
       if crossed and first is None:first={'time':elapsed,'previousTime':elapsed-dt,'command':command,'segment':segment,'speed':abs(after['speedX'])}
       rows.append({'command':command,'fraction':fraction,'dt':dt,'previousWish':prior,'currentWish':(0,0),
                    'before':before,'afterCache':after_cache,'nativeControlSpeed':n.last_control,'afterFriction':after})
      n.command_end()
      rows[-1]['afterCommandHandoff']=n.state()
      if command>=20 and first is not None:break
     threshold_summaries.append({'sequenceIndex':len(sequences),'threshold':threshold,
       'firstAtOrBelowThreshold':first,'derivation':'First supplied boundary whose native resulting speed is <= float32(0.34 * supplied weapon speed)'})
     sequences.append({'initialVelocity':{'x':sign*weapon_speed,'y':0},'initialSpeed':sign*weapon_speed,'weaponSpeed':weapon_speed,'split':split,
       'priorWishPolicy':prior_policy,'rows':rows})
 report={'serverSha256':SHA,'readerSha256':digest(Path(__file__)),'method':'Native selected instruction execution with explicitly supplied state and schedules',
   'units':'CS units/s and seconds; horizontal native x/y axes',
   'quantizer':quantizer,'cacheCases':cache_cases,'releaseSequences':sequences,
   'derivedThresholdSummaries':threshold_summaries,'hooks':n.calls,'readLedger':n.reads,
   'memoryGuard':{'counts':n.memory_counts,'unexpectedAccesses':0,
     'policy':'Every native data access must fit a declared full span. Imported instruction/RIP-literal bytes are read-only; private supplied state, stack and native quantizer BSS are bounded read/write ranges.',
     'suppliedAndInitializerRanges':[{'address':hex(a),'bytes':s,'role':r}for a,s,r in SUPPLIED_DATA],
     'accessLedger':[{'operation':op,'address':hex(at),'bytes':size,'count':count}for (op,at,size),count in sorted(n.memory_accesses.items())]},
   'commandHandoff':'Supplied harness copies the already byte-bound command marker reset/postcopy rule; actual outer command function is not invoked.',
   'limits':['Previous-wish policies are two separate supplied fixtures, not assertions about the missing native writer.',
     'No complete WalkMove, acceleration, collision, terrain, game capture or real command replay.',
     'Counter-strafe cases test the cache/friction state only; a fully native counter-strafe accuracy threshold requires separately bound Accelerate.',
     'Each weapon speed is a supplied numeric fixture, not an independently rebound weapon export. Threshold is float32(float32(0.34) * supplied speed); GetInaccuracy is not invoked.',
     'Crossing time is first evaluated supplied boundary; no between-boundary crossing or live input latency is inferred.',
     'Owner friction=1, surface factor=1, sv_friction=5.2, stop speed=80, finite dry grounded state supplied.']}
 OUT.mkdir(parents=True,exist_ok=True);target=OUT/'native.json'
 target.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'output':str(target),'sha256':digest(target),'quantizerCases':len(quantizer),
   'cacheCases':len(cache_cases),'releaseSequences':len(sequences),'terminal':'passed'}))

if __name__=='__main__':main()
