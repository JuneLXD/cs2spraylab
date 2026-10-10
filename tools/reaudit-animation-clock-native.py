"""Current-client AG2 elapsed-time proof and bounded private native replay.

No live process is opened. Only controller/owner object lookup is stubbed in the
clock replay. Domain tick selection, game-rules pause accounting, Arms' virtual
override, stored-tick mutation, clamping and float conversion execute natively.
"""
import argparse,hashlib,json,struct,sys
from pathlib import Path
AUDIT=Path(__file__).resolve().parents[2]/'native-audit'
sys.path.insert(0,str(AUDIT/'python'))
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
OUT=AUDIT/'reports/animation-clock-trace'
BINARY=AUDIT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
SHA='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
RANGES=[
 ('animation-system-dispatch',0xf61fb0,0x2a),
 ('animation-tick-dispatch',0xf61680,0x28b),
 ('inline-ag2-worker',0xf19fd0,0x1d8),
 ('threaded-ag2-worker',0xf10f40,0x1fc),
 ('entity-graph-delta',0xf06a30,0x9b),
 ('stored-tick-difference',0x16155c0,0x1b),
 ('arm-clock-selector',0x1f87fa0,3),
 ('domain-tick-getter',0x1389c40,0x2e),
 ('pause-adjusted-tick',0x1954250,0xc1),
 ('graph-context-wrapper',0x25f9b50,0x1f),
 ('graph-context-constructor',0x25f96a0,0x1c6),
 ('context-delta-write',0x25f0050,0x52),
 ('graph-pose-evaluation',0x25f4190,0x66),
 ('arms-skeleton-callback',0x1f96cc0,0x65),
]
ASSERTIONS={
 0xf61fb2:'jmp 0xf61680',0xf61fd5:'jmp 0xf61680',
 0xf618ea:'call 0xf19d60',
 0xf1a0c9:'call 0xf06a30',0xf1a0d5:'jae 0xf1a178',
 0xf1a114:'call 0x25f9b50',0xf1a13b:'call 0x25f4190',
 0xf1a16b:'call qword ptr [rax + 0x8d0]',
 0xf11048:'call 0xf06a30',0xf11054:'jae 0xf11108',
 0xf11095:'call 0x25f9b50',0xf110bb:'call 0x25f4190',
 0xf110fc:'call qword ptr [rax + 0x8d0]',
 0xf06a4d:'call 0x1389c40',0xf06a6b:'call qword ptr [rax + 0x430]',
 0xf06a7b:'call 0x16155c0',0xf06a8b:'pmaxsd xmm0, xmm1',
 0xf06a9d:'cvtsi2ss xmm0, eax',
 0xf06aa1:'mulss xmm0, dword ptr [rip - 0x406cf1]',
 0x16155c0:'mov edx, dword ptr [rdi + 0xe4]',
 0x16155c8:'mov dword ptr [rdi + 0xe4], esi',
 0x16155ce:'sub eax, edx',0x16155d7:'cmove eax, edx',
 0x1f87fa0:'xor eax, eax',0x1f87fa2:'ret ',
 0x1389c55:'jmp 0x1954250',0x1389c6a:'mov eax, dword ptr [rax + 0x44]',
 0x19542ae:'sub r12d, dword ptr [rbx + 0x30]',
 0x19542ed:'sub eax, dword ptr [rdi + 0x30]',
 0x25f9b61:'call 0x25f96a0',
 0x25f96c0:'movss dword ptr [rbp - 0x64], xmm0',
 0x25f9826:'movss xmm0, dword ptr [rbp - 0x64]',
 0x25f9835:'call 0x25f0050',
 0x25f005c:'movss dword ptr [rdi + 0x68], xmm0',
 0x25f9863:'call qword ptr [rax + 0x58]',
}

