"""Emulate only the installed client's bounded FOV arithmetic block; no OS calls."""
import argparse,hashlib,json,struct,sys
from pathlib import Path
# Dependencies: pyelftools 0.32 and unicorn 2.1.4, installed in an isolated environment.
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64
from unicorn.x86_const import UC_X86_REG_RBX,UC_X86_REG_RBP,UC_X86_REG_XMM0,UC_X86_REG_XMM1,UC_X86_REG_RIP,UC_X86_REG_R12,UC_X86_REG_R13
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('client',type=Path,help='Installed Linux libclient.so (build 2000927)')
parser.add_argument('--write',action='store_true',help='Regenerate the numeric fixture')
args=parser.parse_args()
path=args.client;sha=hashlib.sha256(path.read_bytes()).hexdigest()
assert sha=='99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12','Revalidate changed client'
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000);u.mem_map(0x6000000,0x20000)
with path.open('rb') as f:
 e=ELFFile(f)
 for segment in e.iter_segments():
  if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
obj=0x6000000;stack=0x6010000;rows=[]
def fbits(n):return struct.unpack('<I',struct.pack('<f',n))[0]
def fval(n):return struct.unpack('<f',struct.pack('<I',n&0xffffffff))[0]
for start,end,rate in [(90,40,.05),(40,10,.05),(10,90,.05),(90,40,.1),(73,40,.05)]:
 for elapsed in [-.01,0,rate*.1,rate*.25,rate*.5,rate*.75,rate*.9,rate,rate+.1]:
  u.mem_write(obj+0x2a4,struct.pack('<Iff',start,0.,rate));u.mem_write(stack-0x14,struct.pack('<f',end))
  u.reg_write(UC_X86_REG_RBX,obj);u.reg_write(UC_X86_REG_RBP,stack);u.reg_write(UC_X86_REG_XMM0,fbits(elapsed))
  u.emu_start(0x152ba7d,0x152b9fb,count=200)
  assert u.reg_read(UC_X86_REG_RIP)==0x152b9fb
  value=fval(u.reg_read(UC_X86_REG_XMM1));t=max(0,min(1,elapsed/rate));expected=start+(end-start)*t*t*(3-2*t)
  assert abs(value-expected)<.00002,(value,expected)
  rows.append(dict(start=start,target=end,duration=rate,elapsed=elapsed,fov=value))
report=dict(build=2000927,clientSha256=sha,source='cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so',method='Unicorn emulation of arithmetic-only block; actual-time function call excluded and elapsed time supplied explicitly; no imports or OS calls executed.',startAddress='0x152ba7d',stopAddress='0x152b9fb',schemaOffsets=dict(start='0x2a4',startTime='0x2a8',duration='0x2ac'),curve='start + (target - start) * t * t * (3 - 2*t), t = clamp((time - startTime)/duration, 0, 1)',samples=rows)
sensitivity=[]
# Scalar arithmetic only, supplied current/default/minimum FOV and convar values.
# Both branches stop before the epilogue; no virtual call or engine object runs.
ratio_obj=0x6008000
u.mem_write(0x492aa18,struct.pack('<Q',ratio_obj))
u.mem_write(0x493a0f8,struct.pack('<Q',ratio_obj+0x100))
u.mem_write(ratio_obj+0x158,struct.pack('<f',1))
for fov in [90.,89.99,82.1875,65.,47.8125,40.,39.999,15.,10.,5.]:
 for ratio in [.75,1.,1.25]:
  u.mem_write(stack-0x24,struct.pack('<f',fov))
  u.mem_write(ratio_obj+0x58,struct.pack('<f',ratio))
  u.reg_write(UC_X86_REG_R12,obj);u.reg_write(UC_X86_REG_R13,90)
  u.reg_write(UC_X86_REG_RBP,stack);u.reg_write(UC_X86_REG_XMM0,fbits(10))
  u.emu_start(0x1860345,0x18603b8,count=100)
  assert u.reg_read(UC_X86_REG_RIP)==0x18603b8
  result=struct.unpack('<f',u.mem_read(obj+0x1424,4))[0]
  integer=max(10,int(fov));expected=1 if integer==90 else integer/90*ratio
  assert abs(result-expected)<.000001
  sensitivity.append(dict(fov=fov,zoomRatio=ratio,scale=result))
report['sensitivity']=dict(startAddress='0x1860345',stopAddress='0x18603b8',minimumFov=10,samples=sensitivity)
iron_sight=[]
for progress in [0,.1,.25,.5,.75,.9,1]:
 u.reg_write(UC_X86_REG_XMM0,fbits(progress));u.reg_write(UC_X86_REG_XMM1,fbits(.2))
 u.emu_start(0x23bc270,0x23bc2c4,count=100)
 assert u.reg_read(UC_X86_REG_RIP)==0x23bc2c4
 alpha=fval(u.reg_read(UC_X86_REG_XMM0))
 assert abs(alpha-progress/(4-3*progress))<.000001
 iron_sight.append(dict(progress=progress,alpha=alpha,fov=90-45*alpha))
report['ironSight']=dict(startAddress='0x23bc270',stopAddress='0x23bc2c4',bias=.2,caller='0x14dd633',fovCaller='0x14de8b0',samples=iron_sight)
if args.write:
 Path(__file__).resolve().parents[1].joinpath('src/range/native-fov-fixture.json').write_text(json.dumps(report,indent=2)+'\n')
print('Verified',len(rows),'camera,',len(sensitivity),'sensitivity and',len(iron_sight),'iron-sight samples against hash-pinned native arithmetic')
