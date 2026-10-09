"""Bounded current-server accuracy-update emulation; no engine or OS execution.

Uses private Unicorn memory. Owner/movement/query callbacks return supplied
state, setters are no-ops, and host log/exp supply math imports. Every other
instruction must remain in the declared update/recovery/helper functions.
This establishes arithmetic per invocation, not the engine's invocation order.
"""
import hashlib,json,math,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT.parent/'native-audit/python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
path=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
sha=hashlib.sha256(path.read_bytes()).hexdigest()
assert sha=='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a','Revalidate changed native artifact'
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000);u.mem_map(0x6000000,0x20000)
with path.open('rb')as f:
 for s in ELFFile(f).iter_segments():
  if s['p_type']=='PT_LOAD':u.mem_write(s['p_vaddr'],s.data())
weapon,owner,vdata,wtable,ptable,identity,stack,stop=0x6000000,0x6003000,0x6005000,0x6007000,0x6009000,0x600a000,0x601e000,0x601f000
f32=lambda v:struct.unpack('<f',struct.pack('<f',v))[0]
bits=lambda v:struct.unpack('<I',struct.pack('<f',v))[0]
value=lambda v:struct.unpack('<f',struct.pack('<I',v&0xffffffff))[0]
def q(p,v):u.mem_write(p,struct.pack('<Q',v))
def f(p,v):u.mem_write(p,struct.pack('<f',v))
def i(p,v):u.mem_write(p,struct.pack('<i',v))
def readf(p):return struct.unpack('<f',u.mem_read(p,4))[0]
def ret():
 sp=u.reg_read(UC_X86_REG_RSP);target=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,target)
q(weapon,wtable);q(owner,ptable);q(weapon+0x600,vdata);q(weapon+0x10,identity)
for offset,entry in [(0xc00,0x14442b0),(0xc08,0x14442e0),(0xc10,0x1444310),(0xc20,0x1444370),(0xbf0,0x1444270)]:q(wtable+offset,entry)
GROUND=0x6010100;q(ptable+0x658,GROUND)
for n,(location,val)in enumerate([(0x29613c8,0),(0x29612f8,0),(0x2961398,1)]):
 addr=0x600b000+n*0x100;q(location,addr);f(addr+0x58,val)
now=0;grounded=True
allowed=[(0x14a5310,0x14a58e0),(0x14988d0,0x1498a30),(0x14a3eb0,0x14a3f10)]
def hook(uc,a,size,data):
 if any(lo<=a<hi for lo,hi in allowed):return
 if a==0x1641650:u.reg_write(UC_X86_REG_RAX,owner)
 elif a==0xd3bab0:u.reg_write(UC_X86_REG_RAX,0)
 elif a==GROUND:u.reg_write(UC_X86_REG_RAX,int(grounded))
 elif a==0x134e850:u.reg_write(UC_X86_REG_XMM0,bits(now))
 elif a==0x9fd390:u.reg_write(UC_X86_REG_XMM0,bits(math.log(value(u.reg_read(UC_X86_REG_XMM0)))))
 elif a==0x9fc7d0:u.reg_write(UC_X86_REG_XMM0,bits(math.exp(value(u.reg_read(UC_X86_REG_XMM0)))))
 elif a in [0x14a41d0,0x14a50c0]:pass
 else:raise RuntimeError(f'Unexpected instruction outside bounded ranges: {a:x}')
 ret()
u.hook_add(UC_HOOK_CODE,hook)

def update(base,stats,mode,stance,penalty,index,time,last_shot=0):
 global now,grounded
 now=f32(time);grounded=stance!='air';i(owner+0x668,(1 if grounded else 0)|(2 if stance=='crouch' else 0));i(weapon+0x1248,mode)
 for offset,key in [(0x758,'crouch'),(0x760,'stand'),(0x768,'jump'),(0x738,'cycle')]:
  f(vdata+offset,base[key]);f(vdata+offset+4,stats[key])
 for offset,key in [(0x840,'recoveryCrouch'),(0x844,'recovery'),(0x848,'recoveryCrouchFinal'),(0x84c,'recoveryFinal')]:f(vdata+offset,stats[key])
 i(vdata+0x850,stats['recoveryStart']);i(vdata+0x854,stats['recoveryEnd'])
 f(weapon+0x1260,penalty);f(weapon+0x1270,index);f(weapon+0x1310,last_shot)
 q(stack,stop);u.reg_write(UC_X86_REG_RSP,stack);u.reg_write(UC_X86_REG_RDI,weapon)
 u.emu_start(0x14a5310,stop,count=2000)
 assert u.reg_read(UC_X86_REG_RIP)==stop
 return {'penalty':readf(weapon+0x1260),'index':readf(weapon+0x1270)}

game=json.loads((ROOT/'src/range/game-data.json').read_text())['weapons'];rows=[]
for name,base in game.items():
 for mode in [0,1]:
  stats=base if mode==0 else dict(base,**base['alternate'])
  for stance in ['stand','crouch','air']:
   baseline=stats['stand']+stats['jump'] if stance=='air' else stats['crouch'] if stance=='crouch' else stats['stand']
   for index in sorted(set([0,.05,.1,.1001,1,2.99,3,5,max(0,stats['recoveryStart']-.0001),stats['recoveryStart'],max(0,stats['recoveryEnd']-.0001),stats['recoveryEnd'],stats['recoveryEnd']+1])):
    for extra in [-.001,0,.001,.2]:
     threshold=f32(f32(base['cycle'])+f32(1/64))
     for gate,time in [('before',threshold-1e-5),('equal',threshold),('after',threshold+1e-5),('late',1.0)]:
      actual=update(base,stats,mode,stance,baseline+extra,index,time)
      rows.append(dict(weapon=name,mode=mode,stance=stance,penalty=baseline+extra,index=index,time=time,gate=gate,actual=actual))
report=dict(serverSha256=sha,method=__doc__,samples=rows)
out=ROOT.parent/'native-audit/reports/reaudit-accuracy-native.json';out.write_text(json.dumps(report,separators=(',',':'))+'\n')
print('Saved',len(rows),'bounded native updates to',out)
