"""Reproduce fixed current-native pistol selector and command-field evidence.

Static reads only. Exact full artifact hashes precede every bounded native
range. No target execution, discovery scan, game, browser, REA or exporter.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True, help='Workspace containing cs2-game and native-audit')
parser.add_argument('--output', type=Path, required=True, help='New raw output directory; must not exist')
args = parser.parse_args()
ROOT, OUT = args.root.resolve(), args.output.resolve()
if OUT.exists():
    raise SystemExit('Refusing to overwrite an existing output directory')
sys.path.insert(0, str(ROOT / 'native-audit/python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile
from google.protobuf.descriptor_pb2 import FileDescriptorProto

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()

config = json.loads((HERE / 'source-manifest.json').read_text())
for row in config['prerequisites']:
    assert sha(ROOT / row['path']) == row['sha256'], f"Prerequisite changed: {row['path']}"
for side, artifact in config['artifacts'].items():
    assert sha(ROOT / artifact['path']) == artifact['sha256'], f'{side} artifact changed; stop and re-establish evidence'

OUT.mkdir(parents=True, exist_ok=False)
cs = Cs(CS_ARCH_X86, CS_MODE_64)
code_records, data_records, class_records = [], [], {}
byte_count = 0
descriptor = None
for side, artifact in config['artifacts'].items():
    with (ROOT / artifact['path']).open('rb') as stream:
        elf = ELFFile(stream)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(at, size):
            global byte_count
            assert 0 < size <= 4096
            va, offset, length = next(s for s in segments if s[0] <= at and at + size <= s[0] + s[2])
            stream.seek(offset + at - va)
            raw = stream.read(size)
            assert len(raw) == size
            byte_count += size
            assert byte_count <= 16830
            return raw

        for row in config['ranges']:
            if row['side'] != side:
                continue
            raw = read(int(row['address'], 16), row['bytes'])
            assert hashlib.sha256(raw).hexdigest() == row['sha256'], row['name']
            listing = '\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(raw, int(row['address'], 16))) + '\n'
            destination = OUT / (row['name'] + '.txt')
            destination.write_text(listing)
            code_records.append(dict(name=row['name'], side=side, bytes=row['bytes'], codeSha256=row['sha256'], listingSha256=sha(destination)))

        for row in config['data']:
            if row['side'] != side:
                continue
            raw = read(int(row['address'], 16), row['bytes'])
            assert hashlib.sha256(raw).hexdigest() == row['sha256'], row['name']
            destination = OUT / (row['name'] + '.bin')
            destination.write_bytes(raw)
            data_records.append(dict(name=row['name'], side=side, bytes=row['bytes'], sha256=row['sha256']))
            if row['name'] == 'usercmd-descriptor':
                doc = FileDescriptorProto.FromString(raw)
                descriptor = dict(file=doc.name, messages={m.name: [dict(name=f.name, number=f.number, type=f.type, label=f.label, default=f.default_value, type_name=f.type_name) for f in m.field] for m in doc.message_type})

        if side == 'server':
            for weapon, binding in config['classes'].items():
                slots = {}
                for slot, expected in binding['slots'].items():
                    raw = read(int(binding['table'], 16) + int(slot, 16), 8)
                    actual = hex(struct.unpack('<Q', raw)[0])
                    assert actual == expected, (weapon, slot)
                    slots[slot] = dict(target=actual, sha256=hashlib.sha256(raw).hexdigest())
                class_records[weapon] = slots

assert byte_count == 16830 and descriptor is not None
(OUT / 'descriptor.json').write_text(json.dumps(descriptor, indent=2) + '\n')
weapon_path = ROOT / 'native-audit/reports/core-shooting-next/pistol-recoil/weapon-data.json'
(OUT / 'weapon-data.json').write_bytes(weapon_path.read_bytes())
report = dict(method=__doc__, readerSha256=sha(Path(__file__)), sourceManifestSha256=sha(HERE / 'source-manifest.json'),
              artifactHashes={side: artifact['sha256'] for side, artifact in config['artifacts'].items()}, wholeArtifactHashesVerified=True,
              prerequisites=config['prerequisites'], ranges=code_records, data=data_records, classes=class_records,
              descriptorSha256=sha(OUT / 'descriptor.json'), weaponDataSha256=sha(OUT / 'weapon-data.json'),
              bytesRead=byte_count, virtualSlotAssertions=sum(len(s) for s in class_records.values()),
              limits=['Static file reads only; no native execution or RNG distribution observation.',
                      'Weapon data is the exact retained parsed native resource, not a new live data read.',
                      'No command seed producer or live command-to-shot mapping is reconstructed.'])
(OUT / 'read.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(bytesRead=byte_count, codeRanges=len(code_records), virtualSlotAssertions=report['virtualSlotAssertions'])))
