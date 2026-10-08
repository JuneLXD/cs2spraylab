"""Evaluate only the installed client's camera-kick arithmetic, offline."""
import argparse, hashlib, json, math, struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('client', type=Path)
p.add_argument('--write', action='store_true')
a = p.parse_args(); sha = hashlib.sha256(a.client.read_bytes()).hexdigest()
assert sha == '99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12'
u = Uc(UC_ARCH_X86, UC_MODE_64); u.mem_map(0, 0x5000000); u.mem_map(0x6000000, 0x20000)
with a.client.open('rb') as stream:
 for s in ELFFile(stream).iter_segments():
  if s['p_type'] == 'PT_LOAD': u.mem_write(s['p_vaddr'], s.data())
def bits(x): return struct.unpack('<I', struct.pack('<f', x))[0]
def value(x): return struct.unpack('<f', struct.pack('<I', x & 0xffffffff))[0]
def f(x): return value(bits(x))
def ret():
 sp = u.reg_read(UC_X86_REG_RSP); dest = struct.unpack('<Q', u.mem_read(sp, 8))[0]
 u.reg_write(UC_X86_REG_RSP, sp + 8); u.reg_write(UC_X86_REG_RIP, dest)
def hook(uc, addr, size, data):
 x = value(u.reg_read(UC_X86_REG_XMM0))
 if addr == 0xc7c720: y = math.sin(x)
 elif addr == 0xc7d1f0: y = math.cos(x)
 elif addr == 0xc7bc50: y = math.exp(x)
 elif addr == 0x179f400: y = now
 else: raise RuntimeError('Unexpected call ' + hex(addr))
 u.reg_write(UC_X86_REG_XMM0, bits(y)); ret()
u.hook_add(UC_HOOK_CODE, hook, begin=0xc70000, end=0xc7edff)
u.hook_add(UC_HOOK_CODE, hook, begin=0x179f400, end=0x179f400)
base = 0x6000000; stack = 0x601fff8; end = 0x600f000; frame = 0x601ff00
u.mem_write(0x48fcc48, struct.pack('<Q', base + 0x100))
u.mem_write(base + 0x158, struct.pack('<f', 18))
shots = []
for angle in [-179, -53.5, 0, 27.333, 90, 179]:
 for magnitude in [0, 22.5, 75]:
  for previous in [[0, 0, 0], [-1.2, .4, .03]]:
   u.reg_write(UC_X86_REG_RBP, frame); u.reg_write(UC_X86_REG_RSP, frame - 0xa0)
   u.reg_write(UC_X86_REG_R15D, bits(magnitude)); u.reg_write(UC_X86_REG_R14D, bits(f(angle * f(math.pi / 180))))
   u.reg_write(UC_X86_REG_XMM0, bits(previous[0]) | bits(previous[1]) << 32)
   u.reg_write(UC_X86_REG_XMM1, bits(previous[2]))
   u.emu_start(0x1515609, 0x1515668, count=200)
   assert u.reg_read(UC_X86_REG_RIP) == 0x1515668
   shots.append(dict(angle=angle, magnitude=magnitude, previous=previous,
     result=list(struct.unpack('<3f', u.mem_read(frame - 0x3c, 12)))))
samples = []
for angle in [[-1.09936, -.56816, 0], [-1.8, .4, .03], [0, 0, 0]]:
 for elapsed in [-.1, 0, .001, .00390625, .0078125, .05, .1, .39, .7, 1, 2]:
  now = elapsed
  u.mem_write(base + 0x48, struct.pack('<3fif', *angle, 0, 0))
  u.mem_write(stack, struct.pack('<Q', end)); u.reg_write(UC_X86_REG_RSP, stack); u.reg_write(UC_X86_REG_RDI, base)
  u.emu_start(0x1525280, end, count=200)
  assert u.reg_read(UC_X86_REG_RIP) == end
  packed = u.reg_read(UC_X86_REG_XMM0)
  samples.append(dict(angle=angle, elapsed=elapsed, result=[value(packed), value(packed >> 32), value(u.reg_read(UC_X86_REG_XMM1))]))
composition = []
for previous in [[0, 0, 0], [-1.1, -.57, .03], [10, -25, 4]]:
 for physical in [[0, 0, 0], [-6, 2, 4], [-12, -.5, -27], [7, -4, 1]]:
  u.mem_write(base, struct.pack('<3f', *previous))
  u.reg_write(UC_X86_REG_R12, base); u.reg_write(UC_X86_REG_RBP, frame)
  u.reg_write(UC_X86_REG_XMM0, bits(physical[0]) | bits(physical[1]) << 32)
  u.reg_write(UC_X86_REG_XMM1, bits(physical[2]))
  u.emu_start(0x152bf2c, 0x152bf69, count=100)
  assert u.reg_read(UC_X86_REG_RIP) == 0x152bf69
  composition.append(dict(previous=previous, physical=physical, result=list(struct.unpack('<3f', u.mem_read(base, 12)))))
report = dict(build=2000927, clientSha256=sha, impulseEntry='0x1515609..0x1515668', decayEntry='0x1525280',
 method='Bounded offline Unicorn 2.1.4 x86-64 evaluation. Supplied camera/time state; no engine, OS, file or allocation calls. sinf, cosf and expf use host math rounded to float32. Native QAngle signs; default view_punch_decay=18.',
 shots=shots, samples=samples, compositionEntry='0x152bf2c..0x152bf69', composition=composition)
fixture = Path(__file__).resolve().parents[1] / 'src/range/native-view-punch-fixture.json'
if a.write: fixture.write_text(json.dumps(report, indent=2) + '\n')
else: assert json.loads(fixture.read_text()) == report
print('Verified', len(shots), 'native camera impulses and', len(samples), 'decay samples and', len(composition), 'camera compositions')
