"""Execute the current client's ordinary AK movement-bob block with supplied frame state."""
import hashlib,json,math,mmap,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'native-audit';sys.path.insert(0,str(ROOT/'python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
p=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so';f=p.open('rb');e=ELFFile(f);m=mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ)
sha=hashlib.sha256(m).hexdigest();assert sha=='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
segments=[s for s in e.iter_segments()if s['p_type']=='PT_LOAD']
def read(a,n):
 assert 0<n<=8192
 s=next(s for s in segments if s['p_vaddr']<=a and a+n<=s['p_vaddr']+s['p_filesz']);o=s['p_offset']+a-s['p_vaddr'];return m[o:o+n]
F=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
pack=lambda v:struct.pack('<'+str(len(v))+'f',*v)
bits=lambda v:int.from_bytes(pack(v),'little')
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000);u.mem_map(0x6000000,0x40000)
for s in segments:u.mem_write(s['p_vaddr'],s.data())
state=0x6000000;player=0x6004000;weapon=0x6008000;vdata=0x600c000;ident=0x6010000;node=0x6011000;origin=0x6012000;angles=0x6012100;frame=0x6030000
putq=lambda a,v:u.mem_write(a,struct.pack('<Q',v))
puti=lambda a,v:u.mem_write(a,struct.pack('<I',v))
putq(player+0x10,ident);putq(player+0x4a0,node);putq(weapon,0x448eb68);putq(weapon+0x4f8,vdata)
# Named schema fields m_flMaxSpeed, m_bHasBurstMode and m_nZoomLevels.
u.mem_write(vdata+0x748,pack([215,215]));puti(vdata+0x7f4,0);u.mem_write(vdata+0x71d,b'\0')
clock={'now':0.,'dt':1/60};calls={}
ranges=[(0x1fa68cb,0x1fa7954),(0xd8de20,0xd8de43),(0xdccde0,0xdcce26),(0x1467770,0x146777f),(0x146bf20,0x146bf49),(0x23b4580,0x23b4711)]
def scalar(reg):return struct.unpack('<f',u.reg_read(reg).to_bytes(16,'little')[:4])[0]
def ret():
 sp=u.reg_read(UC_X86_REG_RSP);dest=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,dest)
def hook(_,a,n,ctx):
 if a==0x1fa6f9c:u.emu_stop();return
 if any(lo<=a<hi for lo,hi in ranges):return
 calls[hex(a)]=calls.get(hex(a),0)+1
 if a in [0x1389c10,0x1389be0]:u.reg_write(UC_X86_REG_XMM0,bits([clock['now' if a==0x1389c10 else 'dt']]));ret();return
 if a==0xc78e50:
  x=scalar(UC_X86_REG_XMM0);u.mem_write(u.reg_read(UC_X86_REG_RDI),pack([math.sin(x)]));u.mem_write(u.reg_read(UC_X86_REG_RSI),pack([math.cos(x)]));ret();return
 if a in [0xc7a6a0,0xc7b170,0xc793d0]:
  x=scalar(UC_X86_REG_XMM0);y=scalar(UC_X86_REG_XMM1)
  value=math.sin(x)if a==0xc7a6a0 else math.cos(x)if a==0xc7b170 else math.fmod(x,y)
  u.reg_write(UC_X86_REG_XMM0,bits([value]));ret();return
 raise RuntimeError(f'Unexpected execution: {a:x}')
u.hook_add(UC_HOOK_CODE,hook)
def step(dt,velocity,base,grounded,entity_yaw,now,entity_quaternion=None):
 clock.update(now=F(now),dt=F(dt));puti(player+0x564,1 if grounded else 0)
 u.mem_write(player+0x5a0,pack(velocity));a=math.radians(entity_yaw)/2;u.mem_write(node+0x20,pack(entity_quaternion or [0,0,math.sin(a),math.cos(a)]))
 u.mem_write(origin,pack([0,0,0]));u.mem_write(angles,pack(base))
 for r,v in [(UC_X86_REG_RBX,state),(UC_X86_REG_R14,player),(UC_X86_REG_R15,weapon),(UC_X86_REG_R12,angles),(UC_X86_REG_R13,origin),(UC_X86_REG_RBP,frame),(UC_X86_REG_RSP,frame-0x200)]:u.reg_write(r,v)
 u.emu_start(0x1fa68cb,0x1fa6f9c,count=1600);assert u.reg_read(UC_X86_REG_RIP)==0x1fa6f9c
 get=lambda a,n:list(struct.unpack('<'+str(n)+'f',u.mem_read(a,4*n)))
 return dict(origin=get(origin,3),angles=get(angles,3),cycle=get(state+0x12d4,1)[0],velocity=get(state+0x12d8,4),bob=get(state+0x12e8,3),animationBob=get(state+0x12f4,2),air=get(state+0x131c,1)[0])
if __name__ == '__main__':
 rows=[]
 for case,dt,local,grounded,yaw,pitch,frames in [
  ('forward60',1/60,[215,0,0],True,0,0,90),('forward120',1/120,[215,0,0],True,0,0,180),
  ('strafe60',1/60,[0,215,0],True,0,0,90),('back60',1/60,[-215,0,0],True,0,0,90),
  ('rotated60',1/60,[215,0,0],True,90,0,90),('steep60',1/60,[215,0,0],True,0,-60,90),
  ('air60',1/60,[215,0,120],False,0,0,40),('air120',1/120,[215,0,120],False,0,0,40),
  ('zeroDelta',0,[215,0,0],True,0,0,3),('longFrame',.05,[215,0,0],True,0,0,12),
  ('nearLimit',.03,[215,0,0],True,0,0,12),('overLimit',.03001,[215,0,0],True,0,0,12),
  ]:
  u.mem_write(state+0x12d4,b'\0'*0x50);cy,sy=math.cos(math.radians(yaw)),math.sin(math.radians(yaw));world=[local[0]*cy-local[1]*sy,local[0]*sy+local[1]*cy,local[2]]
  samples=[]
  for i in range(frames):
   v=world if i<frames*2//3 else [0,0,0]
   g=grounded if i<frames*2//3 else True
   samples.append(dict(frame=i+1,dt=dt,now=(i+1)*dt,velocity=v,grounded=g,**{'out':step(dt,v,[pitch,yaw,0],g,yaw,(i+1)*dt)}))
  rows.append(dict(case=case,dt=dt,base=[pitch,yaw,0],entityYaw=yaw,samples=samples))
 report=dict(clientSha256=sha,method=__doc__,ranges=[dict(start=hex(lo),bytes=hi-lo,sha256=hashlib.sha256(read(lo,hi-lo)).hexdigest())for lo,hi in ranges],hostShims=calls,rows=rows,
  limits=['Supplied clocks, sampled velocity and entity rotation; no native rendering or prediction loop is executed.', 'Only ordinary non-burst/unscoped movement bob up to look-sway entry; other procedural motion is excluded.', 'Host V_sinf/V_cosf/V_fmodf/V_sincosf shims use Python math rounded to float32.'])
 out=ROOT/'reports/reaudit-bob-native.json';out.write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(dict(cases=len(rows),executions=sum(len(r['samples'])for r in rows),file=str(out),examples=[dict(case=r['case'],lastMoving=r['samples'][len(r['samples'])*2//3-1]['out'])for r in rows[:4]]),indent=2))
