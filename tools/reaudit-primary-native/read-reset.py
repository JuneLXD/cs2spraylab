"""Read one bounded native common-primary reset gap, without game or emulation.

Run only when granted the serial slot, under MemoryMax=512M / SwapMax=0 /
CPUQuota=100%. Concrete class tables come from the retained common-reload read;
no discovery scan or new analysis database is used. Raw locations stay here.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
ROOT = a.root.resolve()
OUT = a.output.resolve() / 'current-reset'
assert not (OUT / 'current-read.json').exists(), 'Refusing to overwrite evidence'
EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
BINARY = ROOT / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
sys.path.insert(0, str(ROOT / 'native-audit/python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


assert sha(BINARY) == EXPECTED
prior_path = ROOT / 'native-audit/reports/reaudit-common-reload-portable/current-read.json'
prior = json.loads(prior_path.read_text())
assert prior['serverSha256'] == EXPECTED and prior['wholeArtifactHashVerified']
assert len(prior['classes']) == 7 and not prior['missing']
OUT.mkdir(parents=True, exist_ok=True)
cs = Cs(CS_ARCH_X86, CS_MODE_64)
cs.detail = True
ranges = {
    'idle-counter-reset': (0x14af980, 0x9e0),
    'full-auto-accessor': (0x1444260, 0x10),
    'full-auto-wrapper': (0x1446d60, 0x80),
}
records = []
classes = {}
count = 0
with BINARY.open('rb') as stream:
    elf = ELFFile(stream)
    segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

    def read(at, size):
        global count
        assert 0 < size <= 0x1000
        va, offset, length = next(s for s in segments if s[0] <= at and at + size <= s[0] + s[2])
        stream.seek(offset + at - va)
        raw = stream.read(size)
        assert len(raw) == size
        count += size
        assert count <= 8192
        return raw

    def q(at):
        return struct.unpack('<Q', read(at, 8))[0]

    for weapon, old in prior['classes'].items():
        table = int(old['table'], 16)
        slots = {hex(slot): hex(q(table + slot)) for slot in [0xbd0, 0xbd8, 0xd30, 0xd40]}
        assert slots == {'0xbd0': '0x1444260', '0xbd8': '0x1446d60',
                         '0xd30': '0x14b2ef0', '0xd40': '0x14b4510'}, (weapon, slots)
        classes[weapon] = {'table': old['table'], 'slots': slots}
    for name, (at, size) in ranges.items():
        raw = read(at, size)
        lines = []
        for ins in cs.disasm(raw, at):
            lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}')
        listing = '\n'.join(lines) + '\n'
        (OUT / (name + '.txt')).write_text(listing)
        records.append({'name': name, 'address': hex(at), 'bytes': size,
                        'codeSha256': hashlib.sha256(raw).hexdigest(),
                        'listingSha256': hashlib.sha256(listing.encode()).hexdigest()})
report = {'serverSha256': EXPECTED, 'wholeArtifactHashVerified': True,
          'readerSha256': sha(Path(__file__)), 'priorReadSha256': sha(prior_path),
          'classes': classes, 'virtualSlotAssertions': len(classes) * 4,
          'ranges': records, 'bytesRead': count, 'method': __doc__,
          'limits': ['Static current-byte reads; no native execution.',
                     'No input-mask producer/reset lifecycle or physical input capture.',
                     'The counter is linked by read/write identity; no new field-name schema claim.']}
(OUT / 'current-read.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'ranges': len(records), 'bytesRead': count, 'virtualSlotAssertions': len(classes) * 4}))
