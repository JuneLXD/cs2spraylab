"""Offline native aim-punch sampler with supplied inputs and host math shims."""
import argparse,hashlib,json,math,struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('client',type=Path,help='Installed Linux libclient.so, build 2000927')
parser.add_argument('--write',action='store_true',help='Regenerate the numeric fixture')
args=parser.parse_args()
path=args.client;raw=path.read_bytes();sha=hashlib.sha256(raw).hexdigest()
assert sha=='99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12'
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000);u.mem_map(0x6000000,0x20000)
with path.open('rb') as f:
 for s in ELFFile(f).iter_segments():
  if s['p_type']=='PT_LOAD':u.mem_write(s['p_vaddr'],s.data())
def bits(n):return struct.unpack('<I',struct.pack('<f',n))[0]
def value(n):return struct.unpack('<f',struct.pack('<I',n&0xffffffff))[0]
def xmm(n):return value(u.reg_read(n))
def writef(p,n):u.mem_write(p,struct.pack('<f',n))
def ret():
 sp=u.reg_read(UC_X86_REG_RSP);addr=struct.unpack('<Q',u.mem_read(sp,8))[0];u.reg_write(UC_X86_REG_RSP,sp+8);u.reg_write(UC_X86_REG_RIP,addr)
def hook(uc,a,size,data):
 x=xmm(UC_X86_REG_XMM0)
 if a==0xc7bc50:y=math.exp(x)
 elif a==0xc7aed0:
  writef(u.reg_read(UC_X86_REG_RDI),math.sin(x));writef(u.reg_read(UC_X86_REG_RSI),math.cos(x));ret();return
 elif a==0xc7c470:
  y,whole=math.modf(x);writef(u.reg_read(UC_X86_REG_RDI),whole)
 elif a==0xc7ba90:y=math.pow(x,xmm(UC_X86_REG_XMM1))
 elif a==0xc7c1f0:y=math.atan2(x,xmm(UC_X86_REG_XMM1))
 else:raise RuntimeError('Unexpected import '+hex(a))
 u.reg_write(UC_X86_REG_XMM0,bits(y));ret()
u.hook_add(UC_HOOK_CODE,hook,begin=0xc70000,end=0xc7edff)
cache=0x6000000;angles=0x6001000;vel=angles+0x20;target=angles+0x40;buffer=0x6002000;stack=0x601fff8;end=0x600f000

def sample(angle,velocity,elapsed,physical=True):
 u.mem_write(cache,bytes(64));u.mem_write(cache+0x28,struct.pack('<QII',buffer,256,0));u.mem_write(angles,struct.pack('<3f',*angle));u.mem_write(vel,struct.pack('<3f',*velocity))
 ticks=elapsed*64;t=math.floor(ticks);u.mem_write(target,struct.pack('<if',t,ticks-t));u.mem_write(stack,struct.pack('<Q',end));
 for r,v in [(UC_X86_REG_RSP,stack),(UC_X86_REG_RDI,cache),(UC_X86_REG_ESI,0),(UC_X86_REG_XMM0,0),(UC_X86_REG_RDX,angles),(UC_X86_REG_RCX,vel),(UC_X86_REG_R8,target),(UC_X86_REG_R9,int(physical))]:u.reg_write(r,v)
 try:u.emu_start(0x15147a0,end,count=1000000)
 except Exception as e:raise RuntimeError(hex(u.reg_read(UC_X86_REG_RIP))) from e
 assert u.reg_read(UC_X86_REG_RIP)==end
 packed=u.reg_read(UC_X86_REG_XMM0);out=[value(packed),value(packed>>32),xmm(UC_X86_REG_XMM1)]
 return dict(angle=angle,velocity=velocity,elapsed=elapsed,physical=physical,result=out)
rows=[]
for a,v in [([0,0,0],[-19.9884243011,-10.3301944733,0]),([-3.1,.24,0],[-151.3,-20.59,0]),([.02,0,0],[0,0,0]),([.03125,0,0],[0,0,0]),([90,-90,0],[0,0,0]),([10,4,1],[-30,40,5])]:
 for t in [0,.001,.00390625,.0078125,.0101,.05,.1,.390625,.7,1.,1.3,2.]:
  rows.append(sample(a,v,t))
report=dict(build=2000927,clientSha256=sha,entry='0x15147a0',
 method='Offline Unicorn 2.1.4 x86-64 emulation with pyelftools 0.32. Caller-owned cache and time inputs; no allocation, engine, file or OS calls. V_expf, V_sincosf, V_modff, V_powf and V_atan2f imports use host math rounded to float32. libtier0 forwards these to libm; last-bit library differences remain possible.',
 physicalScale=2,cacheHz=128,cacheSteps=128,angleCutoff=.03125,samples=rows)
fixture=Path(__file__).resolve().parents[1]/'src/range/native-recovery-fixture.json'
if args.write:fixture.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(fixture.read_text())==report,'Native recovery fixture differs'
print('Verified',len(rows),'native recovery samples')
