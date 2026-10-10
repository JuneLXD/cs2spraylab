#!/usr/bin/env python3
"""Fixed two-range pawn-command ordering corroboration; no native execution."""
import argparse
import hashlib
import json
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile

SERVER_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
LOCATION_SHA = 'eb103b04b97338e15e09ea96ff9122b4debf293ebfaa1a7daf2804cee04bbbd1'
CALLER_REA_SHA = '31d826ac9da61c8ac089c5fa9bda6b72ab21c7b09536d8cf34e1ff485a21c48d'
RANGES = [(0x17c3080, 794), (0x17c33a0, 556)]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--location', type=Path, required=True)
    parser.add_argument('--caller-rea', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing output overwrite'
    assert digest(args.location) == LOCATION_SHA and digest(args.caller_rea) == CALLER_REA_SHA
    location = json.loads(args.location.read_text())['structuredContent']
    caller = json.loads(args.caller_rea.read_text())['structuredContent']
    for record in (location, caller):
        assert record['evidence']['subject']['digest']['sha256'] == SERVER_SHA
    body = location['result']['procedure']['body']
    resolved = [(int(r['start'], 16) - 0x100000,
                 int(r['end'], 16) - int(r['start'], 16) + 1) for r in body['ranges']]
    assert resolved == RANGES and body['total_bytes'] == 1350 and body['span_bytes'] == 1356
    assert digest(args.binary) == SERVER_SHA
    args.out.mkdir(parents=True, exist_ok=False)
    reads, instructions, matches = [], [], {}
    status, failure = 'failed', None
    try:
        with args.binary.open('rb') as source:
            elf = ELFFile(source)
            loads = [(int(s['p_vaddr']), int(s['p_offset']), int(s['p_filesz']))
                     for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
            dis = Cs(CS_ARCH_X86, CS_MODE_64)
            for at, size in RANGES:
                va, offset, _ = next(s for s in loads if s[0] <= at and at + size <= s[0] + s[2])
                source.seek(offset + at - va)
                raw = source.read(size)
                assert len(raw) == size
                decoded = list(dis.disasm(raw, at))
                assert sum(i.size for i in decoded) == size, 'Incomplete instruction boundary'
                reads.append({'address': hex(at), 'bytes': size, 'sha256': hashlib.sha256(raw).hexdigest(), 'hex': raw.hex()})
                instructions.extend({'address': i.address, 'bytes': i.bytes.hex(), 'mnemonic': i.mnemonic,
                                     'operands': i.op_str} for i in decoded)
        assert sum(row['bytes'] for row in reads) == 1350
        for role, target in [('movementLoop', '0x17ba890'), ('remainingEvents', '0x17bad90')]:
            found = [i for i in instructions if i['mnemonic'] == 'call' and i['operands'] == target]
            assert len(found) == 1, role
            matches[role] = found[0]
        between = [i for i in instructions if matches['movementLoop']['address'] < i['address'] < matches['remainingEvents']['address']]
        post = [i for i in between if i['mnemonic'] == 'call' and i['operands'].endswith('+ 0x138]')]
        assert len(post) == 1, 'Expected typed post-movement callback'
        matches['postMovementCallback'] = post[0]
        assert not any(i['mnemonic'].startswith('j') or i['mnemonic'] in ('ret', 'loop', 'loope', 'loopne') for i in between), 'Ordering block is not straight-line'
        assert any(i['mnemonic'] == 'call' and i['operands'].endswith('+ 0x118]') and i['address'] < matches['movementLoop']['address'] for i in instructions)
        matches['orderingBlockInstructions'] = between
        status = 'passed'
    except Exception as exc:
        failure = repr(exc)
    (args.out / 'pawn-command-caller.txt').write_text('\n'.join(
        f"{i['address']:x}: {i['mnemonic']} {i['operands']}" for i in instructions) + '\n')
    result = {'schema': 'cs2.awp-movement-phase-caller.v1', 'status': status, 'failure': failure,
              'serverSha256': SERVER_SHA, 'wholeArtifactHashVerified': True,
              'readerSha256': digest(Path(__file__)), 'retainedLocationSha256': LOCATION_SHA,
              'retainedCallerReaSha256': CALLER_REA_SHA,
              'selectedBytes': sum(r['bytes'] for r in reads), 'selectedByteCeiling': 1350,
              'decodedInstructions': len(instructions), 'reads': reads, 'matches': matches,
              'listingSha256': digest(args.out / 'pawn-command-caller.txt'),
              'addressDomains': 'Resolved retained Ghidra body translated by its verified image-base adjustment to ELF load virtual addresses.',
              'rule': 'Within this command caller, the complete movement-loop call precedes the typed post-movement callback and remaining-event loop in a straight-line block.',
              'limits': ['Static caller code only; no game, emulator, broad scan or callee read.',
                         'Lower class/accessor/weapon bindings are separate retained evidence.',
                         'Does not associate a trainer 128Hz step with a native 64Hz command or change scope timing.',
                         'Does not prove the invocation or eligibility of any particular live scope transition.']}
    (args.out / 'proof.json').write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(args.out / 'proof.json'), 'sha256': digest(args.out / 'proof.json'),
                      'status': status, 'failure': failure, 'selectedBytes': result['selectedBytes'],
                      'decodedInstructions': len(instructions)}))
    assert status == 'passed', failure


if __name__ == '__main__':
    main()