def main():
 OUT.mkdir(parents=True,exist_ok=True)
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--portable-out',type=Path)
 args=p.parse_args()
 h=hashlib.sha256()
 with BINARY.open('rb')as f:
  for b in iter(lambda:f.read(1024*1024),b''):h.update(b)
 assert h.hexdigest()==SHA
 with BINARY.open('rb')as f:
  elf=ELFFile(f)
  segments=[(s['p_vaddr'],s['p_offset'],s['p_filesz'])for s in elf.iter_segments()if s['p_type']=='PT_LOAD']
  def read(a,n):
   assert 0<n<=8192
   v,o,z=next(s for s in segments if s[0]<=a and a+n<=s[0]+s[2]);f.seek(o+a-v);b=f.read(n);assert len(b)==n;return b
  def q(a):return struct.unpack('<Q',read(a,8))[0]
  cs=Cs(CS_ARCH_X86,CS_MODE_64);ins={};manifest=[]
  for name,a,n in RANGES:
   b=read(a,n);ins.update({i.address:f'{i.mnemonic} {i.op_str}'for i in cs.disasm(b,a)})
   manifest.append(dict(name=name,bytes=n,sha256=hashlib.sha256(b).hexdigest()))
  for a,want in ASSERTIONS.items():assert ins.get(a)==want,(hex(a),ins.get(a),want)
  classes=[(0x4548788,'17C_CS2HudModelArms'),(0x4407db8,'20CAnimGraphGameSystem'),(0x446eea8,'13C_CSGameRules')]
  for vt,name in classes:
   assert q(vt-16)==0
   assert read(q(q(vt-8)+8),len(name)+1)==(name+'\0').encode()
  bindings=[(0x4548788,0x430,0x1f87fa0),(0x4548788,0x8d0,0x1f96cc0),
            (0x4407db8,0x100,0xf61fb0),(0x4407db8,0xe0,0xf61fc0),
            (0x440a728,0x30,0xf10f40),(0x446eea8,0x218,0x1954470)]
  for vt,slot,target in bindings:assert q(vt+slot)==target
  jobname=read(q(q(0x440a728-8)+8),256).split(b'\0')[0]
  assert b'CAnimGraphGameSystem26UpdateAnimGraph2Animations' in jobname
  assert struct.unpack('<f',read(0xaffdb8,4))[0]==1/64
  u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000);u.mem_map(0x6000000,0x20000)
  for a,n in [(0xf06a30,0x9b),(0x16155c0,0x1b),(0x1f87fa0,3),(0x1389c40,0x2e),(0x1954250,0xc1),(0x25f0050,0x52),(0xaffdb8,4)]:u.mem_write(a,read(a,n))
  entity,identity,controller,owner,rules,globals_,stack,stop,ctx,transform=[0x6000000+i*0x1000 for i in range(10)]
  def writeq(a,v):u.mem_write(a,struct.pack('<Q',v))
  def writei(a,v):u.mem_write(a,struct.pack('<i',v))
  def getf(a):return struct.unpack('<f',u.mem_read(a,4))[0]
  writeq(entity,0x4548788);writeq(0x4548788+0x430,0x1f87fa0)
  writeq(entity+0x10,identity);writeq(rules,0x446eea8);writeq(0x446eea8+0x218,0x1954470)
  writeq(0x4933170,rules);writeq(0x467be58,globals_)
  lookups=[]
  def returned(value):
   u.reg_write(UC_X86_REG_RAX,value);sp=u.reg_read(UC_X86_REG_RSP)
   dest=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,dest)
  def hook(_u,a,n,_):
   if a==0x1610340:lookups.append('controller');returned(controller);return
   if a==0x17f2c20:lookups.append('owner');returned(owner);return
   assert any(lo<=a<lo+n for lo,n in [(0xf06a30,0x9b),(0x16155c0,0x1b),(0x1f87fa0,3),(0x1389c40,0x2e),(0x1954250,0xc1),(0x25f0050,0x2e)]),hex(a)
  u.hook_add(UC_HOOK_CODE,hook)
  scenarios=[('first',0,500,0,0,False),('one',500,501,0,0,False),('duplicate',500,500,0,0,False),
    ('rewind',500,490,0,0,False),('missed',500,505,0,0,False),('zero-first',0,0,0,0,False),
    ('paused-domain-zero',490,600,10,500,True),('paused-other-domain',490,600,10,500,True)]
  rows=[]
  for name,old,current,total,start,paused in scenarios:
   domain=1 if name=='paused-other-domain'else 0
   selected=current if domain else (min(current,start)if paused else current)-total
   delta=max(1 if old==0 else selected-old,0)/64
   for legacy_rate in [0.0,.25,73/74,1.0,2.0]:
    writei(controller+0xe4,old);u.mem_write(controller+0xd0,struct.pack('<f',legacy_rate))
    writei(identity+0x38,domain);writei(globals_+0x44,current);writei(rules+0x30,total);writei(rules+0x34,start);u.mem_write(rules+0x38,bytes([paused]))
    sp=stack+0x800;writeq(sp,stop);u.reg_write(UC_X86_REG_RSP,sp);u.reg_write(UC_X86_REG_RDI,entity)
    u.emu_start(0xf06a30,stop,count=500)
    assert u.reg_read(UC_X86_REG_RIP)==stop
    native=struct.unpack('<f',u.reg_read(UC_X86_REG_XMM0).to_bytes(16,'little')[:4])[0]
    stored=struct.unpack('<i',u.mem_read(controller+0xe4,4))[0]
    assert native==delta and stored==selected,(name,native,delta,stored,selected)
    u.reg_write(UC_X86_REG_RSP,sp);u.reg_write(UC_X86_REG_RDI,ctx);u.reg_write(UC_X86_REG_RSI,transform)
    u.emu_start(0x25f0050,0x25f007e,count=40)
    assert u.reg_read(UC_X86_REG_RIP)==0x25f007e and getf(ctx+0x68)==native
    rows.append(dict(case=name,priorGraphTick=old,globalTick=current,entityDomain=domain,totalPausedTicks=total,pauseStartTick=start,paused=paused,syntheticLegacyRate=legacy_rate,selectedTick=selected,nativeDelta=native,contextDelta=getf(ctx+0x68),storedGraphTick=stored))
  result=dict(clientSha256=SHA,wholeArtifactHashVerified=True,method=__doc__,ranges=manifest,
   assertions=dict(instructions=len(ASSERTIONS),classes=len(classes)+1,virtualTargets=len(bindings),constants=1),
   nativeCases=len(rows),rows=rows,maxDeltaError=0,
   findings=['Both inline and threaded AG2 workers call the same entity elapsed-tick getter and skip nonpositive deltas.',
    'C_CS2HudModelArms disables the predicted-owner override and consumes its entity-domain tick.',
    'The controller stores the selected tick and advances by max(previousTick==0?1:selectedTick-previousTick,0)/64 seconds.',
    'The graph context stores that elapsed delta unchanged before calling the graph root update. No mechanical reload-lock ratio occurs on this path.',
    'With no paused ticks, advancing game ticks therefore produces a 1x graph clock; rendering cadence and repeated calls do not imply elapsed animation time.'],
   limits=['Only object lookup is stubbed. Supplied object state is not a recording of native reload execution.',
    'First active reload sample and action-state transition phase remain unmeasured; no exact wall-clock/event phase or display-latency claim follows.',
    'Clip graph local multipliers/path selection are established separately by the pass29 current-build resource comparison.',
    'Synthetic legacy-rate bytes vary independently, but this replay does not enumerate every possible controller/state writer.',
    'C_CS2HudModelWeapon and other entities may select different clock branches; this proof is for the Arms graph callback.'])
  (OUT/'clock-proof.json').write_text(json.dumps(result,indent=2)+'\n')
  if args.portable_out:
   args.portable_out.parent.mkdir(parents=True,exist_ok=True)
   args.portable_out.write_text(json.dumps(result,indent=2)+'\n')
  print(json.dumps({k:result[k]for k in ['clientSha256','assertions','nativeCases','maxDeltaError']}))

if __name__=='__main__':main()
