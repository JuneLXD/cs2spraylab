"""Hash-bound, static proof of native velocity-history callback ownership.

Only explicit code/data ranges are inspected. No game, bridge, native emulator,
Node process or executable analysis service is started. The optional reference
scan is restricted to the same retained 448 KiB entity region; its negative
result does not exclude indirect references or callers outside that region.
Raw native locations remain in this probe and the local report.
"""
import argparse
import hashlib
import json
import mmap
import struct
import sys
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--native-root', type=Path, default=DEFAULT_ROOT)
p.add_argument('--client', type=Path)
p.add_argument('--out', type=Path)
p.add_argument('--portable-report', type=Path)
p.add_argument('--repeat-bounded-xref-scan', action='store_true')
args = p.parse_args()
root = args.native_root.resolve()
sys.path.insert(0, str(root / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile

EXPECTED = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
target = args.client or root.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
out = args.out or root / 'reports/reaudit-velocity-caller-proof'
out.mkdir(parents=True, exist_ok=True)
cs = Cs(CS_ARCH_X86, CS_MODE_64)
cs.detail = True

# These ranges are all reached from the actual velocity constructor or its
# retained latch/callback references. Never infer meaning from old filenames.
RANGES = [
    ('constructor-callback', 0x189c32b, 0x50),
    ('constructor-wrapper', 0x189c50f, 0x320),
    ('registration-copy', 0x189d880, 0x390),
    ('tick-callback', 0x1841560, 0xe3),
    ('wrapper-writer', 0x18aa780, 0x170),
    ('registered-writer-job', 0x18ab1c0, 0x1c4),
    ('registered-writer-sequential', 0x18ab688, 0x80),
    ('latch-dispatch', 0x18ac020, 0x110),
    ('latch-list-prefix', 0x18ac3a0, 0x280),
    ('latch-list-dispatch', 0x18ac845, 0x57),
    ('ring-offset-setter', 0x1841e50, 0x60),
    ('ring-offset-reader', 0xdb8e20, 0x110),
]
ASSERTIONS = {
    0x189c33c: 'mov qword ptr [rbp - 0x50], 0',
    0x189c348: 'mov qword ptr [rbp - 0x58], rdi',
    0x189c73c: 'movdqu xmm0, xmmword ptr [rbp - 0x58]',
    0x189c78d: 'mov dword ptr [rax + 0x18], 0',
    0x189c794: 'mov qword ptr [r12 + 0x648], rax',
    0x189c7b9: 'movups xmmword ptr [r12 + 0x658], xmm0',
    0x189c815: 'mov dword ptr [r12 + 0x638], 0xfcc8c140',
    0x189c821: 'mov qword ptr [r12 + 0x650], r12',
    0x189d880: 'movdqu xmm0, xmmword ptr [r10 + 0x658]',
    0x189d8b7: 'mov rdi, qword ptr [r10 + 0x650]',
    0x189d8ea: 'mov qword ptr [rbp - 0x100], rdi',
    0x189daf5: 'mov qword ptr [rax], rdx',
    0x189db04: 'movups xmmword ptr [rax + 0x10], xmm0',
    0x189db08: 'mov qword ptr [rax + 8], rdx',
    0x189db13: 'mov qword ptr [rax + 0x20], rdx',
    0x18ab1e5: 'movzx edx, byte ptr [rax + 0x12]',
    0x18ab1ee: 'shl edx, 2',
    0x18ab1f1: 'sar dl, 5',
    0x18ab203: 'call rax',
    0x18ab210: 'mov ecx, eax',
    0x18ab242: 'call 0x18a9280',
    0x18ab6bd: 'call rcx',
    0x18ab6c2: 'mov ecx, eax',
    0x18ab6f3: 'call 0x18a9280',
    0x184156a: 'cmp byte ptr [rax + 0x34], 0',
    0x1841570: 'cmp byte ptr [rdi + 0x6e1], 0',
    0x184158b: 'mulss xmm0, dword ptr [rax + 0x30]',
    0x1841598: 'cvttss2si eax, xmm0',
    0x18415b6: 'movss xmm0, dword ptr [rdi + 0x524]',
    0x1841630: 'movss xmm0, dword ptr [rdi + 0x528]',
    0x1841622: 'mov eax, dword ptr [rax + 0x44]',
    0x1841611: 'add eax, 1',
    0x18ac043: 'mov dword ptr [rip + 0x2dced37], edi',
    0x18ac08b: 'call 0x18ab3a0',
    0x18ac857: 'call 0x18ac020',
    0x1841e6a: 'movss dword ptr [rax + 0x38], xmm0',
    0x1841e7d: 'mov dword ptr [rax + 0x14], edx',
    0x1841e8c: 'movss dword ptr [rax + 0x18], xmm0',
    0x1841e95: 'mov dword ptr [rax + 0x14], edx',
    0xdb8ebc: 'subss xmm0, dword ptr [rdx + 0x18]',
}

with target.open('rb') as handle:
    digest = hashlib.sha256()
    for block in iter(lambda: handle.read(1024 * 1024), b''):
        digest.update(block)
    assert digest.hexdigest() == EXPECTED, 'Re-establish bindings for another client build'
    handle.seek(0)
    elf = ELFFile(handle)
    segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    data = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)

    def read(address, size, limit=65536):
        assert 0 < size <= limit
        offset = next(o + address - v for v, o, n in segments
                      if v <= address and address + size <= v + n)
        return data[offset:offset + size]

    def rip_target(address):
        ins = next(cs.disasm(read(address, 15), address))
        mem = next(op.mem for op in ins.operands
                   if op.type == 3 and cs.reg_name(op.mem.base) == 'rip')
        return ins.address + ins.size + mem.disp

    ranges = []
    for name, start, size in RANGES:
        code = read(start, size)
        decoded = list(cs.disasm(code, start))
        assert decoded and sum(i.size for i in decoded) >= size - 14
        (out / (name + '.txt')).write_text('\n'.join(
            f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in decoded) + '\n')
        ranges.append(dict(name=name, start=hex(start), bytes=size,
                           sha256=hashlib.sha256(code).hexdigest()))
    for address, expected in ASSERTIONS.items():
        ins = next(cs.disasm(read(address, 15), address))
        actual = ins.mnemonic + ' ' + ins.op_str
        assert actual == expected, (hex(address), expected, actual)
    assert rip_target(0x189c32b) == 0x1841560
    assert rip_target(0x189c516) == 0x44e0818
    assert struct.unpack('<Q', read(0x44e0818, 8))[0] == 0x18aa780
    assert struct.unpack('<Q', read(0x44e06d0 + 0x18, 8))[0] == 0x1841e50
    assert struct.unpack('<f', read(rip_target(0x1841580), 4))[0] == 64.0
    assert struct.unpack('<f', read(rip_target(0x1841590), 4))[0] == 0.5
    assert read(rip_target(0x18ac572), 64).split(b'\0')[0] == b'LatchAndSaveLastSimulationValuesForInterpolationList'
    # Verify the retained negative result against exactly the originally scanned
    # current bytes. A normal rerun does not repeat the reference search.
    scan_start, scan_bytes = 0x1840000, 0x70000
    scan_sha = '31dfe7f7bc365a590b3423560c99e171b57cf10af9355fc7c844c405709e7f76'
    scan_code = read(scan_start, scan_bytes, 512 * 1024)
    assert hashlib.sha256(scan_code).hexdigest() == scan_sha
    targets = {0x1841e50: 'ring-offset-setter', 0x18ac3a0: 'latch-list',
               0x18ac130: 'latch-subset', 0x18ac020: 'latch-dispatch'}
    hits = [(0x18ac212, 0x18ac020), (0x18ac857, 0x18ac020)]
    if args.repeat_bounded_xref_scan:
        found = []
        for j, opcode in enumerate(scan_code):
            if opcode in (0xe8, 0xe9) and j + 5 <= scan_bytes:
                destination = scan_start + j + 5 + struct.unpack_from('<i', scan_code, j + 1)[0]
            elif opcode in (0x48, 0x4c) and j + 7 <= scan_bytes and scan_code[j + 1] == 0x8d and scan_code[j + 2] & 0xc7 == 5:
                destination = scan_start + j + 7 + struct.unpack_from('<i', scan_code, j + 3)[0]
            else:
                continue
            if destination in targets:
                found.append((scan_start + j, destination))
        assert found == hits, found

time_class = ((0xfcc8c140 >> 16) >> 3) & 7
time_class = time_class - 8 if time_class & 4 else time_class
assert time_class == 1
report = {
    'clientSha256': EXPECTED,
    'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'method': 'Bounded static reads of current-client constructor, registration, tick callback, latch dispatch, writer forwarding and ring-offset setter. No native execution.',
    'status': 'partial: timestamp callback ownership resolved; outer caller phase and runtime ring-offset producer remain unbound',
    'proof': {'instructionAssertions': len(ASSERTIONS), 'bindingAndConstantAssertions': 7,
              'velocityTimeClass': time_class, 'nativeRangeSha256': {r['name']: r['sha256'] for r in ranges}},
    'resolved': [
        'The velocity constructor stores the entity tick callback, zero member adjustment and entity owner; subsequent registration copies these with the wrapper and embedded history into a queued record.',
        'The record dispatcher extracts the signed three-bit history time class, invokes the registered callback, and forwards its returned integer tick unchanged into the velocity writer. Sequential and job paths agree.',
        'The velocity constructor selects time class 1. Ring selector zero always uses global currentTime. Either ring also uses global currentTime when both the prediction-state gate and entity prediction gate are set.',
        'For the remaining nonzero-ring class-1 path, the callback uses the entity class-1 time, replacing exactly zero with global currentTime. The result is trunc(float32(float32(time * 64) + 0.5)); the entity time field schema name has not been rebound here.',
        'Other time classes are distinct: class 0 uses a different entity time with the same zero fallback; class 2 returns an interface-provided integer tick plus one; remaining classes return global integer tick. The class-2 interface clock domain is not newly claimed.',
        'The named latch-list dispatcher reaches the registration queue processor. This establishes local dispatch ownership, not its external prediction/network/render call phase.',
        'The common writer forwards raw current value for ring 1 or a single-ring history. Ring 0 of a dual-ring history first obtains the current interpolation cache value and then writes it with the independently resolved tick.',
        'The constructor initializes the ring time offset to zero. The virtual setter accepts an explicit float offset and companion integer per selected ring; the bracket reader subtracts that ring offset. These functions do not establish who supplied the captured one-tick offset.',
    ],
    'boundedNegativeEvidence': {
        'region': 'one explicitly bounded C_BaseEntity code region', 'bytes': scan_bytes,
        'rangeSha256': scan_sha,
        'method': 'Relative call/jump and RIP-relative LEA references to the offset setter and three latch dispatch functions.',
        'directOffsetSetterReferences': 0, 'outerLatchListReferences': 0,
        'latchSubsetReferences': 0, 'knownInnerDispatchReferences': 2,
        'repeatedThisRun': args.repeat_bounded_xref_scan,
        'boundary': 'No conclusion about indirect/virtual calls, inline stores, or callers outside this region.',
    },
    'runtimeInputsStillNeeded': [
        'At each actual latch: ring selector, history time class, registered callback identity, prediction-state gate, entity prediction gate, global currentTime and global integer tick.',
        'For nonzero-ring class 1: the entity class-1 time and whether its zero fallback was selected; preserve binary32 arithmetic and the callback result.',
        'For each write: raw current velocity, selected interpolation context/cache value for the dual-ring special path, and ring metadata before and after replacement/pruning.',
        'For the ring offset: actual virtual setter caller, float argument, companion integer argument and selected ring; snapshots of the resulting offset alone do not identify its producer.',
        'External latch-list caller and ordering relative to movement/prediction, network packet application, interpolation restoration/evaluation and HUD sampling.',
    ],
    'nextSmallestStaticQuestion': 'Locate the indirect caller of the already bound ring-offset setter slot, and verify how it computes its float argument and selected ring. A typed history argument plus an indirect call to that slot is required; another generic virtual-slot match is insufficient.',
    'limits': [
        'No production correction or fixed-delay approximation follows from this partial proof.',
        'The supplied-history oracle and captured-cache replay remain separate evidence; neither records every native writer invocation.',
        'No game, emulator, Node command, browser, export or analysis service was run.',
    ],
}
local = dict(report, ranges=ranges,
             rawBindings={'tickCallback': hex(0x1841560), 'historyVtable': hex(0x44e06d0),
                          'offsetSetterSlot': hex(0x18), 'offsetSetter': hex(0x1841e50),
                          'entityClass0Time': hex(0x524), 'entityClass1Time': hex(0x528),
                          'predictionStateGate': hex(0x34), 'entityPredictionGate': hex(0x6e1)},
             rawNegativeScan={'start': hex(scan_start), 'hits': [[hex(a), hex(b)] for a, b in hits]})
(out / 'report.json').write_text(json.dumps(local, indent=2) + '\n')
if args.portable_report:
    args.portable_report.parent.mkdir(parents=True, exist_ok=True)
    args.portable_report.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'status': report['status'], 'clientSha256': EXPECTED,
                  'instructionAssertions': len(ASSERTIONS), 'ranges': len(ranges)}))
