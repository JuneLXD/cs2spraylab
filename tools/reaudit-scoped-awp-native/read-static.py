#!/usr/bin/env python3
"""Fixed current-server AWP zoom/data field joins; no discovery or native run."""
import argparse
import hashlib
import json
import struct
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile

ROOT = Path(__file__).resolve().parent
PLAN = ROOT / 'static-plan.json'
RETAINED = ROOT / 'static-proof.json'
RETAINED_SHA = '0674ee146cdc4c9b6a91a53e7aacf466ac5eec62ae7c194ac9c74e58aa01613f'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite static output'
    assert digest(RETAINED) == RETAINED_SHA
    retained = json.loads(RETAINED.read_text())
    plan = json.loads(PLAN.read_text())
    assert digest(args.binary) == plan['serverSha256']
    args.out.mkdir(parents=True, exist_ok=False)
    ledger, results, names = [], {}, []
    decoded = {}
    status, failure = 'failed', None
    try:
        with args.binary.open('rb') as source:
            elf = ELFFile(source)
            loads = [(int(s['p_vaddr']), int(s['p_offset']), int(s['p_filesz']))
                     for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
            def read(at, size, role):
                assert 0 < size <= 1024
                assert sum(r['bytes'] for r in ledger) + size <= plan['totalSelectedReadBudgetBytes']
                va, off, _ = next(s for s in loads if s[0] <= at and at + size <= s[0] + s[2])
                source.seek(off + at - va)
                raw = source.read(size)
                assert len(raw) == size
                ledger.append({'name': role, 'address': hex(at), 'bytes': size,
                               'sha256': hashlib.sha256(raw).hexdigest(), 'hex': raw.hex()})
                return raw
            dis = Cs(CS_ARCH_X86, CS_MODE_64)
            for item in plan['fixedReads']:
                at, size, name = int(item['address'], 16), item['bytes'], item['name']
                raw = read(at, size, name)
                if 'expectedPointer' in item:
                    actual = struct.unpack('<Q', raw)[0]
                    assert actual == int(item['expectedPointer'], 16), (name, hex(actual))
                    results[name] = hex(actual)
                elif 'expectedPointers' in item:
                    actual = struct.unpack('<QQ', raw)
                    assert list(actual) == [int(x, 16) for x in item['expectedPointers']], (name, actual)
                    results[name] = [hex(x) for x in actual]
                elif 'decodeStop' in item:
                    instructions = []
                    for ins in dis.disasm(raw, at):
                        instructions.append({'address': hex(ins.address), 'bytes': ins.bytes.hex(),
                                             'mnemonic': ins.mnemonic, 'operands': ins.op_str})
                        assert ins.mnemonic in ('mov', 'ret'), (name, ins.mnemonic)
                        if ins.mnemonic == 'ret':
                            break
                    assert instructions and instructions[-1]['mnemonic'] == 'ret'
                    decoded[name] = instructions
                    (args.out / (name + '.txt')).write_text('\n'.join(
                        f"{i['address']}: {i['mnemonic']} {i['operands']}" for i in instructions) + '\n')
                else:
                    assert item['recordBytes'] == 32 and size == 1024
                    for index in range(32):
                        record = raw[index * 32:(index + 1) * 32]
                        pointer = struct.unpack_from('<Q', record)[0]
                        name_raw = read(pointer, 80, f'fixed-schema-name-{index}')
                        assert b'\0' in name_raw
                        field = name_raw.split(b'\0', 1)[0]
                        assert field and all(32 <= c < 127 for c in field)
                        names.append({'record': hex(at + index * 32), 'name': field.decode('ascii'),
                                      'offset': hex(struct.unpack_from('<I', record, 16)[0])})
            assert names[0]['name'] == 'm_flMaxSpeed' and names[0]['offset'] == '0x748'
            selected = [row for row in names if row['name'] == 'm_nZoomLevels']
            assert len(selected) == 1 and selected[0]['offset'] == '0x7f4'
            standard = decoded['standard-data-count-getter']
            assert [i['operands'] for i in standard[:-1]] == ['rax, qword ptr [rdi + 0x600]', 'eax, dword ptr [rax + 0x7f4]']
            current = decoded['retained-gun-current-zoom-getter']
            assert len(current) == 2 and current[0]['operands'].startswith('eax, dword ptr [rdi + ')
            assert ledger == retained['reads'], 'Selected native bytes changed'
            assert results == retained['classSlots'] and decoded == retained['getters']
            assert names == retained['schemaRecords']
            status = 'passed'
    except Exception as exc:
        failure = repr(exc)
    result = {'schema': 'cs2.scoped-awp-static-proof.v1', 'status': status, 'failure': failure,
              'serverSha256': plan['serverSha256'], 'wholeArtifactHashVerified': True,
              'readerSha256': digest(Path(__file__)), 'planSha256': digest(PLAN),
              'retainedProofSha256': RETAINED_SHA,
              'selectedBytes': sum(r['bytes'] for r in ledger), 'selectedByteCeiling': 3640,
              'classSlots': results, 'getters': decoded, 'schemaRecords': names, 'reads': ledger,
              'limits': plan['limits'] + ['No native arithmetic or live getter invocation in this static proof.',
                  'Current accessor reads its demonstrated weapon-instance integer; naming that integer is a separate metadata association.',
                  'The named data integer is joined to the standard accessor by its exact demonstrated member access and fixed schema record.']}
    output = args.out / 'proof.json'
    output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'output': str(output), 'sha256': digest(output), 'status': status,
                      'failure': failure, 'selectedBytes': result['selectedBytes'],
                      'getters': decoded, 'namedCount': [r for r in names if r['name'] == 'm_nZoomLevels']}))
    assert status == 'passed', failure


if __name__ == '__main__':
    main()
