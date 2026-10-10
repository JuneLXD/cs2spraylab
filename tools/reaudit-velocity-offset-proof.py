"""Static current-client velocity offset producer proof; no native execution.

Inspect only explicit constructor, registration, adapter and formula ranges.
Raw locations are retained only in this probe and local evidence. This proves
the producer path but does not associate a sampled offset with a setter call.
"""
import argparse
import hashlib
import json
import mmap
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent/'native-audit'
sys.path.insert(0, str(ROOT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--out', type=Path, default=ROOT / 'reports/reaudit-velocity-offset-proof')
args = p.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
SHA = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
CLIENT = ROOT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
cs = Cs(CS_ARCH_X86, CS_MODE_64)
cs.detail = True

RANGES = [
    ('constructor-group-state', 0x189befd, 0x145),
    ('constructor-velocity-pointer', 0x189c32b, 0x50),
    ('constructor-history', 0x189c700, 0x130),
    ('constructor-adapter', 0x189ca25, 0x31),
    ('adapter-register', 0x187d280, 0x16e),
    ('group-refresh', 0x18589b0, 0x16a),
    ('group-refresh-specialized', 0x1858b60, 0x134),
    ('velocity-adapter-group', 0x183dce0, 0x15),
    ('velocity-adapter-offset', 0x1843ae0, 0xa6),
    ('plain-history-offset', 0x1841e50, 0x60),
    ('offset-formula', 0x18588f0, 0xba),
    ('network-offset-formula', 0x161f600, 0x39),
    ('local-interval-formula', 0x1621150, 0xa8),
    ('pawn-count-provider', 0x183d500, 0x6),
    ('consumer-refresh-first', 0x1881576, 0x45),
    ('consumer-refresh-second', 0x18816d6, 0x45),
    ('interpolate-dirty-refresh', 0x1882fab, 0x57),
]
CHECKS = {
    0x189befd: 'mov byte ptr [rbx + 0x3b0], 1',
    0x189bf2d: 'movabs rax, 0x100000000',
    0x189bf45: 'mov qword ptr [rbx + 0x3e8], rax',
    0x189bf4c: 'mov qword ptr [rbx + 0x3f0], rax',
    0x189bfec: 'mov byte ptr [rbx + 0x3f8], 1',
    0x189c34c: 'lea rdi, [rax + 0x5a0]',
    0x189c35b: 'mov qword ptr [rbp - 0xa0], rdi',
    0x189c78d: 'mov dword ptr [rax + 0x18], 0',
    0x189c794: 'mov qword ptr [r12 + 0x648], rax',
    0x189c815: 'mov dword ptr [r12 + 0x638], 0xfcc8c140',
    0x189ca40: 'mov qword ptr [rsi], rax',
    0x189ca43: 'mov rax, qword ptr [rbp - 0xa0]',
    0x189ca4d: 'mov qword ptr [rsi + 8], rax',
    0x189ca51: 'call 0x187d280',
    0x187d29d: 'call qword ptr [rax + 0x48]',
    0x187d2d9: 'movsxd r15, dword ptr [r13 + 0x388]',
    0x187d30d: 'mov qword ptr [rax + r15*8], r12',
    0x187d33e: 'mov r14, qword ptr [rax + 0x40]',
    0x187d35c: 'mov esi, r15d',
    0x187d35f: 'mov edx, dword ptr [rbp - 0x40]',
    0x187d365: 'movss xmm0, dword ptr [r13 + 0x398]',
    0x187d36e: 'call r14',
    0x183dce4: 'movzx eax, byte ptr [rax + 0x9a]',
    0x183dcee: 'sar al, 5',
    0x18589d7: 'cmp byte ptr [r8 + 0x3b0], 0',
    0x18589ed: 'mov byte ptr [r8 + 0x3b0], 0',
    0x1858a1c: 'mov rax, qword ptr [rax + 0x3e8]',
    0x1858a2f: 'mov dword ptr [r15 + 0x3a4], ecx',
    0x1858a3c: 'call 0x18588f0',
    0x1858a41: 'movss dword ptr [r15 + 0x3a0], xmm0',
    0x1858a8b: 'call qword ptr [rcx + 0x18]',
    0x1858ab6: 'movss xmm0, dword ptr [r15 + 0x3a0]',
    0x1858ac7: 'mov edx, dword ptr [r15 + 0x3a4]',
    0x1858ad1: 'call qword ptr [rcx + 0x40]',
    0x1858ade: 'add r15, 8',
    0x1858ae5: 'mov ebx, 1',
    0x1843ae0: 'mov rdi, qword ptr [rdi + 8]',
    0x1843af7: 'mov dword ptr [rdi + rax*4 + 0x80], 0xbf800000',
    0x1843b04: 'movzx eax, byte ptr [rdi + 0x99]',
    0x1843b1a: 'mov byte ptr [rdi + 0x99], al',
    0x1843b28: 'test byte ptr [rdi + 0x98], 0x20',
    0x1843b38: 'movss dword ptr [rax + 0x38], xmm0',
    0x1843b51: 'mov dword ptr [rax + 0x14], edx',
    0x1843b60: 'mov rax, qword ptr [rdi + 0xa8]',
    0x1843b67: 'movss dword ptr [rax + 0x18], xmm0',
    0x1843b73: 'mov dword ptr [rax + 0x14], edx',
    0x18588f6: 'mov r12d, ecx',
    0x1858908: 'cmp dword ptr [rax + 0x10], 1',
    0x185891b: 'call qword ptr [rax + 0x150]',
    0x185892c: 'cmp byte ptr [rax + 0x58], 0',
    0x1858932: 'lea eax, [r12 - 1]',
    0x185893f: 'cmovs eax, edx',
    0x1858959: 'jmp 0x161f600',
    0x185896a: 'cmp dword ptr [rbx + 0x450], 1',
    0x185899f: 'cvtsi2ss xmm0, r12d',
    0x18589a4: 'mulss xmm0, xmm1',
    0x161f618: 'comiss xmm0, xmm1',
    0x161f629: 'minss xmm2, xmm1',
    0x16211a6: 'test byte ptr [rbx + 0x565], 1',
    0x16211f2: 'mulss xmm1, xmm0',
    0x183d500: 'mov eax, 1',
    0x188157e: 'call 0x18589b0',
    0x188158b: 'call 0x18589b0',
    0x1881598: 'call 0x18589b0',
    0x18815b5: 'call qword ptr [rax + 0x3c0]',
    0x18816eb: 'call 0x18589b0',
    0x1881715: 'call qword ptr [rax + 0x3c0]',
    0x1882fe7: 'mov byte ptr [rax + 0x3f8], 1',
}

with CLIENT.open('rb') as handle:
    digest = hashlib.sha256()
    for block in iter(lambda: handle.read(1024*1024), b''):
        digest.update(block)
    assert digest.hexdigest() == SHA
    handle.seek(0)
    elf = ELFFile(handle)
    segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    mm = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)

    def read(address, size):
        assert 0 < size <= 65536
        pos = next(o+address-v for v,o,n in segments if v <= address and address+size <= v+n)
        return mm[pos:pos+size]

    def q(address):
        return struct.unpack('<Q', read(address, 8))[0]

    def rip(address):
        ins = next(cs.disasm(read(address, 15), address))
        op = next(o for o in ins.operands if o.type == 3 and cs.reg_name(o.mem.base) == 'rip')
        return ins.address + ins.size + op.mem.disp

    for at, expected in CHECKS.items():
        ins = next(cs.disasm(read(at, 15), at))
        actual = ins.mnemonic+' '+ins.op_str
        assert actual == expected, (hex(at), expected, actual)
    for table, name, slots in [
        (0x44e3da0, b'11CWrappedVarI30CWrappedInterpolatedNumericVarI22CNetworkVelocityVectorEE', [(0x40,0x1843ae0),(0x48,0x183dce0)]),
        (0x4500730, b'14C_CSPlayerPawn', [(0x3e8,0x183d500)]),
        (0x44e06d0, b'16CInterpolatedVarI22CNetworkVelocityVectorE', [(0x18,0x1841e50)]),
    ]:
        assert read(q(q(table-8)+8), 128).split(b'\0')[0] == name
        for slot, target in slots:
            assert q(table+slot) == target
    assert rip(0x189ca39) == 0x44e3da0
    assert rip(0x1858a0d) == 0x183d500
    controls = {name: rip(address) for name,address in [
        ('value',0x161f600),('minimum',0x161f60c),('maximum',0x161f61d),
        ('singleClientFallback',0x1858925),('globalState',0x18588fe),('engineInterface',0x185890e)]}
    assert controls == dict(value=0x48fc4f8, minimum=0x48fc4e8, maximum=0x48fc4d8,
                           singleClientFallback=0x4925388,globalState=0x467be58,engineInterface=0x492d7d8)
    for at, expected in [(0x1858946,1/64),(0x1858981,1/64),(0x161f630,1/64),
                         (0x1621184,1/64),(0x16211dd,100.),(0x16211ea,1.)]:
        assert struct.unpack('<f',read(rip(at),4))[0] == expected
    # Same storage and flag addresses, reached through independently bound
    # constructor, adapter, and history layouts.
    assert 0x5a0 + 0xa8 == 0x648
    assert 0x5a0 + 0x98 == 0x638
    assert 0x5a0 + 0x80 == 0x620
    assert ((0xfcc8c140 >> 16) >> 3) & 7 == 1
    retained = []
    for name,start,size in RANGES:
        raw=read(start,size);ins=list(cs.disasm(raw,start))
        assert ins and sum(i.size for i in ins) >= size-14
        (args.out/(name+'.txt')).write_text('\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in ins)+'\n')
        retained.append(dict(name=name,start=hex(start),bytes=size,sha256=hashlib.sha256(raw).hexdigest()))

report = {
    'clientSha256': SHA,
    'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'method': 'Current-byte static instruction, RTTI, vtable, constructor and dataflow assertions; no native execution.',
    'status': 'offset producer and invalidation resolved; captured invocation/branch and full latch scheduling remain partial',
    'instructionAssertions': len(CHECKS),
    'classAssertions': 3, 'virtualTargetAssertions': 4,
    'ripBindings': 8, 'literalAssertions': 6, 'layoutIdentityAssertions': 4,
    'ranges': retained,
    'resolved': [
        'The entity constructor creates a typed velocity adapter with its embedded network velocity as owner, and registers it in the interpolation group returned by the adapter. That group is the same signed history time class 1 established by the prior writer proof.',
        'Registration inserts that adapter into the entity wrapped-variable collection, refreshes interpolation groups and sends each ring its cached float offset plus companion integer count.',
        'Dirty-group refresh clears its dirty flag, obtains count from the entity virtual provider for each ring, computes and caches its offset, then broadcasts both arguments. Actual C_CSPlayerPawn binds the count provider to constant one.',
        'The plain-history branch calls the previously bound offset-setter slot. Actual velocity follows the typed wrapper-adapter branch, which inlines the same ring stores rather than calling that plain setter.',
        'The velocity adapter stores the selected ring offset and companion count, sets its cache timestamp to -1, and ORs the corresponding cache dirty bit. Ring one storage is updated only when the dual-ring history flag is set; its cache invalidation still occurs for a valid ring-one selector.',
        'Both selectors are visited in order zero then one. Native ProcessInterpolatedList refreshes the groups before calling the entity interpolation consumer. Existing dirty-state and outer frame scheduling remain essential.',
        'Construction starts with dirty interpolation groups, cached offset zero/count one, and a zero history-ring offset. Registration/refresh is a concrete path that replaces that zero with the computed amount.',
    ],
    'branchMatrix': [
        {'ring':0,'condition':'ordinary path, or entity render-time type is not one, or local pawn lookup is absent',
         'offset':'float32(count * 1/64)','pawnCount':1,'ordinarySeconds':1/64},
        {'ring':0,'condition':'entity render-time type is one and local pawn lookup succeeds',
         'offset':'float32(count * local tick-interval helper)',
         'helper':'normally 1/64; if the separately gated mode override applies, float32((1/64) * float32(1 + float32(percent/100)))',
         'unknown':'effective mode interface returns and local pawn flag at the setter phase'},
        {'ring':1,'condition':'global client-count field greater than one, or engine interface boolean true',
         'offset':'float32(clamp(value, minimum, maximum) * 1/64)',
         'unknown':'three runtime control values and engine boolean; count still stored separately and remains one for this pawn'},
        {'ring':1,'condition':'client-count field at most one, engine boolean false, fallback switch true',
         'offset':'float32(count * 1/64)','pawnCount':1,'ordinarySeconds':1/64},
        {'ring':1,'condition':'client-count field at most one, engine boolean false, fallback switch false',
         'offset':'float32(max(count - 1, 0) * 1/64)','pawnCount':1,'ordinarySeconds':0},
    ],
    'captureHelper':'tools/reaudit-velocity-offset-capture-fields.py',
    'stillNeeded': [
        'Associate a refresh/setter invocation with its input branch values and subsequent latch/cache/HUD consumer; later stable polling cannot prove invocation ownership.',
        'Bind effective local interval/engine interface returns when their branches matter. Runtime control names are not newly claimed from their numeric pointer bindings.',
        'Complete the external latch caller ordering and consecutive free-running input replay before any production bob/sway correction.',
    ],
    'scanBoundary': 'One 448 KiB retained entity code region yielded 32 indirect-slot candidates. Only dataflow-typed calls and the constructor-bound velocity adapter support conclusions. No whole-ELF search or claim of exhaustive callers.',
    'rawBindings': {'velocityAdapterTable':hex(0x44e3da0),'velocityOffsetAdapter':hex(0x1843ae0),
                    'groupRefresh':hex(0x18589b0),'groupPairs':hex(0x3e8),'groupDirty':hex(0x3f8),
                    'entityRenderTimeType':hex(0x450),'controls':{k:hex(v)for k,v in controls.items()}},
}
(args.out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'clientSha256':SHA,'instructionAssertions':len(CHECKS),'ranges':len(RANGES),'status':report['status']}))

portable = {k:v for k,v in report.items() if k not in ['rawBindings','ranges']}
portable['ranges'] = [{k:v for k,v in r.items() if k != 'start'} for r in report['ranges']]
(REPO/'docs/evidence/reaudit-velocity-offset.json').write_text(json.dumps(portable, indent=2)+'\n')
