"""Bounded offline evaluation of CS2's R8 windup and attack readiness arithmetic.

Run with pyelftools and Unicorn available, against the hash-pinned Linux server.
No game process, engine callback, allocator, file or network import executes.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('server', type=Path)
p.add_argument('--write', action='store_true')
args = p.parse_args()
sha = hashlib.sha256(args.server.read_bytes()).hexdigest()
assert sha == 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a', 'Revalidate changed server'
u = Uc(UC_ARCH_X86, UC_MODE_64)
u.mem_map(0, 0x5000000)
u.mem_map(0x6000000, 0x20000)
with args.server.open('rb') as stream:
    for segment in ELFFile(stream).iter_segments():
        if segment['p_type'] == 'PT_LOAD':
            u.mem_write(segment['p_vaddr'], segment.data())

# Saved Ghidra pseudocode uses an image base 0x100000 above ELF addresses.
# Constants below are ELF locations and remain only in this analysis tool.
weapon, identity, stack, stop = 0x6000000, 0x6003000, 0x6018000, 0x601f000
def q(address, value):
    u.mem_write(address, struct.pack('<Q', value))
def pair(tick, ratio):
    return struct.unpack('<Q', struct.pack('<if', tick, ratio))[0]
def unpack(value):
    tick, ratio = struct.unpack('<if', struct.pack('<Q', value))
    return dict(tick=tick, ratio=ratio)
def ret():
    sp = u.reg_read(UC_X86_REG_RSP)
    dest = struct.unpack('<Q', u.mem_read(sp, 8))[0]
    u.reg_write(UC_X86_REG_RSP, sp + 8)
    u.reg_write(UC_X86_REG_RIP, dest)

q(weapon + 0x10, identity)
u.mem_write(identity + 0x38, struct.pack('<i', 0))
captured, clock_value = None, 0
allowed = [(0x14b0209, 0x14b024a), (0x22b49a0, 0x22b4c00),
           (0x22b3c90, 0x22b3f90), (0x1499b20, 0x1499bb0),
           (0x1641710, 0x16417a0)]
def hook(uc, address, size, data):
    global captured
    if any(start <= address < end for start, end in allowed):
        return
    if address == 0x17fd290:  # supplied command tick + subtick ratio
        u.reg_write(UC_X86_REG_RAX, clock_value)
    elif address == 0x14a9d90:  # record postpone-ready setter argument
        captured = struct.unpack('<Q', u.mem_read(u.reg_read(UC_X86_REG_RSI), 8))[0]
    else:
        raise RuntimeError(f'Unexpected execution outside bounded arithmetic: {address:x}')
    ret()
u.hook_add(UC_HOOK_CODE, hook)

windup = []
for tick in [0, 100, 12345, 1000000]:
    for ratio in [0, .125, .5, .875, .999]:
        clock_value = pair(tick, ratio)
        captured = None
        u.reg_write(UC_X86_REG_RSP, stack - 0x100)
        u.reg_write(UC_X86_REG_RBP, stack)
        u.reg_write(UC_X86_REG_RBX, weapon)
        u.emu_start(0x14b0209, 0x14b024a, count=500)
        assert u.reg_read(UC_X86_REG_RIP) == 0x14b024a
        expected = pair(tick + 13, ratio)
        assert captured == expected
        windup.append(dict(command=unpack(clock_value), ready=unpack(captured), ticks=13))

readiness = []
for kind, entry, field in [('primary', 0x1641710, 0x1190), ('revolver', 0x1499b20, 0x1278)]:
    for due_tick, due_ratio in [(100, 0), (100, .25), (100, .999)]:
        u.mem_write(weapon + field, struct.pack('<if', due_tick, due_ratio))
        for now_tick, now_ratio in [(99, .999), (100, 0), (100, .125), (100, .25), (100, .5), (100, .999), (101, 0)]:
            clock_value = pair(now_tick, now_ratio)
            q(stack, stop)
            u.reg_write(UC_X86_REG_RSP, stack)
            u.reg_write(UC_X86_REG_RDI, weapon)
            u.emu_start(entry, stop, count=500)
            assert u.reg_read(UC_X86_REG_RIP) == stop
            actual = bool(u.reg_read(UC_X86_REG_RAX) & 0xff)
            assert actual == ((now_tick, now_ratio) >= (due_tick, due_ratio))
            readiness.append(dict(kind=kind, due=unpack(pair(due_tick, due_ratio)), command=unpack(clock_value), ready=actual))

report = dict(build='2000930', serverSha256=sha,
    method='Bounded native instruction emulation: R8 deadline initialization, tick/ratio normalization and addition, and ordinary-primary/R8 readiness comparators. The command clock is supplied and the setter argument captured. No engine or OS calls execute.',
    windupTicks=13, tickInterval=1 / 64, windupSeconds=13 / 64,
    limitations=['Does not measure physical click latency or the time until the first engine command processes a press.',
                 'Readiness arithmetic does not establish whether a fresh early press preserves or resets the later firing schedule.',
                 'Does not emulate full item-postframe, reload/deploy gates, release handling, or complete revolver attack animation.'],
    windup=windup, readiness=readiness)
fixture = Path(__file__).resolve().parents[1] / 'src/range/native-fire-readiness-fixture.json'
if args.write:
    fixture.write_text(json.dumps(report, indent=2) + '\n')
else:
    assert json.loads(fixture.read_text()) == report
print(f'Verified {len(windup)} R8 windup and {len(readiness)} attack-readiness cases')
