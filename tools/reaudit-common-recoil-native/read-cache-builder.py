"""Read the current recoil cache-miss builder and its actual RNG import bindings.

Static first stage only. No game/native invocation, OS import calls or code scan.
The builder location is derived from the retained current recoil lookup call.
ELF dynamic relocations/symbol tables bind its directly called import stubs.
Whole-artifact hashing is streamed; selected code/data reads have a 64 KiB cap.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

from _common import arguments
EXPECTED_SERVER = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
BUILDER = (0x1476d80, 0x3c0)
LOOKUP_CALL = (0x1477228, 8)


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    args = arguments(__doc__)
    args.out = args.output / 'current'
    sys.path.insert(0, str(args.root / 'native-audit/python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from elftools.elf.elffile import ELFFile
    from elftools.elf.relocation import RelocationSection
    server = args.root / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
    tier0 = args.root / 'cs2-game/game/bin/linuxsteamrt64/libtier0.so'
    assert sha(server) == EXPECTED_SERVER
    tier_hash = sha(tier0)
    assert tier_hash == 'a3d4f81bb46eeca0d1d0a60a0c3bb3661a6398888359d0121ac795c6bd40d5af'
    args.out.mkdir(parents=True, exist_ok=False)
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    cs.detail = True
    records, imports, bindings, metadata = [], [], [], []
    selected_bytes = 0

    def reader(stream, elf, label):
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                    for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(address, size):
            nonlocal selected_bytes
            assert 0 < size <= 4096
            va, offset, length = next(s for s in segments if s[0] <= address and address + size <= s[0] + s[2])
            selected_bytes += size
            assert selected_bytes <= 65536
            stream.seek(offset + address - va)
            raw = stream.read(size)
            assert len(raw) == size
            return raw

        def listing(name, address, size):
            raw = read(address, size)
            instructions = list(cs.disasm(raw, address))
            lines = []
            for ins in instructions:
                notes = []
                for op in ins.operands:
                    if op.type == 3 and cs.reg_name(op.mem.base) == 'rip':
                        notes.append('rip=' + hex(ins.address + ins.size + op.mem.disp))
                lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}' + (' ; ' + ', '.join(notes) if notes else ''))
            text = '\n'.join(lines) + '\n'
            (args.out / (name + '.txt')).write_text(text)
            (args.out / (name + '.bin')).write_bytes(raw)
            records.append({'name': name, 'artifact': label, 'address': hex(address), 'bytes': size,
                            'codeSha256': hashlib.sha256(raw).hexdigest(),
                            'listingSha256': hashlib.sha256(text.encode()).hexdigest()})
            return instructions
        return read, listing

    with server.open('rb') as stream:
        elf = ELFFile(stream)
        read, listing = reader(stream, elf, 'server')
        callsite = listing('lookup-builder-call', *LOOKUP_CALL)
        assert any(i.mnemonic == 'call' and i.operands[0].type == 2 and
                   i.operands[0].imm == BUILDER[0] for i in callsite)
        instructions = listing('recoil-builder', *BUILDER)
        plt_ranges = [(s['sh_addr'], s['sh_size']) for s in elf.iter_sections()
                      if s.name in ('.plt', '.plt.sec', '.plt.got')]
        direct = sorted({i.operands[0].imm for i in instructions
                         if i.mnemonic in ('call', 'jmp') and i.operands and i.operands[0].type == 2})
        wanted_slots = {}
        for target in direct:
            if not any(lo <= target < lo + size for lo, size in plt_ranges):
                continue
            stub = listing('server-import-' + format(target, 'x'), target, 16)
            for ins in stub:
                if ins.mnemonic == 'jmp' and ins.operands and ins.operands[0].type == 3:
                    op = ins.operands[0]
                    if cs.reg_name(op.mem.base) == 'rip':
                        wanted_slots[ins.address + ins.size + op.mem.disp] = target
                        break
        for section in elf.iter_sections():
            if not isinstance(section, RelocationSection) or section.name not in ('.rela.plt', '.rela.dyn'):
                continue
            assert section['sh_size'] <= 16 * 1024 * 1024
            symbols = elf.get_section(section['sh_link'])
            metadata.append({'artifact': 'server', 'section': section.name, 'bytes': section['sh_size'],
                             'method': 'Typed relocation traversal; only derived GOT slots retained.'})
            for reloc in section.iter_relocations():
                at = reloc['r_offset']
                if at not in wanted_slots:
                    continue
                symbol = symbols.get_symbol(reloc['r_info_sym'])
                imports.append({'stub': hex(wanted_slots[at]), 'got': hex(at), 'symbol': symbol.name,
                                'relocationType': reloc['r_info_type'], 'section': section.name})
        assert set(wanted_slots) == {int(row['got'], 16) for row in imports}
        constants = sorted({i.address + i.size + op.mem.disp for i in instructions for op in i.operands
                            if op.type == 3 and cs.reg_name(op.mem.base) == 'rip'})
        data = []
        for address in constants:
            raw = read(address, 16)
            data.append({'address': hex(address), 'hex': raw.hex(), 'firstFloat32': struct.unpack('<f', raw[:4])[0],
                         'sha256': hashlib.sha256(raw).hexdigest()})
        (args.out / 'builder-rip-data.json').write_text(json.dumps(data, indent=2) + '\n')
        non_import_calls = sorted({i.operands[0].imm for i in instructions
                                  if i.mnemonic == 'call' and i.operands and i.operands[0].type == 2 and
                                  not any(lo <= i.operands[0].imm < lo + n for lo, n in plt_ranges)})

    rng_names = {row['symbol'] for row in imports if any(token in row['symbol']
                 for token in ('UniformRandomStream', 'RandomFloat', 'RandomInt', 'RandomSeed'))}
    with tier0.open('rb') as stream:
        elf = ELFFile(stream)
        read, listing = reader(stream, elf, 'tier0')
        symbols = elf.get_section_by_name('.dynsym')
        assert symbols is not None and symbols['sh_size'] <= 4 * 1024 * 1024
        metadata.append({'artifact': 'tier0', 'section': '.dynsym', 'bytes': symbols['sh_size'],
                         'method': 'Exact-name lookup of directly bound RNG imports, not a code scan.'})
        for symbol in symbols.iter_symbols():
            if symbol.name not in rng_names or symbol['st_shndx'] == 'SHN_UNDEF':
                continue
            size = symbol['st_size']
            assert 0 < size <= 4096, (symbol.name, size)
            name = 'tier0-' + symbol.name
            listing(name, symbol['st_value'], size)
            bindings.append({'symbol': symbol.name, 'address': hex(symbol['st_value']), 'bytes': size})
    assert rng_names == {row['symbol'] for row in bindings}, (rng_names, bindings)
    report = {'serverSha256': EXPECTED_SERVER, 'tier0Sha256': tier_hash, 'wholeArtifactHashesVerified': True,
              'readerSha256': sha(Path(__file__)), 'method': __doc__, 'codeRanges': records,
              'imports': imports, 'rngBindings': bindings, 'selectedBytes': selected_bytes,
              'metadata': metadata, 'nonImportCallTargets': [hex(x) for x in non_import_calls],
              'limits': ['No native execution. Imported names identify selected external targets only.',
                         'Builder setup, helpers, data-field types and entry/exit boundaries must be reviewed before emulation.',
                         'No per-command shot-seed generator inference. No lookup-selector inference beyond retained cache-miss call.',
                         'No code discovery outside the explicit builder and directly derived import/export functions.']}
    (args.out / 'current-read.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'serverSha256': EXPECTED_SERVER, 'tier0Sha256': tier_hash,
                      'ranges': len(records), 'selectedBytes': selected_bytes,
                      'imports': [x['symbol'] for x in imports], 'rngBindings': [x['symbol'] for x in bindings]}))


if __name__ == '__main__':
    main()
