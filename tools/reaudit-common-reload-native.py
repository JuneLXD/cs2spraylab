"""Bounded current-server proof of common-weapon manual reload admission.

Static reads only: no game, native execution, bridge or network. Run under
MemoryMax=512M, MemorySwapMax=0, CPUQuota=100%. Raw locations stay local.
The only search is an explicit 192 KiB weapon RTTI/vtable neighborhood,
derived from retained server weapon tables; no whole-ELF discovery scan.
Defaults resolve the sibling native-audit directory from this file, not cwd.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / 'native-audit'

EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
RANGES = {
    'common-input-dispatch': (0x14b3fd0, 0x2a0),
    'primary-dispatch': (0x14b0360, 0x590),
    'ordinary-gun-postframe': (0x14b4510, 0x24e),
    'manual-reload-dispatch': (0x14b3c90, 0x190),
    'primary-ready': (0x1641710, 0x90),
    'secondary-ready': (0x16417a0, 0x90),
    'input-active': (0x16412f0, 0xc0),
    'input-transition-wrapper': (0x17b85e0, 0x10),
    'input-transition-predicate': (0x1079c70, 0x78),
    'reload-quantity': (0x14986a0, 0xe0),
    'magazine-reload': (0x14aa280, 0x3d0),
    'burst-continuation': (0x14a8c10, 0x3d0),
    'current-time-pair': (0x17fd290, 0x50),
    'base-reload-entry': (0x14a6f10, 0x50),
    'reload-start': (0x14ad030, 0x1d0),
}
CLASS_NAMES = {
    'ak47': 'CAK47', 'm4a4': 'CWeaponM4A1', 'm4a1s': 'CWeaponM4A1Silencer',
    'awp': 'CWeaponAWP', 'glock': 'CWeaponGlock', 'usp': 'CWeaponUSPSilencer',
    'deagle': 'CDEagle',
}
# Retained server weapon table evidence lies in this explicit neighborhood.
TABLE_WINDOW = (0x25f0000, 0x30000)
SLOTS = [0xd30, 0xd40, 0xd48, 0xd50, 0xd58, 0xd60, 0xd68, 0xd88, 0xd90]


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native-root', type=Path, default=DEFAULT_ROOT)
    p.add_argument('--server', type=Path)
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    root = args.native_root.resolve()
    sys.path.insert(0, str(root / 'python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from elftools.elf.elffile import ELFFile
    args.out = args.out or root / 'reports/reaudit-common-reload-portable'
    binary = args.server or root.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
    assert sha(binary) == EXPECTED
    args.out.mkdir(parents=True, exist_ok=True)
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    cs.detail = True
    total_reads = 0
    with binary.open('rb') as stream:
        elf = ELFFile(stream)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                    for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(at, size):
            nonlocal total_reads
            assert 0 < size <= 0x30000
            start, offset, length = next(s for s in segments if s[0] <= at and at + size <= s[0] + s[2])
            total_reads += size
            assert total_reads < 4 * 1024 * 1024
            stream.seek(offset + at - start)
            raw = stream.read(size)
            assert len(raw) == size
            return raw

        def q(at):
            return struct.unpack('<Q', read(at, 8))[0]

        lo, length = TABLE_WINDOW
        raw = read(lo, length)
        words = struct.unpack('<' + 'Q' * (len(raw) // 8), raw)
        candidates = []
        classes = {}
        for i in range(len(words) - 1):
            rtti = words[i + 1]
            if words[i] or not lo <= rtti < lo + length - 16:
                continue
            try:
                encoded = read(q(rtti + 8), 80).split(b'\0')[0].decode('ascii')
            except (StopIteration, UnicodeDecodeError):
                continue
            match = re.fullmatch(r'(\d+)([A-Za-z][A-Za-z0-9_]*)', encoded)
            if not match or len(match[2]) != int(match[1]):
                continue
            name = match[2]
            table = lo + (i + 2) * 8
            candidates.append(dict(name=name, table=hex(table), rtti=hex(rtti)))
            if name not in CLASS_NAMES.values():
                continue
            assert name not in classes, (name, classes.get(name), hex(table))
            classes[name] = dict(table=hex(table), rtti=hex(rtti),
                                 slots={hex(slot): hex(q(table + slot)) for slot in SLOTS})
        (args.out / 'weapon-table-candidates.json').write_text(json.dumps(candidates, indent=2) + '\n')
        records = []
        for name, (address, size) in RANGES.items():
            code = read(address, size)
            lines = []
            for ins in cs.disasm(code, address):
                notes = []
                for operand in ins.operands:
                    if operand.type == 3 and cs.reg_name(operand.mem.base) == 'rip':
                        target = ins.address + ins.size + operand.mem.disp
                        notes.append('rip=' + hex(target))
                        if 'ss' in ins.mnemonic:
                            try:
                                notes.append('f32=' + repr(struct.unpack('<f', read(target, 4))[0]))
                            except StopIteration:
                                pass
                lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}' + (' ; ' + ', '.join(notes) if notes else ''))
            listing = '\n'.join(lines) + '\n'
            (args.out / (name + '.txt')).write_text(listing)
            records.append(dict(name=name, address=hex(address), size=size,
                                codeSha256=hashlib.sha256(code).hexdigest(),
                                listingSha256=hashlib.sha256(listing.encode()).hexdigest()))
    bindings = {weapon: classes.get(name) for weapon, name in CLASS_NAMES.items()}
    assert all(bindings.values()), bindings
    expected_slots = dict(zip(SLOTS, [0x14b2ef0, 0x14b4510, 0x14a68d0, 0x14445b0,
                                    0x1483c10, 0x14445d0, 0x1483c20, 0x14aa280, 0x14ad030]))
    for weapon, binding in bindings.items():
        assert binding['slots'] == {hex(k): hex(v) for k, v in expected_slots.items()}, weapon
    result = dict(serverSha256=EXPECTED, wholeArtifactHashVerified=True, scriptSha256=sha(Path(__file__)),
                  method=__doc__, tableSearch=dict(start=hex(lo), bytes=length,
                    sha256=hashlib.sha256(raw).hexdigest(), candidates=len(candidates),
                    negativeBoundary='No class-table inference outside this explicit window.'),
                  classes=bindings, missing=[w for w, value in bindings.items() if value is None],
                  virtualSlotAssertions=len(bindings) * len(expected_slots),
                  codeRanges=records, codeBytes=sum(n for _, n in RANGES.values()), bytesRead=total_reads,
                  limits=['Static current-byte evidence only; caller/input lifecycle is not executed.',
                          'Code regions are explicit derived ranges, not a call-graph completeness claim.'])
    (args.out / 'current-read.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(dict(output=str(args.out / 'current-read.json'), classes=list(bindings),
                          virtualSlotAssertions=result['virtualSlotAssertions'],
                          missing=result['missing'], codeBytes=result['codeBytes'], bytesRead=total_reads)))


if __name__ == '__main__':
    main()
