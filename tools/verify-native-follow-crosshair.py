"""Execute the installed client HUD's projected-coordinate rounding block offline.

No game process is launched. Projection and viewport dimensions are supplied at
the block boundary; only the shipped float arithmetic and branches run natively.
"""
import hashlib
import argparse
import json
import math
from pathlib import Path
import struct
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('client', type=Path)
parser.add_argument('--write', action='store_true', help='Update the retained fixture instead of verifying it')
parser.add_argument('--report', type=Path, help='Optional full evidence report path')
args = parser.parse_args()
binary = args.client
sha = hashlib.sha256(binary.read_bytes()).hexdigest()
assert sha == 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
u = Uc(UC_ARCH_X86, UC_MODE_64)
u.mem_map(0, 0x5000000)
u.mem_map(0x6000000, 0x20000)
with binary.open('rb') as f:
    for segment in ELFFile(f).iter_segments():
        if segment['p_type'] == 'PT_LOAD':
            u.mem_write(segment['p_vaddr'], segment.data())

frame, state, stack = 0x6008000, 0x6000000, 0x601fff0
width, height = 0, 0
def write_float(address, value):
    u.mem_write(address, struct.pack('<f', value))

def shim(uc, address, size, data):
    if address == 0xc78e50:
        value = struct.unpack('<f', struct.pack('<I', uc.reg_read(UC_X86_REG_XMM0) & 0xffffffff))[0]
        write_float(uc.reg_read(UC_X86_REG_RDI), math.sin(value))
        write_float(uc.reg_read(UC_X86_REG_RSI), math.cos(value))
    else:
        uc.reg_write(UC_X86_REG_EAX, width if address == 0x19028d0 else height)
    sp = uc.reg_read(UC_X86_REG_RSP)
    uc.reg_write(UC_X86_REG_RIP, struct.unpack('<Q', uc.mem_read(sp, 8))[0])
    uc.reg_write(UC_X86_REG_RSP, sp + 8)

u.hook_add(UC_HOOK_CODE, shim, begin=0x19028a0, end=0x19028d0)
u.hook_add(UC_HOOK_CODE, shim, begin=0xc78e50, end=0xc78e50)
rows = []
for width, height in [(1920, 1080), (1280, 720), (801, 601)]:
    for dx, dy in [(0, 0), (.25, -.25), (.99, -.99), (1, -1),
                   (1.001, -1.001), (-1.001, 1.001), (1.5, -1.5),
                   (-2.1, 2.1), (20.25, -30.75), (-20.25, 30.75)]:
        ndc = [2 * dx / width, -2 * dy / height]
        write_float(frame - 0x94, 1)
        write_float(frame - 0x40, ndc[0])
        write_float(frame - 0x3c, ndc[1])
        write_float(state + 0x40, width / 2)
        write_float(state + 0x44, height / 2)
        write_float(state + 0xa4, math.trunc(width / 2))
        write_float(state + 0xa8, math.trunc(height / 2))
        for register, value in [(UC_X86_REG_RBP, frame), (UC_X86_REG_R15, state),
                                (UC_X86_REG_RSP, stack)]:
            u.reg_write(register, value)
        u.emu_start(0x1bf9406, 0x1bf94f0, count=200)
        assert u.reg_read(UC_X86_REG_RIP) == 0x1bf94f0
        screen = struct.unpack('<2f', u.mem_read(state + 0xa4, 8))
        rows.append(dict(viewport=[width, height], ndc=ndc, screen=list(screen),
                         offset=[screen[0] - width / 2, screen[1] - height / 2]))

directions = []
for yaw, pitch in [(0, 0), (30, 15), (-70, -40), (179, 70)]:
    for recoil_yaw, recoil_pitch in [(0, 0), (.8, 2.7), (-3, 9)]:
        write_float(state, -pitch - recoil_pitch)
        write_float(state + 4, yaw - recoil_yaw)
        write_float(state + 8, 0)
        u.mem_write(stack, struct.pack('<Q', 0x600f000))
        u.reg_write(UC_X86_REG_RSP, stack)
        u.reg_write(UC_X86_REG_RDI, state)
        u.emu_start(0x23b4360, 0x600f000, count=200)
        assert u.reg_read(UC_X86_REG_RIP) == 0x600f000
        packed = u.reg_read(UC_X86_REG_XMM0)
        read_float = lambda value: struct.unpack('<f', struct.pack('<I', value & 0xffffffff))[0]
        source_x, source_y, source_z = read_float(packed), read_float(packed >> 32), read_float(u.reg_read(UC_X86_REG_XMM1))
        directions.append(dict(yawDegrees=yaw, pitchDegrees=pitch,
                               recoil=dict(yaw=recoil_yaw, pitch=recoil_pitch),
                               direction=dict(x=-source_y, y=source_z, z=-source_x)))

out = dict(sha256=sha, boundary='Supplied predictable recoil plus input angles; native direction conversion with host sin/cos shims. Supplied projection and viewport; native HUD pixel conversion.',
           samples=rows, directions=directions)
fixture = Path(__file__).resolve().parents[1] / 'src/range/native-follow-crosshair-fixture.json'
if args.write:
    fixture.write_text(json.dumps(out, indent=2) + '\n')
else:
    assert json.loads(fixture.read_text()) == out, 'Native follow-crosshair fixture differs'
if args.report:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(out, indent=2) + '\n')
print(f'Emulated {len(rows)} native follow-crosshair pixel samples and {len(directions)} native direction samples.')
