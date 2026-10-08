"""Verify the native stationary-ground landing camera-pitch branch offline."""
import argparse, hashlib, json, math, struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *
p = argparse.ArgumentParser(description=__doc__); p.add_argument('client', type=Path); p.add_argument('--write', action='store_true'); args = p.parse_args()
sha = hashlib.sha256(args.client.read_bytes()).hexdigest()
assert sha == '99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12'
u = Uc(UC_ARCH_X86, UC_MODE_64); u.mem_map(0, 0x5000000); u.mem_map(0x6000000, 0x20000)
with args.client.open('rb') as stream:
 for s in ELFFile(stream).iter_segments():
  if s['p_type'] == 'PT_LOAD': u.mem_write(s['p_vaddr'], s.data())
def bits(x): return struct.unpack('<I', struct.pack('<f', x))[0]
def value(x): return struct.unpack('<f', struct.pack('<I', x & 0xffffffff))[0]
def writef(p, x): u.mem_write(p, struct.pack('<f', x))
def writeq(p, x): u.mem_write(p, struct.pack('<Q', x))
def ret():
 sp = u.reg_read(UC_X86_REG_RSP); dest = struct.unpack('<Q', u.mem_read(sp, 8))[0]
 u.reg_write(UC_X86_REG_RSP, sp + 8); u.reg_write(UC_X86_REG_RIP, dest)
move=0x6000000; pawn=0x6001000; camera=0x6003000; vtable=0x6004000; ground=0x6005000
stack=0x601fff8; end=0x600f000; groundfn=0x6008000
writeq(move+0x38,pawn);writeq(pawn,vtable);writeq(vtable+0x5b8,groundfn);writeq(pawn+0x12b0,camera)
u.mem_write(pawn+0x4bc,struct.pack('<i',100));writeq(0x48fcc48,0x6006000);writef(0x6006058,18)

def hook(uc, addr, size, data):
 global written, impact
 # Only the landing function and two tiny read-only predicates execute.
 if 0x158b920 <= addr < 0x158be29 or 0xd91660 <= addr <= 0xd9168c or 0xd79660 <= addr <= 0xd79662: return
 if addr == groundfn: u.reg_write(UC_X86_REG_RAX, ground)
 elif addr == 0xd90a40: u.reg_write(UC_X86_REG_XMM0,0); u.reg_write(UC_X86_REG_XMM1,0)
 elif addr == 0x179f400: u.reg_write(UC_X86_REG_XMM0,bits(age))
 elif addr == 0xc7bc50: u.reg_write(UC_X86_REG_XMM0,bits(math.exp(value(u.reg_read(UC_X86_REG_XMM0)))))
 elif addr == 0x179f470:
  written = list(struct.unpack('<3f',u.mem_read(u.reg_read(UC_X86_REG_RSI),12)))
 elif addr == 0x1581570: impact = True  # landing sound/roll, outside this pitch-only audit
 elif addr in [0x157a430,0x158b850]: pass  # impact notification / landing bookkeeping
 else: raise RuntimeError('Unexpected execution outside isolated landing path: '+hex(addr))
 ret()
u.hook_add(UC_HOOK_CODE,hook)
rows=[]
for speed in [-1,0,100,249.99,250,250.01,260,301.993,349.99,350,580,750,900,1024,1024.01,1200]:
 for age in [0,.05]:
  written=None;impact=False;writef(move+0x25c,speed)
  u.mem_write(camera+0x48,struct.pack('<3fif',-1.2,.4,.03,0,0));writeq(stack,end)
  u.reg_write(UC_X86_REG_RSP,stack);u.reg_write(UC_X86_REG_RDI,move);u.reg_write(UC_X86_REG_RSI,0x6007000)
  u.emu_start(0x158b920,end,count=2000);assert u.reg_read(UC_X86_REG_RIP)==end
  rows.append(dict(speed=speed,age=age,previous=[-1.2,.4,.03],result=written,heavyImpact=impact))
report=dict(build=2000927,clientSha256=sha,entry='0x158b920',
 method='Bounded Unicorn 2.1.4 evaluation of the landing function on dry, stationary ground, living player. Only that function and two tiny native read-only predicates execute. Ground identity/velocity and clock are supplied; camera setter records its argument. Sound/roll, impact notification and final bookkeeping are stubbed. expf uses host math rounded to float32. Result null means no pitch-set call. Heavy landing roll and moving-support/water effects are outside this fixture.',samples=rows)
fixture=Path(__file__).resolve().parents[1]/'src/range/native-landing-camera-fixture.json'
if args.write:fixture.write_text(json.dumps(report,indent=2)+'\n')
else:assert json.loads(fixture.read_text())==report
print('Verified',len(rows),'native stationary-ground landing pitch cases')
