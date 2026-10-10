"""Evaluate current client/server camera arithmetic in bounded private memory.

Actual sampler, ordinary time accessor, shot impulse instructions and client
explicit-anchor setter execute in Unicorn. Only sinf/cosf/expf are host shims.
Supplied state does not emulate command history, prediction or full rendering.
"""
import hashlib, json, math, struct, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT.parent / 'native-audit'
sys.path.insert(0, str(AUDIT / 'python'))
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

F = lambda x: struct.unpack('<f', struct.pack('<f', x))[0]
bits = lambda x: struct.unpack('<I', struct.pack('<f', x))[0]
value = lambda x: struct.unpack('<f', struct.pack('<I', x & 0xffffffff))[0]
profiles = {
    'client': dict(sha='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1',
        sampler=(0x1521ac0, 0x1521b55), clock=(0x179c700, 0x179c76b),
        global_ptr=0x467be58, decay_ptr=0x48f51c8, math={0xc7a6a0: math.sin, 0xc7b170: math.cos, 0xc79bd0: math.exp},
        impulse=(0x1511e49, 0x1511ea8), output=-0x3c,
        setter=(0x179c770, 0x179c8f1), disabled_ptr=0x4919488),
    'server': dict(sha='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a',
        sampler=(0x152c800, 0x152c895), clock=(0x17b63f0, 0x17b6400),
        global_ptr=0x2796428, decay_ptr=0x29a4168, math={0x9fd080: math.sin, 0x9fd8b0: math.cos, 0x9fc7d0: math.exp},
        impulse=(0x151b4c4, 0x151b52d), output=-0x70),
}

class NativeCamera:
    def __init__(self, side):
        self.side, self.p = side, profiles[side]
        path = ROOT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64' / f'lib{side}.so'
        self.sha = hashlib.sha256(path.read_bytes()).hexdigest()
        assert self.sha == self.p['sha'], 'Revalidate changed native binary'
        self.u = u = Uc(UC_ARCH_X86, UC_MODE_64)
        u.mem_map(0, 0x5000000); u.mem_map(0x6000000, 0x20000)
        with path.open('rb') as stream:
            for s in ELFFile(stream).iter_segments():
                if s['p_type'] == 'PT_LOAD': u.mem_write(s['p_vaddr'], s.data())
        self.camera, self.global_state, self.convar = 0x6000000, 0x6001000, 0x6002000
        self.owner, self.argument, self.input, self.disabled = 0x6003000, 0x6004000, 0x6005000, 0x6006000
        self.stack, self.stop, self.frame = 0x601fff8, 0x601f000, 0x601fe00
        self.q(self.camera + 0x38, self.owner)
        self.q(self.p['global_ptr'], self.global_state)
        self.q(self.p['decay_ptr'], self.convar); self.f(self.convar + 0x58, 18)
        if side == 'client': self.q(self.p['disabled_ptr'], self.disabled)
        u.hook_add(UC_HOOK_CODE, self.hook)

    def q(self, p, v): self.u.mem_write(p, struct.pack('<Q', v))
    def f(self, p, v): self.u.mem_write(p, struct.pack('<f', v))
    def hook(self, uc, address, size, data):
        if any(lo <= address < hi for key in ['sampler', 'clock', 'impulse', 'setter']
               for lo, hi in [self.p.get(key, (0, 0))]): return
        if address not in self.p['math']:
            raise RuntimeError(f'Unexpected instruction outside bounded native camera paths: {address:x}')
        self.u.reg_write(UC_X86_REG_XMM0, bits(self.p['math'][address](value(self.u.reg_read(UC_X86_REG_XMM0)))))
        sp = self.u.reg_read(UC_X86_REG_RSP)
        dest = struct.unpack('<Q', self.u.mem_read(sp, 8))[0]
        self.u.reg_write(UC_X86_REG_RSP, sp + 8); self.u.reg_write(UC_X86_REG_RIP, dest)

    def sample(self, angle, tick, fraction, now):
        u = self.u
        u.mem_write(self.camera + 0x48, struct.pack('<3fif', *angle, tick, fraction))
        self.f(self.global_state + 0x30, now)
        self.q(self.stack, self.stop); u.reg_write(UC_X86_REG_RSP, self.stack)
        u.reg_write(UC_X86_REG_RDI, self.camera)
        u.emu_start(self.p['sampler'][0], self.stop, count=300)
        assert u.reg_read(UC_X86_REG_RIP) == self.stop
        packed = u.reg_read(UC_X86_REG_XMM0)
        return [value(packed), value(packed >> 32), value(u.reg_read(UC_X86_REG_XMM1))]

    def add_impulse(self, previous, angle, magnitude):
        u = self.u; rad = F(F(angle) * F(math.pi / 180))
        u.reg_write(UC_X86_REG_RBP, self.frame); u.reg_write(UC_X86_REG_RSP, self.frame - 0xc0)
        u.reg_write(UC_X86_REG_XMM0, bits(previous[0]) | bits(previous[1]) << 32)
        u.reg_write(UC_X86_REG_XMM1, bits(previous[2]))
        if self.side == 'client':
            u.reg_write(UC_X86_REG_R15D, bits(magnitude)); u.reg_write(UC_X86_REG_R14D, bits(rad))
        else:
            u.reg_write(UC_X86_REG_XMM3, bits(magnitude)); self.f(self.frame - 0xa4, rad)
        begin, end = self.p['impulse']
        u.emu_start(begin, end, count=150)
        assert u.reg_read(UC_X86_REG_RIP) == end
        return list(struct.unpack('<3f', u.mem_read(self.frame + self.p['output'], 12)))

    def set_anchor(self, angle, tick, fraction):
        assert self.side == 'client'
        u = self.u
        u.mem_write(self.input, struct.pack('<3f', *angle))
        u.mem_write(self.argument, struct.pack('<if', tick, fraction))
        self.q(self.stack, self.stop); u.reg_write(UC_X86_REG_RSP, self.stack)
        u.reg_write(UC_X86_REG_RDI, self.camera); u.reg_write(UC_X86_REG_RSI, self.input)
        u.reg_write(UC_X86_REG_RDX, self.argument)
        u.emu_start(self.p['setter'][0], self.stop, count=300)
        assert u.reg_read(UC_X86_REG_RIP) == self.stop
        angle = list(struct.unpack('<3f', u.mem_read(self.camera + 0x48, 12)))
        tick, fraction = struct.unpack('<if', u.mem_read(self.camera + 0x54, 8))
        return dict(angle=angle, tick=tick, fraction=fraction)

