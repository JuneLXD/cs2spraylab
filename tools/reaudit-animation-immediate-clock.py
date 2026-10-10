"""Current-byte first-person Arms immediate graph caller and phase-gate proof.

Static reads only. No native execution, live process, exporter or renderer.
Run in the parent's serialized 512 MiB / one-CPU slot.
Raw locations are intentionally confined to this local diagnostic source.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

AUDIT = Path(__file__).resolve().parents[2] / 'native-audit'
OUT = AUDIT / 'reports/animation-draw-shell'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--out', type=Path, default=OUT/'immediate-caller-proof.json')
args = parser.parse_args()
REPO = AUDIT.parent / 'cs2spraylab'
CLIENT = AUDIT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
SHA = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
sys.path.insert(0, str(AUDIT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

RANGES = [
    ('local-view-hud-call', 0x1f9b7d4, 451, '6b91734c6ff4dc4c8ee0de9866905f3be4b3c82fc647ed0cb95a59611ffd0838'),
    ('player-hud-handle-forwarder', 0x1a30930, 97, '01bfb4b80678a176675158364c1995a21260b6c9b5ea6cedeb1bab413158eeba'),
    ('arms-update-and-setup-view', 0x1fa7ac0, 2027, '1949ced81a08deb5ac0faf6e8fa1399a09ba77d4f4dea534356f50e4fecd464d'),
    ('arms-reflect-and-evaluate', 0x1f93830, 624, '10799160978e4341776de0603eebcf162fd9a3a586acfc61023eff14400e9927'),
    ('immediate-ag2-evaluator', 0xf32480, 1152, 'b0dfe7628fa98eca4c626e0964aa6f601e2a26aa7e7e52748da597699788abd3'),
]
ASSERTIONS = {
    0x1f9b984: ('xor', 'ecx, ecx'),
    0x1f9b986: ('mov', 'rdi, r14'),
    0x1f9b98d: ('call', '0x1a30930'),
    0x1a30930: ('mov', 'r9d, dword ptr [rdi + 0x2c38]'),
    0x1a30978: ('cmp', 'r9d, dword ptr [rax + 0x10]'),
    0x1a3097e: ('mov', 'rdi, qword ptr [rax]'),
    0x1a30986: ('movzx', 'ecx, cl'),
    0x1a3098c: ('jmp', '0x1fa7ac0'),
    0x1fa7ae1: ('mov', 'rbx, rdi'),
    0x1fa7afd: ('mov', 'dword ptr [rbp - 0xbc], ecx'),
    0x1fa8022: ('movzx', 'r15d, byte ptr [rbp - 0xbc]'),
    0x1fa80a7: ('mov', 'esi, r15d'),
    0x1fa80aa: ('mov', 'rdi, rbx'),
    0x1fa80de: ('call', '0x1f93830'),
    0x1fa818f: ('mov', 'esi, r15d'),
    0x1fa8192: ('mov', 'rdi, rbx'),
    0x1fa81c6: ('call', '0x1f93830'),
    0x1f93838: ('mov', 'r14d, esi'),
    0x1f93843: ('mov', 'rbx, rdi'),
    0x1f938e7: ('je', '0x1f939f0'),
    0x1f9391e: ('call', '0x15dab80'),
    0x1f93950: ('call', '0x1610360'),
    0x1f93962: ('mov', 'rax, qword ptr [rax + 0xd0]'),
    0x1f9396c: ('jne', '0x1f93a88'),
    0x1f93972: ('mov', 'eax, dword ptr [rdi + 0x50]'),
    0x1f93975: ('test', 'eax, eax'),
    0x1f93977: ('jg', '0x1f93981'),
    0x1f93979: ('movzx', 'eax, byte ptr [rdi + 0x18]'),
    0x1f9397d: ('cmp', 'al, 2'),
    0x1f9397f: ('je', '0x1f939f8'),
    0x1f939a3: ('movss', 'xmm0, dword ptr [rax + 0x30]'),
    0x1f939a8: ('subss', 'xmm0, dword ptr [rbx + 0x13d8]'),
    0x1f939be: ('setae', 'r14b'),
    0x1f939e0: ('call', '0x15dab80'),
    0x1f939e5: ('mov', 'r13d, r14d'),
    0x1f939e8: ('jmp', '0x1f9394d'),
    0x1f939f0: ('mov', 'r13d, edx'),
    0x1f939f3: ('jmp', '0x1f93996'),
    0x1f939f8: ('cmp', 'dword ptr [rip + 0x2724781], -1'),
    0x1f939ff: ('jne', '0x1f93981'),
    0x1f93a0b: ('movss', 'xmm1, dword ptr [rax + 0x30]'),
    0x1f93a10: ('ucomiss', 'xmm1, dword ptr [rbx + 0x13d8]'),
    0x1f93a17: ('jp', '0x1f93a1f'),
    0x1f93a19: ('pxor', 'xmm0, xmm0'),
    0x1f93a1d: ('je', '0x1f93a24'),
    0x1f93a1f: ('movss', 'xmm0, dword ptr [rax + 0x34]'),
    0x1f93a2e: ('movss', 'dword ptr [rbp - 0x5c], xmm1'),
    0x1f93a33: ('movss', 'dword ptr [rbp - 0x58], xmm0'),
    0x1f93a44: ('movzx', 'ecx, r13b'),
    0x1f93a48: ('mov', 'rsi, rbx'),
    0x1f93a52: ('movss', 'xmm0, dword ptr [rbp - 0x58]'),
    0x1f93a62: ('call', '0xf32480'),
    0x1f93a67: ('movss', 'xmm1, dword ptr [rbp - 0x5c]'),
    0x1f93a6c: ('movss', 'dword ptr [rbx + 0x13d8], xmm1'),
    0x1f93a88: ('call', 'rax'),
    0x1f93a8a: ('jmp', '0x1f9397d'),
    0xf32492: ('mov', 'r12, rsi'),
    0xf3249d: ('movss', 'dword ptr [rbp - 0x74], xmm0'),
    0xf324a7: ('mov', 'r15, qword ptr [rax + 0x460]'),
    0xf324b1: ('je', '0xf32670'),
    0xf324bb: ('test', 'r13b, r13b'),
    0xf324be: ('jne', '0xf32680'),
    0xf324c4: ('comiss', 'xmm0, dword ptr [rbp - 0x74]'),
    0xf324c8: ('jae', '0xf32670'),
    0xf324e1: ('call', 'qword ptr [rax + 0x8c0]'),
    0xf324f1: ('movss', 'xmm0, dword ptr [rbp - 0x74]'),
    0xf32501: ('call', '0x25f9b50'),
    0xf3250c: ('call', '0x25f4190'),
    0xf32520: ('mov', 'rdi, r12'),
    0xf3253b: ('call', 'qword ptr [rax + 0x8d0]'),
    0xf32680: ('comiss', 'xmm0, dword ptr [rbp - 0x74]'),
    0xf32684: ('jbe', '0xf324ce'),
}

with CLIENT.open('rb') as file:
    digest = hashlib.sha256()
    while block := file.read(1024 * 1024):
        digest.update(block)
    assert digest.hexdigest() == SHA
    file.seek(0)
    header = file.read(64)
    assert header[:6] == b'\x7fELF\x02\x01'
    phoff = struct.unpack_from('<Q', header, 32)[0]
    phsize, phnum = struct.unpack_from('<HH', header, 54)
    segments = []
    for index in range(phnum):
        file.seek(phoff + index * phsize)
        kind, _, offset, address, _, size, _, _ = struct.unpack('<IIQQQQQQ', file.read(56))
        if kind == 1:
            segments.append((address, offset, size))
    def read(address, size):
        assert 0 < size <= 4096
        base, offset, _ = next(s for s in segments if s[0] <= address and address + size <= s[0] + s[2])
        file.seek(offset + address - base)
        result = file.read(size)
        assert len(result) == size
        return result
    def q(address):
        return struct.unpack('<Q', read(address, 8))[0]
    def cstring(address):
        return read(address, 128).split(b'\0')[0].decode()
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    cs.detail = True
    instructions = {}
    for name, start, size, expected in RANGES:
        raw = read(start, size)
        assert hashlib.sha256(raw).hexdigest() == expected, name
        instructions.update({i.address: i for i in cs.disasm(raw, start)})
    for address, expected in ASSERTIONS.items():
        instruction = instructions[address]
        assert (instruction.mnemonic, instruction.op_str) == expected, (hex(address), instruction.op_str)
    def rip_target(address):
        instruction = instructions[address]
        matches = [o for o in instruction.operands if o.type == 3 and o.mem.base == 41]
        assert len(matches) == 1
        return address + instruction.size + matches[0].mem.disp
    assert cstring(rip_target(0x1fa7ae4)) == 'C_CS2HudModelArms::UpdateAndSetupView'
    assert rip_target(0x1f93955) == 0xf04d60
    assert rip_target(0x1f93996) == 0x467be58
    assert rip_target(0x1f93a01) == 0x467be58
    assert rip_target(0x1f939f8) == 0x46b8180
    refresh = struct.unpack('<f', read(rip_target(0x1f939b7), 4))[0]
    assert refresh == struct.unpack('<f', struct.pack('<f', .1))[0]
    for table, name in [(0x4548788, '17C_CS2HudModelArms'), (0x44c4090, '24CBaseAnimGraphController')]:
        assert q(table - 16) == 0
        assert cstring(q(q(table - 8) + 8)) == name
    assert q(0x4548788 + 0x8c0) == 0x1635c20
    assert q(0x4548788 + 0x8d0) == 0x1f96cc0
    assert q(0x44c4090 + 0xd0) == 0xf04d60

result = {
    'schema': 1, 'clientSha256': SHA, 'wholeArtifactHashVerified': True,
    'probeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'scope': 'Local-view first-person Arms immediate animation caller and phase gate; static current-byte proof',
    'ranges': [{'name': name, 'bytes': size, 'sha256': digest} for name, _, size, digest in RANGES],
    'assertions': {'instructions': len(ASSERTIONS), 'classes': 2, 'virtualTargets': 3,
                   'profileNames': 1, 'globalReferences': 3, 'floatConstants': 1},
    'receiver': 'C_CS2HudModelArms',
    'incomingPath': ['retained ordinary local HUD path', 'player HUD handle forwarder',
                     'C_CS2HudModelArms::UpdateAndSetupView', 'Arms action reflection/update helper',
                     'immediate AG2 evaluator', 'graph context / pose evaluation', 'Arms skeleton callback'],
    'localForceFlag': False,
    'phaseGates': {'graphMode': 2, 'interpolationSelector': -1, 'graphInstanceRequired': True,
                  'normalDeltaStrictlyPositive': True, 'forcedDeltaMayEqualZero': True},
    'clock': {'currentField': 'bodyClockGlobalCurrentTime', 'deltaField': 'bodyClockGlobalFrameDelta',
              'sameCurrentTimeDelta': 0, 'differentCurrentTimeDelta': 'unscaled global frame delta',
              'storesCurrentTimeAfterImmediateCall': True, 'actionAgeSeekUsed': False,
              'refreshThresholdSecondsFloat32': refresh},
    'conclusion': 'The ordinary local HUD path directly invokes the concrete Arms immediate evaluator. It updates only in graph mode 2 with interpolation selector -1, passes an unscaled frame delta (or zero for an equal-time repeat), and reaches the Arms skeleton callback. This displayed-Arms route is distinct from the earlier general tick-worker route.',
    'limits': [
        'Static caller/path proof, not observation or counting of actual graph invocations.',
        'Dynamic mode overrides, graph-instance availability and the complete frame scheduler remain runtime conditions.',
        'First ClipNode initialization versus first displayed sample is not bound by these outer callers.',
        'Long-gap reset/refresh behavior is identified by its flag and threshold, not fully reconstructed.',
        'No shell insertion/completion deadline or gameplay change is established.',
    ],
}
args.out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'instructions': len(ASSERTIONS), 'receiver': result['receiver'],
                  'mode': 2, 'interpolationSelector': -1, 'output': str(args.out)}))
