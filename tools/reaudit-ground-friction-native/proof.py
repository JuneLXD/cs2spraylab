#!/usr/bin/env python3
"""Recheck fixed current-server code ranges, class dispatch and stash schema.

No native code is executed. Run serially under the documented memory/CPU cap.
Raw locations belong to this implementation and local proof output only.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from elftools.elf.elffile import ELFFile

ROOT = Path(__file__).resolve().parent
SERVER_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def verify(binary, manifest_path):
    assert digest(binary) == SERVER_SHA, 'Current server digest changed'
    manifest = json.loads(manifest_path.read_text())
    assert manifest['serverSha256'] == SERVER_SHA
    ranges = manifest['ranges']
    assert len(ranges) <= 160 and sum(r['bytes'] for r in ranges) <= 32768
    ledger = []
    with binary.open('rb') as source:
        elf = ELFFile(source)
        loads = [(int(s['p_vaddr']), int(s['p_offset']), int(s['p_filesz']))
                 for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
        def read(at, size, role):
            assert 0 < size <= 4096
            va, off, _ = next(s for s in loads if s[0] <= at and at + size <= s[0] + s[2])
            source.seek(off + at - va)
            raw = source.read(size)
            assert len(raw) == size
            ledger.append({'address': hex(at), 'bytes': size, 'role': role,
                           'sha256': hashlib.sha256(raw).hexdigest()})
            return raw
        def q(at, role):
            return struct.unpack('<Q', read(at, 8, role))[0]
        def text(at, role):
            raw = read(at, 128, role).split(b'\0', 1)[0]
            assert raw and all(32 <= b < 127 for b in raw)
            return raw.decode('ascii')
        for row in ranges:
            raw = read(int(row['address'], 16), row['bytes'], row['role'])
            assert hashlib.sha256(raw).hexdigest() == row['sha256'], row['role']
        table = 0x26282f0
        typeinfo = q(table - 8, 'movement-rtti')
        assert text(q(typeinfo + 8, 'movement-rtti-name'), 'movement-rtti-name-text') == '26CCSPlayer_MovementServices'
        slots = {0: 0x157ef40, 0xe8: 0x15d82e0, 0x118: 0x15d3120, 0x120: 0x15d3580,
                 0x128: 0x15d3670, 0x138: 0x15d3b40, 0x140: 0x15b04d0}
        for slot, target in slots.items():
            assert q(table + slot, 'movement-dispatch') == target
        descriptor = 0x277f820
        assert text(q(descriptor + 8, 'schema-name'), 'schema-name-text') == 'CCSPlayer_MovementServices'
        count = struct.unpack('<H', read(descriptor + 0x24, 2, 'schema-field-count'))[0]
        assert count == 50
        fields = read(q(descriptor + 0x30, 'schema-field-table'), count * 32, 'schema-field-records')
        expected = {'m_bUseFrictionStashedSpeed': 0x690, 'm_flUseFrictionStashedSpeedUntilFrac': 0x694,
                    'm_flFrictionStashedSpeed': 0x698, 'm_vecWalkWishVel': 0x7a8}
        found = {}
        for index in range(count):
            name = text(struct.unpack_from('<Q', fields, index * 32)[0], 'schema-field-name')
            if name in expected:
                found[name] = struct.unpack_from('<I', fields, index * 32 + 16)[0]
        assert found == expected
    return {'schema': 'cs2.ground-friction-portable-proof.v1', 'serverSha256': SERVER_SHA,
            'wholeArtifactHashVerified': True, 'manifestSha256': digest(manifest_path),
            'readerSha256': digest(Path(__file__)), 'rangeCount': len(ranges),
            'selectedRangeBytes': sum(r['bytes'] for r in ranges), 'classSlotsVerified': len(slots),
            'schemaFieldsVerified': list(expected), 'reads': ledger,
            'addressDomains': {'current': 'ELF virtual addresses through PT_LOAD',
                              'retainedGhidraToElf': 'Subtract retained image-base adjustment 0x100000.'},
            'limits': ['Static hash/class/schema verification only; no native invocation or live caller association.',
                       'Fixed selected ranges, not a broad executable scan; no automatic callee following.',
                       'Existing-instance reset ownership and complete movement modes are outside this proof.']}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'proof-manifest.json')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite a proof output'
    result = verify(args.binary.resolve(), args.manifest.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(args.out), 'sha256': digest(args.out), 'status': 'passed',
                      'ranges': result['rangeCount'], 'selectedBytes': result['selectedRangeBytes']}))

if __name__ == '__main__':
    main()
