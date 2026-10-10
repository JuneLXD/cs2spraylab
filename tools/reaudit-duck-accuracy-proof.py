#!/usr/bin/env python3
"""Read bounded current-server bytes for the crouch flag/accuracy relationship.

Static only. Does not start a game, REA bridge, Ghidra, or emulator. A full
streaming hash binds all small reads. Raw instruction locations stay local.
Run only in the parent's serialized 512 MiB / swap0 / CPU100 execution slot.
"""
import argparse
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

AUDIT = Path(__file__).resolve().parents[2] / 'native-audit'
sys.path.insert(0, str(AUDIT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64, CS_OP_MEM, CS_OP_IMM
from capstone.x86_const import X86_REG_RIP
from elftools.elf.elffile import ELFFile

SERVER_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
RANGES = {
    'duck': (0x15b2200, 0x15e2),
    'finish-duck': (0x15aa6c0, 0x5f0),
    'finish-unduck': (0x15a9c90, 0x5a0),
    'can-unduck': (0x158a210, 0x410),
    'set-flags': (0xd56050, 0x400),
    'clear-flags': (0xd57fc0, 0x1c0),
    'accuracy-update': (0x14a5310, 0x5d0),
    'accuracy-recovery': (0x14988d0, 0x160),
    'get-inaccuracy': (0x1495b90, 0x510),
}
EXACT = {
    'duck': {
        0x15b27ae: 'movss xmm3, dword ptr [rip - 0xce528e]',
        0x15b283c: 'comiss xmm3, xmm0',
        0x15b283f: 'jbe 0x15b2846',
        0x15b2841: 'test r12, r12',
        0x15b2844: 'jne 0x15b289b',
        0x15b284c: 'call 0x15aa6c0',
        0x15b2bf3: 'call 0x158a210',
        0x15b2bfa: 'je 0x15b3068',
        0x15b2d55: 'mov byte ptr [r14 + 0x408], 0',
        0x15b2d7e: 'movss xmm1, dword ptr [rip - 0xce506e]',
        0x15b2d86: 'comiss xmm1, xmm0',
        0x15b2d89: 'ja 0x15b2d94',
        0x15b2d8b: 'comiss xmm0, xmm1',
        0x15b2d8e: 'ja 0x15b289b',
        0x15b2da1: 'test byte ptr [rdi + 0x668], 2',
        0x15b2dae: 'mov esi, 2',
        0x15b2db3: 'call 0xd57fc0',
        0x15b3070: 'ucomiss xmm3, dword ptr [r14 + 0x40c]',
        0x15b307e: 'jne 0x15b35f6',
        0x15b30ad: 'mov esi, 2',
        0x15b30b2: 'call 0xd56050',
    },
    'finish-duck': {
        0x15aa77e: 'mov esi, 2', 0x15aa783: 'call 0xd56050',
        0x15aab92: 'mov dword ptr [rbx + 0x40c], 0x3f800000',
    },
    'finish-unduck': {
        0x15a9d45: 'mov esi, 2', 0x15a9d4a: 'call 0xd57fc0',
        0x15aa012: 'mov dword ptr [rbx + 0x40c], 0',
    },
    'set-flags': {
        0xd56064: 'mov r13d, dword ptr [rdi + 0x668]',
        0xd56074: 'mov ebx, esi', 0xd56079: 'or ebx, r13d',
        0xd56271: 'mov dword ptr [r12 + 0x668], ebx',
    },
    'clear-flags': {
        0xd57fd4: 'mov r13d, dword ptr [rdi + 0x668]',
        0xd57ff8: 'not esi', 0xd58003: 'and esi, r13d',
        0xd5812e: 'mov dword ptr [rbx + 0x668], r12d',
    },
    'accuracy-update': {
        0x14a536d: 'test byte ptr [r12 + 0x668], 2',
        0x14a5376: 'jne 0x14a56a0',
        0x14a537c: 'mov rax, qword ptr [rax + 0xc08]',
    },
    'accuracy-recovery': {
        0x14988fe: 'mov edx, dword ptr [rbx + 0x668]',
        0x1498904: 'test dl, 1', 0x1498950: 'and edx, 2',
        0x1498953: 'je 0x14989e0',
        0x1498968: 'movss xmm1, dword ptr [rax + 0x840]',
        0x14989ef: 'movss xmm1, dword ptr [rax + 0x844]',
    },
}


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out', type=Path, default=AUDIT / 'reports/reaudit-duck-accuracy')
    p.add_argument('--summary', type=Path, help='Write a compact report without native locations.')
    args = p.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    binary = AUDIT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
    assert digest(binary) == SERVER_SHA, 'Changed server: revalidate before reading.'
    records = {}
    instructions = {}
    with binary.open('rb') as f:
        elf = ELFFile(f)
        loads = [(int(s['p_vaddr']), int(s['p_offset']), int(s['p_filesz']))
                 for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(address, size):
            for va, offset, count in loads:
                if va <= address and address + size <= va + count:
                    f.seek(offset + address - va)
                    result = f.read(size)
                    assert len(result) == size
                    return result
            raise ValueError('Read outside mapped file range')

        cs = Cs(CS_ARCH_X86, CS_MODE_64)
        cs.detail = True
        for name, (start, size) in RANGES.items():
            raw = read(start, size)
            decoded = list(cs.disasm(raw, start))
            assert decoded and decoded[0].address == start
            lines, constants = [], []
            for ins in decoded:
                refs = []
                for operand in ins.operands:
                    if operand.type == CS_OP_MEM and operand.mem.base == X86_REG_RIP:
                        target = ins.address + ins.size + operand.mem.disp
                        try:
                            value = struct.unpack('<f', read(target, 4))[0]
                        except ValueError:
                            refs.append(dict(address=hex(target), fileBacked=False))
                            continue
                        if math.isfinite(value):
                            refs.append(dict(address=hex(target), float32=value))
                            constants.append(value)
                suffix = ' ; ' + json.dumps(refs) if refs else ''
                lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}{suffix}')
            listing = args.out / (name + '-current.txt')
            listing.write_text('\n'.join(lines) + '\n')
            records[name] = dict(address=hex(start), bytes=size,
                                 codeSha256=hashlib.sha256(raw).hexdigest(),
                                 listingSha256=digest(listing), instructions=len(decoded),
                                 constantValues=sorted(set(constants)))
            instructions[name] = decoded

    def calls(name, target):
        return [i.address for i in instructions[name] if i.mnemonic in ('call', 'jmp')
                and i.operands and i.operands[0].type == CS_OP_IMM
                and i.operands[0].imm == target]

    def flag_reads(name, mask):
        return [i.address for i in instructions[name] if i.mnemonic in ('test', 'and')
                and any(o.type == CS_OP_MEM and o.mem.disp == 0x668 for o in i.operands)
                and any(o.type == CS_OP_IMM and o.imm == mask for o in i.operands)]

    checks = {
        'duckCallsFinishDuck': bool(calls('duck', RANGES['finish-duck'][0])),
        'duckCallsFinishUnduck': bool(calls('duck', RANGES['finish-unduck'][0])),
        'duckCallsCanUnduck': bool(calls('duck', RANGES['can-unduck'][0])),
        'duckContainsThreeQuarterThreshold': .75 in records['duck']['constantValues'],
        'finishDuckCallsSetFlags': bool(calls('finish-duck', RANGES['set-flags'][0])),
        'finishUnduckCallsClearFlags': bool(calls('finish-unduck', RANGES['clear-flags'][0])),
        'duckContainsDirectForcedSet': bool(calls('duck', RANGES['set-flags'][0])),
        'duckContainsDirectThresholdClear': bool(calls('duck', RANGES['clear-flags'][0])),
        'accuracyUpdateTestsDuckFlag': bool(flag_reads('accuracy-update', 2)),
        'recoveryLoadsFlags': any(i.mnemonic == 'mov' and i.op_str == 'edx, dword ptr [rbx + 0x668]'
                                 for i in instructions['accuracy-recovery']),
        'recoveryTestsGroundFlag': any(i.mnemonic == 'test' and i.op_str == 'dl, 1'
                                      for i in instructions['accuracy-recovery']),
        'recoveryTestsDuckFlag': any(i.mnemonic == 'and' and i.op_str == 'edx, 2'
                                    for i in instructions['accuracy-recovery']),
        'getInaccuracyLoadsPenalty': any(i.mnemonic == 'movss' and
            any(o.type == CS_OP_MEM and o.mem.disp == 0x1260 for o in i.operands)
            for i in instructions['get-inaccuracy']),
    }
    instruction_assertions = 0
    for name, expected in EXACT.items():
        actual = {i.address: f'{i.mnemonic} {i.op_str}' for i in instructions[name]}
        for address, instruction in expected.items():
            assert actual.get(address) == instruction, (name, hex(address), actual.get(address))
            instruction_assertions += 1
    result = dict(serverSha256=SERVER_SHA, wholeArtifactHashRecomputed=True,
                  probeSha256=digest(Path(__file__)), ranges=records, checks=checks,
                  exactInstructionAssertions=instruction_assertions,
                  passed=all(checks.values()),
                  limit='Static byte anchors; control-flow interpretation requires the retained listing review. No invocation or native arithmetic was executed.')
    (args.out / 'current-byte-proof.json').write_text(json.dumps(result, indent=2) + '\n')
    if args.summary:
        summary = dict(serverSha256=SERVER_SHA, wholeArtifactHashRecomputed=True,
                       probeSha256=result['probeSha256'], checks=checks,
                       exactInstructionAssertions=instruction_assertions, passed=result['passed'],
                       bytes=sum(r['bytes'] for r in records.values()),
                       ranges={name: {key: value for key, value in record.items()
                                      if key in ['bytes', 'codeSha256', 'listingSha256', 'instructions']}
                               for name, record in records.items()}, limit=result['limit'])
        args.summary.parent.mkdir(parents=True, exist_ok=True)
        args.summary.write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps(dict(passed=result['passed'], bytes=sum(r['bytes'] for r in records.values()), checks=checks)))
    assert all(checks.values()), 'Inspect failed static anchor; do not infer a changed rule.'


if __name__ == '__main__':
    main()
