"""Bounded offline AirAccelerate arithmetic from the installed Linux server.

Run with PYTHONPATH=../native-audit/python. Pawn movement eligibility is stubbed;
only the hash-pinned arithmetic executes, without loading or launching CS2.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('server', type=Path)
parser.add_argument('--write', action='store_true')
args = parser.parse_args()
sha = hashlib.sha256(args.server.read_bytes()).hexdigest()
assert sha == 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a', 'Build changed: re-audit native path'
u = Uc(UC_ARCH_X86, UC_MODE_64)
u.mem_map(0, 0x4000000)
u.mem_map(0x6000000, 0x20000)
with args.server.open('rb') as stream:
    for segment in ELFFile(stream).iter_segments():
        if segment['p_type'] == 'PT_LOAD':
            u.mem_write(segment['p_vaddr'], segment.data())

def writef(address, value): u.mem_write(address, struct.pack('<f', value))
def writeq(address, value): u.mem_write(address, struct.pack('<Q', value))
def bits(value): return struct.unpack('<I', struct.pack('<f', value))[0]
def vec(address): return list(struct.unpack('<3f', u.mem_read(address, 12)))

move, pawn, data, wish, cvars, globals_, status = [0x6000000 + i * 0x2000 for i in range(7)]
stack, end = 0x601fff8, 0x601f000
writeq(move + 0x38, pawn)
writeq(pawn + 0xe10, status)
writeq(0x29a4178, cvars)
writeq(0x2796428, globals_)
writef(cvars + 0x58, 30)

def hook(machine, address, _size, _data):
    if 0x158c2a0 <= address < 0x158c560 or 0x158da60 <= address < 0x158dba0:
        return
    if address == 0xd40960:
        # Stationary support: GetBaseVelocity returns a zero vector.
        machine.reg_write(UC_X86_REG_XMM0, 0)
        machine.reg_write(UC_X86_REG_XMM1, 0)
    elif address == 0xd436b0:
        machine.reg_write(UC_X86_REG_RAX, 0)
    else:
        raise RuntimeError('Unexpected execution outside the isolated arithmetic: ' + hex(address))
    sp = machine.reg_read(UC_X86_REG_RSP)
    machine.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', machine.mem_read(sp, 8))[0])
    machine.reg_write(UC_X86_REG_RSP, sp + 8)

u.hook_add(UC_HOOK_CODE, hook)
samples = []
for speed in [150, 215, 250]:
    for dt in [1 / 256, 1 / 128, 1 / 64]:
        for current in [-40, 0, 20, 29, 30, 45]:
            u.mem_write(data, bytes(0x200))
            u.mem_write(wish, struct.pack('<3f', 1, 0, 0))
            writef(data + 0x38, current)
            writef(move + 0x26c, 1)
            writef(globals_ + 0x34, dt)
            writeq(stack, end)
            u.reg_write(UC_X86_REG_RSP, stack)
            u.reg_write(UC_X86_REG_RDI, move)
            u.reg_write(UC_X86_REG_RSI, data)
            u.reg_write(UC_X86_REG_RDX, wish)
            u.reg_write(UC_X86_REG_XMM0, bits(speed))
            u.reg_write(UC_X86_REG_XMM1, bits(12))
            u.emu_start(0x158c2a0, end, count=1000)
            assert u.reg_read(UC_X86_REG_RIP) == end
            during, deferred = vec(data + 0x38), vec(data + 0x110)
            samples.append(dict(wishSpeed=speed, dt=dt, current=current,
                                movementVelocity=during[0], deferredGain=deferred[0],
                                finalVelocity=during[0] + deferred[0]))

ground = []
for dt in [1 / 128, 1 / 64]:
    for before, after in [(0, 9.23828125), (215, 206.265625), (215, 111.8), (215, 150), (-4, 7), (3, 0)]:
        u.mem_write(data, bytes(0x200))
        writef(data + 0x38, after)
        writef(data + 0x104, (after - before) / dt)
        writef(globals_ + 0x34, dt)
        def run(address):
            writeq(stack, end)
            u.reg_write(UC_X86_REG_RSP, stack)
            u.reg_write(UC_X86_REG_RDI, move)
            u.reg_write(UC_X86_REG_RSI, data)
            u.emu_start(address, end, count=1000)
            assert u.reg_read(UC_X86_REG_RIP) == end
        run(0x158da60)
        during, deferred = vec(data + 0x38), vec(data + 0x110)
        run(0x158db30)
        ground.append(dict(initialVelocity=before, finalVelocity=after, dt=dt,
                           movementVelocity=during[0], deferredGain=deferred[0],
                           restoredVelocity=vec(data + 0x38)[0]))

report = dict(serverSha256=sha,
              method='Bounded Unicorn evaluation of native AirAccelerate, with dry-air eligibility supplied. '
                     'Native AirMove uses movementVelocity for its collision move and adds deferredGain afterward. '
                     'Ground phases execute the native pre/post-move helpers with a supplied net acceleration, '
                     'including a speed-cap correction. Fixtures exclude collision response, moving base velocity, '
                     'water, duck transitions and friction/acceleration generation.',
              samples=samples, groundPhases=ground)
fixture = Path(__file__).resolve().parents[1] / 'src/range/native-air-movement-fixture.json'
if args.write:
    fixture.write_text(json.dumps(report, indent=2) + '\n')
else:
    assert json.loads(fixture.read_text()) == report, 'Native air fixture changed'
print('Verified', len(samples), 'native air-acceleration and', len(ground), 'ground integration phase samples')
