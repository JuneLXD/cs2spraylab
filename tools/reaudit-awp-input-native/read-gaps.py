"""Bounded AWP input preference/consume gaps. Static current bytes only."""
import argparse, hashlib, json, struct, sys
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root, output = args.root.resolve(), args.output.resolve()
assert not output.exists(), 'Use a new evidence directory'
sys.path.insert(0, str(root / 'native-audit/python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile

expected = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
binary = root / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
digest = hashlib.sha256()
with binary.open('rb') as stream:
    for block in iter(lambda: stream.read(1 << 20), b''): digest.update(block)
assert digest.hexdigest() == expected
output.mkdir(parents=True)
cs = Cs(CS_ARCH_X86, CS_MODE_64); cs.detail = True
ranges = {
    'input-consume': (0x1641460, 0x160),
    'awp-scope-capability': (0x1487f60, 0x50),
    'awp-alternate-capability': (0x1483c20, 0x30),
}
total = 0
with binary.open('rb') as stream:
    elf = ELFFile(stream)
    segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    def read(at, size):
        global total
        assert 0 < size <= 0x400
        va, offset, length = next(s for s in segments if s[0] <= at and at + size <= s[0] + s[2])
        total += size; assert total < 8192
        stream.seek(offset + at - va)
        data = stream.read(size); assert len(data) == size
        return data
    def q(at): return struct.unpack('<Q', read(at, 8))[0]
    def string(at): return read(at, 100).split(b'\0')[0].decode()
    table = 0x25fafd8
    assert string(q(q(table - 8) + 8)) == '10CWeaponAWP'
    slots = {hex(s): hex(q(table + s)) for s in [0xac8, 0xb70, 0xbd0, 0xbd8, 0xd08, 0xd30, 0xd38, 0xd40, 0xd68]}
    ranges['awp-secondary-eligibility'] = (int(slots['0xac8'], 16), 0x100)
    preference_name = string(0x8d4e11)
    records = []
    for name, (at, size) in ranges.items():
        code = read(at, size); lines = []
        for ins in cs.disasm(code, at):
            notes = []
            for op in ins.operands:
                if op.type == 3 and cs.reg_name(op.mem.base) == 'rip':
                    target = ins.address + ins.size + op.mem.disp
                    notes.append('rip=' + hex(target))
            lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}' + (' ; ' + ', '.join(notes) if notes else ''))
        listing = '\n'.join(lines) + '\n'
        (output / (name + '.txt')).write_text(listing)
        records.append({'name': name, 'address': hex(at), 'bytes': size, 'codeSha256': hashlib.sha256(code).hexdigest(), 'listingSha256': hashlib.sha256(listing.encode()).hexdigest()})
    report = {'method': __doc__, 'serverSha256': expected, 'wholeArtifactHashVerified': True,
        'readerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'class': 'CWeaponAWP', 'slots': slots, 'preference': {'string': preference_name, 'address': '0x8d4e11'},
        'ranges': records, 'bytesRead': total, 'limits': ['No native execution or live input producer/consume reset observation.']}
    (output / 'current-read.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'preference': preference_name, 'slots': slots, 'ranges': len(records), 'bytesRead': total}))
