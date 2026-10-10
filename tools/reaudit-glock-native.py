"""Current-byte static Glock timing proof. No native execution or game launch.

Explicit code/metadata reads, whole-server identity check. Raw addresses remain
in this tool and --out; --portable-report contains hashes and named conclusions.
Run with MemoryMax=512M, MemorySwapMax=0, CPUQuota=100%.
"""
import argparse
import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'


def load(name):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


# Re-read the relevant current dispatch bytes; do not infer input behavior from
# the trainer. Shared verifier imports are inert until their main() is called.
shared_reader = load('reaudit-common-reload-native')
shared_proof = load('reaudit-common-reload-proof')
shared = ['common-input-dispatch', 'primary-dispatch', 'ordinary-gun-postframe',
          'primary-ready', 'secondary-ready', 'input-active',
          'input-transition-wrapper', 'input-transition-predicate', 'burst-continuation']
RANGES = {name: shared_reader.RANGES[name] for name in shared}
CHECKS = {name: shared_proof.CHECKS[name] for name in shared}
RANGES.update({
    'gun-primary': (0x14b2ef0, 0x400), 'gun-fire-entry': (0x14b22d0, 0x210),
    'secondary-dispatch': (0x14bfa70, 0x900), 'secondary-wrapper': (0x14a9b70, 0x500),
    'secondary-thunk': (0x14957f0, 0x19f),
    'secondary-setter': (0x1653ae0, 0x3a0),
    'attack-clock-compute': (0x14ac0a0, 0x483),
    'attack-context': (0x1496e60, 0x1000),
    'cs-vdata-constructor': (0x1499cb0, 0x420),
    'cs-vdata-operation': (0x149a0d0, 0x600),
    'base-vdata-operation': (0x17f5f90, 0x600),
    'base-vdata-placement-tail': (0x17f6580, 0x170),
})
CHECKS.update({
    'gun-primary': ['14b2fe8: mov edx, dword ptr [rbx + 0x154c]',
        '14b30a9: movss xmm0, dword ptr [rax + 0x744]',
        '14b30b1: cmp edx, 1', '14b30b4: jne 0x14b3018',
        '14b30ba: addss xmm0, xmm0', '14b30be: movss xmm1, dword ptr [rax + 0x740]',
        '14b30ce: subss xmm1, xmm0', '14b30d2: maxss xmm2, xmm1',
        '14b3023: call 0x14b22d0'],
    'gun-fire-entry': ['14b2426: call 0x14ac0a0'],
    'secondary-dispatch': ['14bfcc1: xor esi, esi', '14bfcc6: call 0x1653ae0',
        '14bfccb: jmp 0x14bfb8a'],
    'secondary-wrapper': ['14a9cf8: jmp 0x14957f0'],
    'secondary-thunk': ['1495930: call qword ptr [rdx + 0xd38]', '1495949: ret '],
    'secondary-setter': ['1653b20: cmp r12d, 1', '1653b24: je 0x1653d10',
        '1653d10: movss xmm5, dword ptr [rbx + 0x119c]',
        '1653d18: mov r13d, dword ptr [rbx + 0x1198]',
        '1653d24: jmp 0x1653b34',
        '1653cbc: mov dword ptr [rbx + 0x1198], r13d',
        '1653cc3: cmp byte ptr [rax + 0x4c6], 0', '1653cca: je 0x1653bdb'],
    'attack-clock-compute': ['14ac0df: call 0x1496e60',
        '14ac11b: cmp byte ptr [r12 + 0x38], 0', '14ac121: jne 0x14ac231',
        '14ac132: mov esi, 1', '14ac137: call 0x1653800',
        '14ac147: mov esi, 1', '14ac14c: call 0x1653ae0',
        '14ac2f9: call 0x16416e0', '14ac307: cmp eax, r15d',
        '14ac310: jge 0x14ac127', '14ac3a1: mov dword ptr [rbx + 0x1198], r15d',
        '14ac435: movss dword ptr [rbx + 0x119c], xmm1',
        '14ac470: shr rax, 0x20', '14ac478: comiss xmm0, xmm1',
        '14ac481: je 0x14ac127', '14ac487: ja 0x14ac127', '14ac48d: jmp 0x14ac316'],
    'attack-context': ['1496e9d: mov byte ptr [r15 + 0x38], 0',
        '1496f3b: call 0x16416b0', '1497116: call 0x17fd290',
        '149712e: mov esi, 1', '149713a: mov rbx, rax',
        '1497159: call 0x22b3c90', '1497165: cmp eax, ebx',
        '149717b: mov dword ptr [r15], ebx', '1497186: mov byte ptr [r15 + 0x38], 1',
        '149718b: movss dword ptr [r15 + 4], xmm3',
        '14977ff: jbe 0x1497173', '149780c: mov qword ptr [r15], r12'],
    'cs-vdata-constructor': ['1499e9e: mov dword ptr [rbx + 0x4c4], 1',
        '1499e6c: movabs rax, 0x200000000', '1499fc6: mov qword ptr [rbx + 0x7c8], rax'],
    'cs-vdata-operation': ['149a413: call 0x1499cb0', '149a443: call 0x1499cb0'],
    'base-vdata-operation': ['17f6440: mov dword ptr [rbx + 0x4c4], 1'],
    'base-vdata-placement-tail': ['17f6653: mov dword ptr [rbx + 0x4c4], 1'],
})


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--native-root', type=Path, required=True)
    parser.add_argument('--server', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--portable-report', type=Path)
    args = parser.parse_args()
    sys.path.insert(0, str(args.native_root / 'python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from elftools.elf.elffile import ELFFile
    assert sha(args.server) == EXPECTED, 'Current server differs from the reviewed artifact'
    args.out.mkdir(parents=True, exist_ok=True)
    cs = Cs(CS_ARCH_X86, CS_MODE_64); cs.detail = True
    total = 0
    with args.server.open('rb') as stream:
        elf = ELFFile(stream)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(at, size):
            nonlocal total
            assert 0 < size <= 0x1000
            va, offset, length = next(s for s in segments if s[0] <= at and at + size <= s[0] + s[2])
            total += size; assert total < 65536
            stream.seek(offset + at - va)
            value = stream.read(size); assert len(value) == size
            return value

        def q(at): return struct.unpack('<Q', read(at, 8))[0]
        def string(at): return read(at, 100).split(b'\0')[0].decode()
        assert string(q(q(0x2600918 - 8) + 8)) == '12CWeaponGlock'
        slots = {0xd30: 0x14b2ef0, 0xd38: 0x14bfa70, 0xd40: 0x14b4510,
                 0xd58: 0x1483c10, 0xd60: 0x14445d0, 0xd68: 0x1483c20}
        for slot, target in slots.items(): assert q(0x2600918 + slot) == target
        classes = []
        for name, metadata, operation in [('CBasePlayerWeaponVData', 0x2788900, 0x17f5f90),
                                          ('CCSWeaponBaseVData', 0x277a8e0, 0x149a0d0)]:
            assert string(q(metadata + 0x28)) == name
            assert q(metadata + 0x88) == operation
            classes.append({'class': name, 'operationBindingVerified': True,
                            'metadataSha256': hashlib.sha256(read(metadata, 0x90)).hexdigest()})
        fields = []
        for name, address, offset in [('m_bLinkedCooldowns', 0x2788b60, 0x4c6), ('m_nBurstShotCount', 0x277af20, 0x7cc)]:
            value = read(address, 32)
            assert string(struct.unpack_from('<Q', value)[0]) == name
            assert struct.unpack_from('<I', value, 16)[0] == offset
            fields.append({'field': name, 'descriptorSha256': hashlib.sha256(value).hexdigest()})
        records = []
        for name, (address, size) in RANGES.items():
            code = read(address, size); lines = []; constants = []
            for ins in cs.disasm(code, address):
                line = f'{ins.address:x}: {ins.mnemonic} {ins.op_str}'
                for operand in ins.operands:
                    if operand.type == 3 and cs.reg_name(operand.mem.base) == 'rip' and 'ss' in ins.mnemonic:
                        value = struct.unpack('<f', read(ins.address + ins.size + operand.mem.disp, 4))[0]
                        constants.append({'instruction': hex(ins.address), 'float32': value})
                lines.append(line)
            listing = '\n'.join(lines) + '\n'
            (args.out / (name + '.txt')).write_text(listing)
            for expected in CHECKS.get(name, []): assert expected in lines, (name, expected)
            if name == 'secondary-dispatch':
                assert any(x['instruction'] == '0x14bfcb9' and abs(x['float32'] - .3) < 1e-7 for x in constants)
            if name == 'gun-primary':
                assert any(x['instruction'] == '0x14b30c6' and x['float32'] == 1 / 64 for x in constants)
            records.append({'id': name, 'bytes': size, 'assertions': len(CHECKS.get(name, [])),
                'codeSha256': hashlib.sha256(code).hexdigest(), 'listingSha256': hashlib.sha256(listing.encode()).hexdigest()})
    report = {'serverSha256': EXPECTED, 'wholeArtifactHashVerified': True, 'readerSha256': sha(Path(__file__)),
        'sharedToolHashes': {Path(m.__file__).name: sha(Path(m.__file__)) for m in [shared_reader, shared_proof]},
        'method': 'Current-byte bounded disassembly assertions and exact concrete Glock/schema bindings; no native execution.',
        'class': 'CWeaponGlock', 'virtualBindings': len(slots), 'schema': fields, 'vdataClasses': classes,
        'bytesRead': total, 'codeBytes': sum(n for _, n in RANGES.values()),
        'instructionAssertions': sum(r['assertions'] for r in records), 'evidence': records,
        'conclusions': {
            'constructors': 'Base and CS vdata constructors initialize LinkedCooldowns=false. CS constructor initializes pending continuation count=2. Compiled weapon-data overrides require a separate data proof.',
            'toggle': 'Accepted Glock mode switch uses secondary setter mode0 and a 0.3-second constant. Unlinked setter returns without mirroring to primary. Accepted secondary thunk adds no primary lock.',
            'shot': 'Gun firing calls the clock helper; it calls both attack setters in mode1. Secondary mode1 starts from the existing secondary tick/fraction. The stale-clock branch raises a past clock to the current attack context; a future/equal clock is retained.',
            'priority': 'Post-frame handles due pending burst rounds before shared inputs. Eligible held primary wins even if semiautomatic dispatch rejects another shot. Otherwise held secondary is retried against its own clock on every processed update.',
            'release': 'Once primary is no longer active, the shared dispatcher reaches an eligible held secondary on that processed command. No additional one-step delay is authored here.',
        },
        'limits': ['No live capture, native execution or native input-mask producer/reset proof.',
            'Upstream player/equip gates, empty magazine and excluded weapon state machines are outside the correction.',
            'Native clocks use float32 normalized tick/fraction arithmetic; trainer seconds preserve their existing representation.']}
    (args.out / 'current-proof.json').write_text(json.dumps(report, indent=2) + '\n')
    if args.portable_report:
        args.portable_report.parent.mkdir(parents=True, exist_ok=True)
        args.portable_report.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'bytesRead': total, 'instructionAssertions': report['instructionAssertions'], 'ranges': len(records)}))


if __name__ == '__main__': main()
