"""Follow the one explicit tier0 RandomFloat call to its integer RNG export.

Typed PLT relocation and exact-name export binding only; no code scan or native
execution. Also preserve RIP constants read by RandomFloat and the integer RNG.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

from _common import arguments
EXPECTED = 'a3d4f81bb46eeca0d1d0a60a0c3bb3661a6398888359d0121ac795c6bd40d5af'


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def main():
    args = arguments(__doc__)
    root, output = args.root, args.output
    sys.path.insert(0, str(root / 'native-audit/python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from elftools.elf.elffile import ELFFile
    from elftools.elf.relocation import RelocationSection
    prior_path = output / 'arithmetic/current-read.json'
    prior = json.loads(prior_path.read_text())
    assert prior['tier0Sha256'] == EXPECTED and prior['wholeArtifactHashesVerified']
    name = '_ZN24CUniformRandomStreamImplI16CThreadNullMutexE11RandomFloatEff'
    parent = next(r for r in prior['codeRanges'] if r['name'] == 'tier0-' + name)
    parent_code = (output / 'arithmetic' / (parent['name'] + '.bin')).read_bytes()
    assert hashlib.sha256(parent_code).hexdigest() == parent['codeSha256']
    path = root / 'cs2-game/game/bin/linuxsteamrt64/libtier0.so'
    assert sha(path) == EXPECTED
    out = output / 'rng'
    out.mkdir(parents=True, exist_ok=False)
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    cs.detail = True
    instructions = list(cs.disasm(parent_code, int(parent['address'], 16)))
    calls = [i.operands[0].imm for i in instructions
             if i.mnemonic == 'call' and i.operands[0].type == 2]
    assert calls == [0x12ae60]
    ranges, data = [], []
    read_bytes = 0
    with path.open('rb') as stream:
        elf = ELFFile(stream)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                    for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(address, size):
            nonlocal read_bytes
            assert 0 < size <= 4096
            read_bytes += size
            assert read_bytes <= 16384
            va, offset, length = next(s for s in segments if s[0] <= address and address + size <= s[0] + s[2])
            stream.seek(offset + address - va)
            raw = stream.read(size)
            assert len(raw) == size
            return raw

        def listing(label, address, size):
            raw = read(address, size)
            rows = list(cs.disasm(raw, address))
            text = '\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in rows) + '\n'
            (out / (label + '.txt')).write_text(text)
            (out / (label + '.bin')).write_bytes(raw)
            ranges.append({'name': label, 'address': hex(address), 'bytes': size,
                           'codeSha256': hashlib.sha256(raw).hexdigest(),
                           'listingSha256': hashlib.sha256(text.encode()).hexdigest()})
            return rows

        stub = listing('integer-rng-plt', calls[0], 16)
        jump = next(i for i in stub if i.mnemonic == 'jmp' and i.operands[0].type == 3)
        assert cs.reg_name(jump.operands[0].mem.base) == 'rip'
        slot = jump.address + jump.size + jump.operands[0].mem.disp
        matches = []
        section = elf.get_section_by_name('.rela.plt')
        assert isinstance(section, RelocationSection) and section['sh_size'] <= 1024 * 1024
        symbols = elf.get_section(section['sh_link'])
        for reloc in section.iter_relocations():
            if reloc['r_offset'] == slot:
                matches.append(symbols.get_symbol(reloc['r_info_sym']).name)
        assert len(matches) == 1
        name = matches[0]
        assert 'CUniformRandomStreamImplI16CThreadNullMutexE' in name and 'GenerateRandomNumber' in name
        symbols = elf.get_section_by_name('.dynsym')
        bound = [s for s in symbols.iter_symbols() if s.name == name and s['st_shndx'] != 'SHN_UNDEF']
        assert len(bound) == 1
        symbol = bound[0]
        assert 0 < symbol['st_size'] <= 4096
        helper = listing('integer-rng', symbol['st_value'], symbol['st_size'])
        nested = [i.op_str for i in helper if i.mnemonic == 'call']
        constants = sorted({i.address + i.size + op.mem.disp for i in instructions + helper
                            for op in i.operands if op.type == 3 and cs.reg_name(op.mem.base) == 'rip'})
        for address in constants:
            raw = read(address, 16)
            data.append({'address': hex(address), 'hex': raw.hex(),
                         'firstFloat32': struct.unpack('<f', raw[:4])[0],
                         'sha256': hashlib.sha256(raw).hexdigest()})
    report = {'tier0Sha256': EXPECTED, 'wholeArtifactHashVerified': True,
              'priorReadSha256': sha(prior_path), 'readerSha256': sha(Path(__file__)),
              'method': __doc__, 'ranges': ranges, 'data': data, 'selectedBytes': read_bytes,
              'binding': {'parentSymbol': parent['name'][6:], 'plt': hex(calls[0]), 'got': hex(slot),
                          'targetSymbol': name, 'target': hex(symbol['st_value'])},
              'nestedCalls': nested, 'limits': ['No native invocation. Any nested calls must be resolved before emulation.']}
    (out / 'current-read.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'tier0Sha256': EXPECTED, 'symbol': name, 'selectedBytes': read_bytes,
                      'nestedCalls': nested, 'ranges': len(ranges), 'constants': len(data)}))


if __name__ == '__main__':
    main()
