"""Execute the installed server's footstep timer path offline with supplied scene state.
Rendering, sound emission, and pawn utility accessors are bounded host stubs.
No game process is launched. Raw layout details belong in this diagnostic only.
"""
import hashlib,json,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/'native-audit/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *
BINARY=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
SHA='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
assert hashlib.sha256(BINARY.read_bytes()).hexdigest()==SHA
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x4000000);u.mem_map(0x5000000,0x20000)
with BINARY.open('rb') as f:
 for s in ELFFile(f).iter_segments():
  if s['p_type']=='PT_LOAD':u.mem_write(s['p_vaddr'],s.data())
MOVE=0x5000000;PAWN=MOVE+0x2000;MVT=MOVE+0x4000;PVT=MOVE+0x5000
GLOBALS=MOVE+0x6000;CONVAR=MOVE+0x6100;POSITION=MOVE+0x6200;VELOCITY=MOVE+0x6300;SURFACE=MOVE+0x6400
STACK=MOVE+0x1fff8;END=MOVE+0x1f000;RET_FALSE=MOVE+0x1e000;RET_VOID=RET_FALSE+16
WRAPPER=0x15d41e0;MOVETYPE=0xd3bab0;WATERLEVEL=0xd43630;EMIT=0x17b0240

def wi(a,v):u.mem_write(a,struct.pack('<I',v))
def wq(a,v):u.mem_write(a,struct.pack('<Q',v))
def wf(a,v):u.mem_write(a,struct.pack('<f',v))
def rf(a):return struct.unpack('<f',u.mem_read(a,4))[0]
def ret(v=None):
 if v is not None:u.reg_write(UC_X86_REG_RAX,v)
 sp=u.reg_read(UC_X86_REG_RSP);target=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,target)
state={};events=[]
def hook(uc,a,size,data):
 if a==MOVETYPE:ret(state.get('moveType',2))
 elif a==WATERLEVEL:ret(state.get('waterLevel',0))
 elif a==RET_FALSE:ret(0)
 elif a==RET_VOID:ret()
 elif a==EMIT:
  v=u.reg_read(UC_X86_REG_XMM0)&0xffffffff;events.append(struct.unpack('<f',struct.pack('<I',v))[0]);ret()
for a in [MOVETYPE,WATERLEVEL,EMIT,RET_FALSE,RET_VOID]:u.hook_add(UC_HOOK_CODE,hook,begin=a,end=a)
# Resolve the active overrides from the current binary separately (REA vtable evidence).
wq(MOVE,MVT);wq(MOVE+0x38,PAWN);wq(PAWN,PVT)
for off,fn in [(0x1c0,0x17af550),(0x1c8,0x1580640),(0x1b8,EMIT)]:wq(MVT+off,fn)
for off,fn in [(0xc28,0xa23ef0),(0x548,0xa32810),(0xb98,RET_FALSE),(0xb88,RET_VOID),(0xb80,RET_VOID)]:wq(PVT+off,fn)
wq(0x2796428,GLOBALS);wi(GLOBALS+0x10,2);wq(0x2a19238,CONVAR);wf(CONVAR+0x58,1)
def step(speed,dt=1/64,walking=False,ducked=False,grounded=True,moveType=2,waterLevel=0,enabled=True):
 state.update(moveType=moveType,waterLevel=waterLevel)
 wi(PAWN+0x668,(1 if grounded else 0)|(2 if ducked else 0));u.mem_write(PAWN+0x1758,bytes([walking]));wf(GLOBALS+0x34,dt);wf(CONVAR+0x58,int(enabled))
 u.mem_write(VELOCITY,struct.pack('<3f',speed,0,0));wq(STACK,END)
 for r,v in [(UC_X86_REG_RSP,STACK),(UC_X86_REG_RDI,MOVE),(UC_X86_REG_RSI,SURFACE),(UC_X86_REG_RDX,POSITION),(UC_X86_REG_RCX,VELOCITY)]:u.reg_write(r,v)
 events.clear()
 try:u.emu_start(WRAPPER,END,count=20000)
 except Exception as e:raise RuntimeError(f'Unhandled native instruction at {u.reg_read(UC_X86_REG_RIP):x}') from e
 assert u.reg_read(UC_X86_REG_RIP)==END
 return {'remainingMs':rf(MOVE+600),'events':list(events)}
def probe(name,remainingMs=0,**kwargs):
 wf(MOVE+600,remainingMs);return {'name':name,'beforeMs':remainingMs,'input':kwargs,'after':step(**kwargs)}
rows=[]
for speed in [0,3.16,3.17,100,135,135.19,135.2,135.21,219.99,220,220.01,250]:
 for walking in [False,True]:
  rows.append(probe(f'gate-{speed}-{walking}',123,speed=speed,walking=walking))
for speed in [135.19,135.2,135.21,200,215,219.99,220,220.01,250]:
 for ducked in [False,True]:rows.append(probe(f'expire-{speed}-{ducked}',0,speed=speed,ducked=ducked))
for remainingMs in [0,1,7.8125,15.625,15.626,300,400]:
 for grounded in [False,True]:rows.append(probe(f'timer-{remainingMs}-{grounded}',remainingMs,speed=215,grounded=grounded))
for enabled in [False,True]:rows.append(probe(f'enabled-{enabled}',7,speed=215,enabled=enabled))
for i,(remainingMs,dt) in enumerate([(.1,.0001),(.3,.0003),(1,.001),(123.456,.123456),(.30000000000000004,.0003),(15.6249999,1/64)]):
 rows.append(probe(f'fractional-boundary-{i}',remainingMs,speed=215,dt=dt))
sequences=[];command_sequences=[]
for name,speed in [('ak47',215),('awp',200),('knife',250)]:
 wf(MOVE+600,0);step(0);out=[]
 for i in range(128*3):
  r=step(speed,1/128)
  if r['events']:out.append({'time':(i+1)/128,**r})
 sequences.append({'name':name,'speed':speed,'events':out})
 wf(MOVE+600,0);step(0);out=[]
 for i in range(64*3):
  r=step(speed,1/64)
  if r['events']:out.append({'time':(i+1)/64,**r})
 command_sequences.append({'name':name,'speed':speed,'events':out})
report={'binarySha256':SHA,'method':'Unicorn executes current server wrapper, base timer/generator and CS2 timer override; sound emission and scene accessors stubbed.','rows':rows,'sequences':sequences,'commandSequences':command_sequences,'limitations':['Synthetic supplied state; not a live server observation.','Flat dry normal movement only; material lookup, player sound routing, water, ladder and freeze/death states not reconstructed.','Command producer separately proves ordinary unchanged-input commands use one 64 Hz segment; exact input-fraction quantization and weapon/jump/landing segment inserts remain outside trainer parity.']}
output=ROOT.parent/'native-audit/reports/reaudit-footsteps/native-oracle.json';output.parent.mkdir(parents=True,exist_ok=True);output.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'rows':len(rows),'sequences':len(sequences),'output':str(output)}))
if '--fixture' in sys.argv:
 fixture={**report,'rows':[r for r in rows if r['input'].get('enabled',True)]}
 (ROOT/'src/range/native-footsteps-fixture.json').write_text(json.dumps(fixture,indent=2)+'\n')
