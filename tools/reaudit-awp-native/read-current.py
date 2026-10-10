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
assert not (OUT / 'current-read.json').exists(), 'Refusing to overwrite evidence'
BINARY = ROOT / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
digest = hashlib.sha256()
with BINARY.open('rb') as stream:
    for block in iter(lambda: stream.read(1 << 20), b''): digest.update(block)
assert digest.hexdigest() == EXPECTED
RANGES = {
    'gun-primary': (0x14b2ef0, 0x3f2),
    'gun-fire-entry': (0x14b22d0, 0x230),
    'attack-clock-compute': (0x14ac0a0, 0x483),
    'attack-context': (0x1496e60, 0x1260),
    'primary-setter': (0x1653800, 0x2e0),
    'secondary-setter': (0x1653ae0, 0x3a0),
    'ordinary-postframe': (0x14b4510, 0x24e),
    'common-input-dispatch': (0x14b3fd0, 0x2a0),
    'primary-dispatch': (0x14b0360, 0x590),
    'secondary-dispatch': (0x14bfa70, 0x900),
    'primary-ready': (0x1641710, 0x90),
    'secondary-ready': (0x16417a0, 0x90),
    'input-active': (0x16412f0, 0xc0),
    'current-time-pair': (0x17fd290, 0x50),
    'camera-fov-setter': (0x1543eb0, 0x440),
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
    slots = {hex(slot): hex(q(table + slot)) for slot in [0xaa8, 0xb00, 0xbc8, 0xbd0, 0xbd8, 0xbf0, 0xc70, 0xcb0, 0xcd0, 0xd30, 0xd38, 0xd40, 0xd60]}
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
              'bytesRead': total, 'method': __doc__,
              'limits': ['Explicit instruction windows derived from matching-hash retained evidence, not complete callees/call graph.',
                         'No game/runtime/native execution. Current-byte inspection only.']}
    (OUT / 'current-read.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'ranges': len(records), 'bytesRead': total, 'slots': slots}))
