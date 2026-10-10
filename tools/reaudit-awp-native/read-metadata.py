"""Bounded current server AWP clock, scope, and concrete-class read. Static only."""
import hashlib, json, struct, sys
from pathlib import Path
import argparse
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True, help='Workspace containing cs2-game and native-audit/python')
parser.add_argument('--output', type=Path, required=True, help='New local evidence directory shared by all readers')
args = parser.parse_args()
ROOT = args.root.resolve()
sys.path.insert(0, str(ROOT / 'native-audit/python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile
OUT = args.output.resolve()
OUT.mkdir(parents=True, exist_ok=True)
assert not (OUT / 'metadata-read.json').exists(), 'Refusing to overwrite evidence'
BINARY = ROOT / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
digest = hashlib.sha256()
with BINARY.open('rb') as stream:
    for block in iter(lambda: stream.read(1 << 20), b''): digest.update(block)
assert digest.hexdigest() == EXPECTED
RANGES = {
    'context-time-seconds': (0x1785c30, 0x80),
    'vdata-source': (0x15841b0, 0x90),
    'cs-vdata-constructor': (0x1499cb0, 0x420),
    'base-vdata-default-flags': (0x17f6440, 0x20),
    'base-placement-default-flags': (0x17f6653, 0x20),
    'manual-scope-apply': (0x14bf050, 0x990),
}
cs = Cs(CS_ARCH_X86, CS_MODE_64); cs.detail = True
records = []; total = 0
with BINARY.open('rb') as stream:
    elf = ELFFile(stream)
    segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    def read(at, size):
        global total
        assert 0 < size <= 0x2000
        va, offset, length = next(s for s in segments if s[0] <= at and at + size <= s[0] + s[2])
        stream.seek(offset + at - va); value = stream.read(size); assert len(value) == size
        total += size; assert total < 65536
        return value
    def q(at): return struct.unpack('<Q', read(at, 8))[0]
    def string(at): return read(at, 100).split(b'\0')[0].decode()
    table = 0x25fafd8
    name = string(q(q(table - 8) + 8)); assert name == '10CWeaponAWP'
    slots = {hex(slot): hex(q(table + slot)) for slot in [0xaa8, 0xb00, 0xb90, 0xbc8, 0xbd0, 0xbd8, 0xbf0, 0xc68, 0xc70, 0xcb0, 0xcd0, 0xd08, 0xd30, 0xd38, 0xd40, 0xd60, 0xd68]}
    fields = []
    for field, address, offset in [('m_bLinkedCooldowns', 0x2788b60, 0x4c6), ('m_iFlags', 0x2788b80, 0x4c7),
      ('m_bIsFullAuto', 0x277ac00, 0x72d), ('m_flCycleTime', 0x277ac60, 0x738),
      ('m_bUnzoomsAfterShot', 0x277b020, 0x7f0), ('m_nZoomLevels', 0x277b060, 0x7f4),
      ('m_nZoomFOV1', 0x277b080, 0x7f8), ('m_nZoomFOV2', 0x277b0a0, 0x7fc)]:
        raw = read(address, 32)
        assert string(struct.unpack_from('<Q', raw)[0]) == field
        assert struct.unpack_from('<I', raw, 16)[0] == offset
        fields.append({'field': field, 'offset': hex(offset), 'descriptorSha256': hashlib.sha256(raw).hexdigest()})
    for name, (address, size) in RANGES.items():
        code = read(address, size); lines = []
        for ins in cs.disasm(code, address):
            notes = []
            for op in ins.operands:
                if op.type == 3 and cs.reg_name(op.mem.base) == 'rip':
                    target = ins.address + ins.size + op.mem.disp
                    notes.append('rip=' + hex(target))
                    if 'ss' in ins.mnemonic:
                        notes.append('f32=' + repr(struct.unpack('<f', read(target, 4))[0]))
                    if ins.mnemonic == 'lea':
                        try:
                            value = string(target)
                            if value and all(c.isprintable() for c in value): notes.append('str=' + repr(value))
                        except (StopIteration, UnicodeDecodeError): pass
            lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}' + (' ; ' + ', '.join(notes) if notes else ''))
        listing = '\n'.join(lines) + '\n'; (OUT / (name + '.txt')).write_text(listing)
        records.append({'name': name, 'address': hex(address), 'bytes': size,
                        'codeSha256': hashlib.sha256(code).hexdigest(),
                        'listingSha256': hashlib.sha256(listing.encode()).hexdigest()})
    report = {'serverSha256': EXPECTED, 'wholeArtifactHashVerified': True,
              'readerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'class': 'CWeaponAWP', 'table': hex(table), 'slots': slots, 'ranges': records,
              'bytesRead': total, 'schemaFields': fields, 'method': __doc__,
              'limits': ['Explicit instruction windows derived from matching-hash retained evidence, not complete callees/call graph.',
                         'No game/runtime/native execution. Current-byte inspection only.']}
    (OUT / 'metadata-read.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'ranges': len(records), 'bytesRead': total, 'schemaFields': fields, 'slots': slots}))
