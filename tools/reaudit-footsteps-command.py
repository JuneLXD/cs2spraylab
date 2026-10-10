"""Run native movement-segment construction for controlled commands offline."""
import runpy,math,json,struct
from pathlib import Path
m=runpy.run_path(str(Path(__file__).with_name('reaudit-footsteps-native.py')))
u=m['u'];MOVE=m['MOVE'];PAWN=m['PAWN'];MVT=m['MVT'];PVT=m['PVT'];wf=m['wf'];wi=m['wi'];wq=m['wq'];ret=m['ret']
from unicorn import UC_HOOK_CODE
from unicorn.x86_const import *
CMD=MOVE+0x8000;BASE=MOVE+0x8200;ANGLES=MOVE+0x8400;DATA=MOVE+0x9000;SEGMENTS=MOVE+0xa000;EDGES=MOVE+0xb000
wq(MVT+0x128,0x15d3670);wq(PVT+0xcb8,0x157e850);wq(MOVE+0x6d8,MOVE)
wq(0x29a40b8,m['CONVAR']+0x100);wf(m['CONVAR']+0x158,0)
wq(0x29a4598,m['CONVAR']+0x200);wf(m['CONVAR']+0x258,0.015625)
wq(CMD+0x40,BASE);wq(BASE+0x40,ANGLES);wq(DATA+0x68,SEGMENTS);wi(DATA+0x70,32)
wq(DATA+0x80,SEGMENTS+0x500);wi(DATA+0x88,16)
wq(BASE+0x28,EDGES);wq(EDGES+8,EDGES+0x100)
wi(m['GLOBALS']+0x44,6401);wi(DATA+0xd4,6400);wi(DATA+0xd8,6401)
def floatreg(r):return struct.unpack('<f',struct.pack('<I',u.reg_read(r)&0xffffffff))[0]
def hook(uc,a,size,data):
 if a==0x17b8600:ret(1)
 elif a==0x17d8f30:ret(0)
 elif a==0x134e910:ret(u.reg_read(UC_X86_REG_EDI))
 elif a==0x9fc230:
  v=math.fmod(floatreg(UC_X86_REG_XMM0),floatreg(UC_X86_REG_XMM1));u.reg_write(UC_X86_REG_XMM0,struct.unpack('<I',struct.pack('<f',v))[0]);ret()
for a in [0x17b8600,0x17d8f30,0x134e910,0x9fc230]:u.hook_add(UC_HOOK_CODE,hook,begin=a,end=a)
rows=[]
for edge in [None,.25,.5,.9]:
 wi(BASE+0x20,0 if edge is None else 1)
 if edge is not None:
  wq(EDGES+0x118,0x200);u.mem_write(EDGES+0x120,b'\1');wf(EDGES+0x124,edge)
 wq(m['STACK'],m['END'])
 for r,v in [(UC_X86_REG_RSP,m['STACK']),(UC_X86_REG_RDI,MOVE),(UC_X86_REG_RSI,CMD),(UC_X86_REG_RDX,DATA),(UC_X86_REG_RCX,0)]:u.reg_write(r,v)
 try:u.emu_start(0x17c5c50,m['END'],count=100000)
 except Exception as e:raise RuntimeError(f'Unhandled instruction {u.reg_read(UC_X86_REG_RIP):x}')from e
 assert u.reg_read(UC_X86_REG_RIP)==m['END']
 n=struct.unpack('<I',u.mem_read(DATA+0x60,4))[0]
 rows.append({'inputEdgeFraction':edge,'nativeFractions':[m['rf'](SEGMENTS+i*32)for i in range(n)]})
report={'binarySha256':m['SHA'],'rows':rows,'method':'Native command segment producer and CS movement override; no weapon, jump or landing transition in the supplied tick. Accessor/time-offset and fmodf imports are host shims.','limitation':'Controlled supplied command; not a live command capture.'}
p=m['ROOT'].parent/'native-audit/reports/reaudit-footsteps/native-command-segments.json';p.write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))
