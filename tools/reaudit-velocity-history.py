"""Current-client velocity history layout and private-memory bracketing oracle.

This executes the game's bracket search and writer with supplied private-memory
histories. It does not run a live process or establish prediction ordering.
Raw locations are confined to this probe and its local evidence artifacts.
"""
import hashlib
import json
import mmap
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
sys.path.insert(0, str(ROOT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

EXPECTED = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
BINARY = ROOT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
OUT = ROOT / 'reports/reaudit-velocity-history'
F = lambda v: struct.unpack('<f', struct.pack('<f', v))[0]
f = BINARY.open('rb')
elf = ELFFile(f)
mapped = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
sha = hashlib.sha256(mapped).hexdigest()
assert sha == EXPECTED
segments = [s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']


def read(address, size):
    assert 0 < size <= 65536
    seg = next(s for s in segments if s['p_vaddr'] <= address and address+size <= s['p_vaddr']+s['p_filesz'])
    offset = seg['p_offset']+address-seg['p_vaddr']
    return mapped[offset:offset+size]


def proof():
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    ranges = [('bracket', 0xdb8e20, 0xdb934b), ('cache-prefix', 0xdcc4c0, 0xdcc682),
              ('history-writer',0x18a9280,0x18aa758), ('current-value-forwarder',0x18aa770,0x18aa77b),
              ('interface-construction',0x189c700,0x189c7cd)]
    result = []
    for name, start, end in ranges:
        code = read(start, end-start)
        ins = [f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(code, start)]
        (OUT / (name+'.txt')).write_text('\n'.join(ins)+'\n')
        result.append(dict(name=name, start=hex(start), bytes=len(code), sha256=hashlib.sha256(code).hexdigest()))
    # Every field below participates directly in the current native search.
    assertions = {
        0xdb8eb4: 'mov rdx, qword ptr [rdi + 0x20]',
        0xdb8ebc: 'subss xmm0, dword ptr [rdx + 0x18]',
        0xdb8ec4: 'shr ecx, 0xd',
        0xdb8ee4: 'movzx ecx, byte ptr [rdx + 8]',
        0xdb8eeb: 'shr si, 3',
        0xdb8f60: 'movsx ecx, word ptr [rdi + rsi + 4]',
        0xdb8f69: 'shr si, 6',
        0xdb8f70: 'imul ecx, esi',
        0xdb8f76: 'lea rsi, [rcx + rcx*4]',
        0xdb8f88: 'lea rcx, [rdi + rcx*8]',
        0xdb9184: 'lea rdx, [rbx + 0x20]',
        0xdb9111: 'movss dword ptr [rax + 0x34], xmm2',
        0xdb913b: 'movss dword ptr [rax + 0x30], xmm0',
        0xdb9266: 'mov byte ptr [rax + 0x38], cl',
        0xdcc5ba: 'lea rdi, [r12 + 0x60]',
        0x189c745: 'movabs rsi, 0xffffffff10001040',
        0x189c764: 'mov qword ptr [rax + 8], rsi',
        0x18a9c8a: 'test byte ptr [r15 + 9], 0x10',
    }
    for at, expected in assertions.items():
        ins = next(cs.disasm(read(at, 15), at))
        assert ins.mnemonic+' '+ins.op_str == expected
    relocations = {}
    for section in elf.iter_sections():
        if section['sh_type'] not in ('SHT_RELA','SHT_REL'): continue
        names=elf.get_section(section['sh_link'])
        for relocation in section.iter_relocations():
            if relocation['r_info_sym']:
                relocations[relocation['r_offset']] = names.get_symbol(relocation['r_info_sym']).name
    cs.detail=True
    jump=next(i for i in cs.disasm(read(0xc7c050,16),0xc7c050) if i.mnemonic=='jmp')
    symbol=relocations[jump.address+jump.size+jump.operands[0].mem.disp]
    assert symbol == 'memcpy', symbol
    table=0x44e06d0
    rtti=struct.unpack('<Q',read(table-8,8))[0]
    name=struct.unpack('<Q',read(rtti+8,8))[0]
    assert read(name,100).split(b'\0')[0] == b'16CInterpolatedVarI22CNetworkVelocityVectorE'
    for slot,expected in [(0xf0,0x18aa770),(0xf8,0x18aa760)]:
        assert struct.unpack('<Q',read(table+slot,8))[0] == expected
    return dict(clientSha256=sha, ranges=result, assertions=len(assertions),
        historyType='CInterpolatedVar<CNetworkVelocityVector>', vtableAssertions=3,
        externalShim=dict(address='0xc7c050',symbol=symbol,method='Bounded private-memory byte copy; no allocation or live target.'),
        layout=dict(pawnWrapper='0x5c8', wrapperHistory='0x60', historyStorage='0x20',
          ringBytes=32, ringFields=dict(storage='0x0', packed='0x8', oldestValidityTick='0x10', timeOffset='0x18'),
          packedFields=dict(head=[0,6], components=[6,6], count=[13,6], capacity=[19,6]),
          entryBytes=8, entryTick='i32', entryValueIndex='i16 at +4', valueBytesPerComponent=40),
        limits=['Layout is bound to current native readers; history producers and live active mode are not inferred from this oracle.'])


u = Uc(UC_ARCH_X86, UC_MODE_64)
u.mem_map(0, 0x5000000)
u.mem_map(0x6000000, 0x20000)
for seg in segments:
    u.mem_write(seg['p_vaddr'], seg.data())
wrapper, rings, data0, data1 = 0x6000000, 0x6001000, 0x6002000, 0x6006000
out, status, stack, stop = 0x600a000, 0x600b000, 0x601f000, 0x601ff00
active = {}


def hook(uc, address, size, _):
    active['instructions'] += 1
    if active.get('kind') == 'writer':
        if address == 0xc7c050:
            dest,source,count=[u.reg_read(r) for r in [UC_X86_REG_RDI,UC_X86_REG_RSI,UC_X86_REG_RDX]]
            assert 0 < count <= 320 and all(0x6000000 <= a and a+count < 0x6020000 for a in [dest,source])
            u.mem_write(dest,bytes(u.mem_read(source,count)))
            sp=u.reg_read(UC_X86_REG_RSP)
            u.reg_write(UC_X86_REG_RAX,dest)
            u.reg_write(UC_X86_REG_RIP,struct.unpack('<Q',u.mem_read(sp,8))[0])
            u.reg_write(UC_X86_REG_RSP,sp+8)
            active['memcpyCalls'] += 1
            return
        assert 0x18a9280 <= address < 0x18aa758, f'Unexpected writer path: {address:x}'
    else:
        assert 0xdb8e20 <= address < 0xdb934b, f'Unexpected native path: {address:x}'
    assert active['instructions'] < 5000


u.hook_add(UC_HOOK_CODE, hook)


def invoke(name, ticks, requested, *, head=0, capacity=8, offset=0, mode=0,
           selector=0, flags=1, cubic=1, components=1, second=None):
    global active
    u.mem_write(wrapper, bytes(0xc000))
    u.mem_write(wrapper+0x10, bytes([flags]))
    u.mem_write(wrapper+0x20, struct.pack('<Q', rings))
    # RIP-relative address from the hash-bound cubic-selection instruction.
    cubic_address = 0xdb925c+7+struct.unpack('<i', read(0xdb925f, 4))[0]
    u.mem_write(cubic_address, bytes([cubic]))
    values = {}
    for ring_number, ring_ticks in enumerate([ticks, ticks if second is None else second]):
        assert len(ring_ticks) <= capacity <= 32 and 0 <= head < capacity
        data = [data0, data1][ring_number]
        ring = rings+ring_number*32
        # The observed type's constructor sets bit12 (trivial full-value copy).
        packed = head | (components << 6) | 0x1000 | (len(ring_ticks) << 13) | (capacity << 19)
        u.mem_write(ring, struct.pack('<QIIIIfI', data, packed, 0, 0, 0, offset, 0))
        for i, tick in enumerate(ring_ticks):
            physical = (head+i) % capacity
            # Deliberately reverse physical value indexes, independently of ring head.
            value_index = capacity-1-i
            u.mem_write(data+physical*8, struct.pack('<ihh', tick, value_index, 0))
            value_address = data+capacity*8+value_index*components*40
            values[value_address] = dict(ring=ring_number, logical=i, tick=tick)
            u.mem_write(value_address, struct.pack('<3f', 100+i, 200+i, 300+i))
    u.mem_write(stack, struct.pack('<Q', stop))
    for reg, value in [(UC_X86_REG_RDI, wrapper), (UC_X86_REG_RSI, selector),
                       (UC_X86_REG_RDX, out), (UC_X86_REG_RCX, mode),
                       (UC_X86_REG_R8, status), (UC_X86_REG_RSP, stack)]:
        u.reg_write(reg, value)
    u.reg_write(UC_X86_REG_XMM0, int.from_bytes(struct.pack('<f', requested), 'little'))
    active = dict(instructions=0)
    u.emu_start(0xdb8e20, stop, count=3000)
    assert u.reg_read(UC_X86_REG_RIP) == stop
    raw = bytes(u.mem_read(out, 0x40))
    pointers = struct.unpack_from('<Q', raw, 0)[0], struct.unpack_from('<Q', raw, 16)[0], struct.unpack_from('<Q', raw, 32)[0]
    return dict(name=name, ticks=ticks, requested=F(requested), offset=F(offset), mode=mode,
        selector=selector, flags=flags, cubicGlobal=cubic, head=head, capacity=capacity,
        components=components, secondTicks=second, success=bool(u.reg_read(UC_X86_REG_RAX)),
        completionFlag=struct.unpack('<i', u.mem_read(status, 4))[0],
        selected=[values.get(p) if p else None for p in pointers],
        selectedTicks=[struct.unpack_from('<i', raw, off)[0] for off in (8,24,40)],
        fraction=struct.unpack_from('<f',raw,48)[0], rawFraction=struct.unpack_from('<f',raw,52)[0],
        threePoint=bool(raw[56]), pastNewest=bool(raw[57]), instructions=active['instructions'])


def history_snapshot():
    import runpy
    reader=runpy.run_path(str(Path(__file__).with_name('reaudit-velocity-capture-fields.py')))['read_velocity_fields']
    pawn=0x600c000
    u.mem_write(pawn+0x5c8,bytes(0x88))
    u.mem_write(pawn+0x638,bytes(u.mem_read(wrapper+0x10,4)))
    u.mem_write(pawn+0x648,struct.pack('<Q',rings))
    return reader(lambda a,n:bytes(u.mem_read(a,n)),0,pawn,0)['velocityHistoryRings'][0]


def write_sample(name,tick,vector):
    global active
    source=0x600d000
    u.mem_write(source,struct.pack('<3f',*vector)+bytes(28))
    u.mem_write(stack,struct.pack('<Q',stop))
    for reg,value in [(UC_X86_REG_RDI,wrapper),(UC_X86_REG_RSI,0),(UC_X86_REG_RDX,source),
                      (UC_X86_REG_RCX,tick),(UC_X86_REG_RSP,stack)]:u.reg_write(reg,value)
    active=dict(kind='writer',instructions=0,memcpyCalls=0)
    before=history_snapshot()
    u.emu_start(0x18a9280,stop,count=5000)
    assert u.reg_read(UC_X86_REG_RIP)==stop
    return dict(name=name,tick=tick,vector=vector,changed=bool(u.reg_read(UC_X86_REG_RAX)),
                before=before,after=history_snapshot(),**active)


if __name__ == '__main__':
    OUT.mkdir(exist_ok=True)
    report = proof()
    rows = []
    for head in [0, 6, 7]:
        for t in [96/64, 97/64, 97.5/64, 98/64, 98.5/64, 99/64, 99.5/64, 100/64, 101/64]:
            rows.append(invoke(f'head{head}-time{t}', [100,99,98,97], t, head=head))
    rows += [invoke('empty', [], 100/64), invoke('single-before', [100], 99/64),
             invoke('single-equal', [100], 100/64), invoke('single-after', [100], 101/64),
             invoke('offset-applied', [100,99,98,97], 100.5/64, offset=1/64),
             invoke('offset-bypassed', [100,99,98,97], 100.5/64, offset=1/64, mode=1),
             invoke('third-slot-selection-enabled', [100,99,98,97], 99.5/64, flags=0),
             invoke('third-slot-global-disabled', [100,99,98,97], 99.5/64, flags=0,cubic=0),
             invoke('secondary-disabled', [100,99,98,97], 99.5/64, selector=1),
             invoke('secondary-enabled', [100,99,98,97], 109.5/64, selector=1,flags=0x21,second=[110,109,108]),
             invoke('component-stride', [100,99,98,97], 99.5/64, components=3)]
    (OUT/'oracle-cases.json').write_text(json.dumps(rows,indent=2)+'\n')
    assert all(x['selectedTicks']==rows[i%9]['selectedTicks'] and x['fraction']==rows[i%9]['fraction'] for i,x in enumerate(rows[:27]))
    index = {x['name']: x for x in rows}
    assert index['offset-applied']['selectedTicks'][:2] == [100,99]
    assert index['offset-applied']['fraction'] == .5
    assert index['offset-bypassed']['pastNewest'] and index['offset-bypassed']['fraction']==1
    # These supplied monotone rings select a repeated older sample in slot three.
    # The presence of a native cubic branch does not establish that it is active.
    assert not index['third-slot-selection-enabled']['threePoint']
    assert not index['third-slot-global-disabled']['threePoint']
    assert not index['secondary-disabled']['success']
    assert index['secondary-enabled']['selectedTicks'][:2] == [110,109]
    assert all(x['selected'][0] is not None for x in rows if x['success'])
    writer_rows=[]
    # Observed wrapper flags from runtime005 are 0xc0/0xc8. The supplied ring is
    # preallocated so the oracle never executes an allocator or guesses its ABI.
    invoke('writer-seed',[100,99,98,97],100/64,flags=0xc0)
    u.mem_write(rings+12,struct.pack('<I',15))
    for name,tick,vector in [('new',101,[111,211,311]),('same-tick',101,[112,212,312]),
                             ('rewind',99,[113,213,313]),('unchanged-one',100,[113,213,313]),
                             ('unchanged-two',101,[113,213,313]),('change-again',102,[114,214,314])]:
        writer_rows.append(write_sample(name,tick,vector))
    assert writer_rows[0]['after']['entries'][0]['tick']==101
    assert writer_rows[1]['after']['count']==writer_rows[0]['after']['count']
    assert [e['tick'] for e in writer_rows[2]['after']['entries']]==[99,98,97]
    assert writer_rows[4]['changed'] is False
    assert all(x['after']['entries'][0]['vectors'][0]==x['vector'] for x in writer_rows)
    report.update(method=__doc__, rows=rows, cases=len(rows),
        writerCases=writer_rows,
        limits=report['limits']+['Supplied rings establish search behavior, not observed live history or a trainer correction.',
            'None of these supplied rings activates the three-point branch; its live activation and interpolation remain unverified.',
            'Writer cases use captured ordinary wrapper flags but synthetic preallocated histories, supplied tick keys and vectors; allocation, time-offset producer and prediction caller are not executed.'])
    (OUT/'oracle.json').write_text(json.dumps(report,indent=2)+'\n')
    findings=dict(clientSha256=sha,method=__doc__.split('\n\n')[0],
        nativeRangeSha256={x['name']:x['sha256'] for x in report['ranges']},
        proof=dict(instructionAssertions=report['assertions'],typeAssertions=report['vtableAssertions'],
                   historyType=report['historyType'],externalShim='Verified libc memcpy in private emulator memory'),
        bracketingCases=[{k:v for k,v in x.items() if k not in ['instructions']} for x in rows],
        writerCases=[dict(name=x['name'],tick=x['tick'],vector=x['vector'],changed=x['changed'],
            beforeTicks=[e['tick'] for e in x['before']['entries']],
            afterTicks=[e['tick'] for e in x['after']['entries']],
            afterVectors=[e['vectors'][0] for e in x['after']['entries']]) for x in writer_rows],
        captureReader='reaudit-velocity-capture-fields.py decodes the same private histories after every native write.',
        limits=report['limits'])
    (OUT/'findings.json').write_text(json.dumps(findings,indent=2)+'\n')
    print(json.dumps(dict(cases=len(rows),writerCases=len(writer_rows),assertions=report['assertions'],output=str(OUT/'oracle.json'))))
