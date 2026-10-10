#!/usr/bin/env python3
"""Decode only two entry-bound prefixes from a hash-pinned retained span."""
import argparse
import hashlib
import json
from pathlib import Path
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_IMM

parser = argparse.ArgumentParser()
parser.add_argument('--span', type=Path, required=True)
parser.add_argument('--provenance', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert not args.output.exists()
sha = lambda b: hashlib.sha256(b).hexdigest()
raw, provenance = args.span.read_bytes(), args.provenance.read_bytes()
assert len(raw) == 458752 and sha(raw) == 'd92904abc0f050a5a0f921fb0d87c163cddded85cea5dc0a2231edc9469b01f5'
assert sha(provenance) == '6d9595dfbfb34e1f737f97d6e67f386ec4e2279e2d4f484c9a295db64367cc0c'
cs = Cs(CS_ARCH_X86, CS_MODE_64)
cs.detail = True
ranges = []
for name, start, size in [('caller', 0x15b1a70, 128), ('preparation', 0x15ac510, 512)]:
    data = raw[start - 0x1570000:start - 0x1570000 + size]
    pending, decoded, boundaries, calls = [start], {}, [], []
    while pending:
        at = pending.pop()
        if at in decoded:
            continue
        if not start <= at < start + size:
            boundaries.append(hex(at))
            continue
        instruction = next(cs.disasm(data[at - start:], at, count=1), None)
        if not instruction or at + instruction.size > start + size:
            boundaries.append(f'truncated instruction at {at:#x}')
            continue
        decoded[at] = f'{at:x}: {instruction.mnemonic} {instruction.op_str}'.rstrip()
        branch = instruction.mnemonic.startswith('j')
        if instruction.mnemonic == 'call':
            calls.append({'at': hex(at), 'target': instruction.op_str})
        if branch:
            if instruction.operands[0].type == CS_OP_IMM:
                pending.append(instruction.operands[0].imm)
            else:
                boundaries.append(instruction.op_str)
        if instruction.mnemonic not in ('jmp', 'ret', 'retf', 'ud2'):
            pending.append(at + instruction.size)
    ranges.append({'name': name, 'start': hex(start), 'bytes': size, 'sha256': sha(data),
                   'instructions': [decoded[a] for a in sorted(decoded)],
                   'outgoingBoundaries': sorted(set(boundaries)), 'unfollowedCalls': calls})
assert any('call 0x15ac510' in line for line in ranges[0]['instructions'])
report = {'schema': 'cs2.ground-preparation-prefix.v1', 'probeSha256': sha(Path(__file__).read_bytes()),
          'savedSpanSha256': sha(raw), 'provenanceSha256': sha(provenance), 'ranges': ranges,
          'limits': ['Static retained-byte decode, not execution or full-function proof.',
                     'Only instructions reachable inside declared 128/512-byte prefixes; outgoing targets and all calls remain unexpanded.',
                     'Saved provenance supplies server identity; this tool does not reread the installed ELF.']}
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