def main():
    results = []
    for side in profiles:
        native = NativeCamera(side); samples, impulses, setters = [], [], []
        for tick in [0, 15277, 75000, 640000]:
            for fraction in [0, .17474145, .5, .9937501]:
                anchor = (tick + fraction) / 64
                for elapsed in [-.02, 0, .001, 1/256, 1/128, .1, .4, 2]:
                    for angle in [[-1.1, .57, .03], [0, 0, 0]]:
                        now = F(anchor + elapsed)
                        result = native.sample(angle, tick, fraction, now)
                        expected_dt = max(0, F(now - F(F(tick) + F(fraction)) / 64))
                        factor = F(math.exp(-F(expected_dt * 18)))
                        expected = [F(F(x) * factor) for x in angle]
                        assert result == expected, (side, tick, fraction, elapsed, result, expected)
                        samples.append(dict(angle=angle, tick=tick, fraction=fraction, now=now, result=result))
        for angle in [-179, -53.5, 0, 27.333, 90, 179]:
            for magnitude in [0, 22.5, 75]:
                for previous in [[0, 0, 0], [-1.2, .4, .03]]:
                    result = native.add_impulse(previous, angle, magnitude)
                    impulses.append(dict(angle=angle, magnitude=magnitude, previous=previous, result=result))
        if side == 'client':
            for tick, fraction in [(0, 0), (1234, .1), (15277, .17474145), (15277, .9)]:
                result = native.set_anchor([-1.2, .4, .03], tick, fraction)
                assert result['tick'] == tick and result['fraction'] == F(fraction)
                setters.append(dict(tick=tick, fraction=fraction, result=result))
        results.append(dict(side=side, sha256=native.sha, samples=samples, impulses=impulses, setters=setters))
    assert results[0]['samples'] == results[1]['samples']
    assert results[0]['impulses'] == results[1]['impulses']
    out = AUDIT / 'reports/reaudit-camera-native.json'
    out.write_text(json.dumps(dict(method=__doc__, decay=18, decaySource='supplied convar value; live default not queried here',
        profiles=profiles, results=results), indent=2, default=lambda _: 'host math function') + '\n')
    print('Verified', sum(len(r['samples']) for r in results), 'native sampler cases,',
          sum(len(r['impulses']) for r in results), 'impulses and', sum(len(r['setters']) for r in results), 'explicit anchors')
    print(out)

if __name__ == '__main__': main()
