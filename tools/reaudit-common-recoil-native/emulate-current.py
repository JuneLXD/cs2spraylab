"""Execute only the current recoil arithmetic and bound tier0 RNG in Unicorn.

Entry is after successful resource lookup. Supply seven hash-bound native KV3
parameter sets in private memory; run both mode loops unchanged. Real selected
PLT instructions read private GOT slots bound to current tier0 code. No numeric
RNG/table call is stubbed, no OS/game/library is loaded, no cache allocator runs.
"""
import hashlib
import json
import math
import struct
import sys
from pathlib import Path

from _common import arguments
SERVER_HASH = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
TIER_HASH = 'a3d4f81bb46eeca0d1d0a60a0c3bb3661a6398888359d0121ac795c6bd40d5af'
ENTRY, END = 0x1456417, 0x145665f
HEAP, FRAME, RNG_OBJECT, RETURN = 0x6000000, 0x6018000, 0x6020000, 0x602f000
DEFINITION, OUTPUT = HEAP, HEAP + 0x2000
WEAPONS = ('ak47', 'm4a4', 'm4a1s', 'awp', 'glock', 'usp', 'deagle')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            h.update(block)
    return h.hexdigest()


def bits(value):
    return struct.unpack('<I', struct.pack('<f', value))[0]


def main():
    args = arguments(__doc__)
    root, output = args.root, args.output
    target = output / 'native-tables.json'
    assert not target.exists(), 'Refuse to overwrite retained native tables'
    sys.path.insert(0, str(root / 'native-audit/python'))
    from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE, UC_HOOK_MEM_READ, UC_HOOK_MEM_WRITE, UC_MEM_WRITE
    from unicorn.x86_const import (UC_X86_REG_RSP, UC_X86_REG_RBP, UC_X86_REG_RBX, UC_X86_REG_R12,
        UC_X86_REG_R13, UC_X86_REG_RDI, UC_X86_REG_ESI, UC_X86_REG_RIP,
        UC_X86_REG_XMM0, UC_X86_REG_XMM1, UC_X86_REG_MXCSR, UC_X86_REG_EFLAGS)
    assert sha(root / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so') == SERVER_HASH
    assert sha(root / 'cs2-game/game/bin/linuxsteamrt64/libtier0.so') == TIER_HASH
    arithmetic_path, rng_path = output / 'arithmetic/current-read.json', output / 'rng/current-read.json'
    arithmetic, rng = json.loads(arithmetic_path.read_text()), json.loads(rng_path.read_text())
    assert arithmetic['serverSha256'] == SERVER_HASH and arithmetic['tier0Sha256'] == TIER_HASH
    assert rng['tier0Sha256'] == TIER_HASH and rng['priorReadSha256'] == sha(arithmetic_path)
    assert not rng['nestedCalls']
    source_inputs = output / 'native-inputs.json'
    inputs = json.loads(source_inputs.read_text())
    assert inputs['decodedSha256'] == '46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b'
    assert set(inputs['weapons']) == set(WEAPONS)
    assert inputs['readerSha256'] == sha(Path(__file__).with_name('read-inputs.mjs'))
    u = Uc(UC_ARCH_X86, UC_MODE_64)
    pages, execute_ranges, readable, writable = set(), [], [], []
    native_ranges = []

    def put(address, raw, execute=False, write=False):
        for page in range(address & ~4095, (address + len(raw) + 4095) & ~4095, 4096):
            if page not in pages:
                u.mem_map(page, 4096)
                pages.add(page)
        u.mem_write(address, raw)
        readable.append((address, address + len(raw)))
        if write:
            writable.append((address, address + len(raw)))
        if execute:
            execute_ranges.append((address, address + len(raw)))

    def code(directory, record):
        raw = (directory / (record['name'] + '.bin')).read_bytes()
        assert len(raw) == record['bytes'] and hashlib.sha256(raw).hexdigest() == record['codeSha256']
        address = int(record['address'], 16)
        put(address, raw, execute=True)
        native_ranges.append(record)

    by_symbol = {b['symbol']: b for b in arithmetic['rngBindings']}
    constructor_name = '_ZN24CUniformRandomStreamImplI16CThreadNullMutexEC1Ei'
    float_name = '_ZN24CUniformRandomStreamImplI16CThreadNullMutexE11RandomFloatEff'
    assert set(by_symbol) == {constructor_name, float_name}
    ctor, floating = (int(by_symbol[n]['address'], 16) for n in (constructor_name, float_name))
    needed_stubs = []
    for record in arithmetic['codeRanges']:
        if record['name'] == 'recoil-builder' or record['name'] in ['tier0-' + n for n in by_symbol]:
            code(output / 'arithmetic', record)
    for imp in arithmetic['imports']:
        if imp['symbol'] in by_symbol:
            address = int(imp['stub'], 16)
            record = next(r for r in arithmetic['codeRanges'] if int(r['address'], 16) == address)
            code(output / 'arithmetic', record)
            put(int(imp['got'], 16), struct.pack('<Q', int(by_symbol[imp['symbol']]['address'], 16)))
            needed_stubs.append(imp)
    for record in rng['ranges']:
        code(output / 'rng', record)
    put(int(rng['binding']['got'], 16), struct.pack('<Q', int(rng['binding']['target'], 16)))
    for row in json.loads((output / 'arithmetic/builder-rip-data.json').read_text()) + rng['data']:
        raw = bytes.fromhex(row['hex'])
        assert hashlib.sha256(raw).hexdigest() == row['sha256']
        put(int(row['address'], 16), raw)
    # Host setup writes are not emulated accesses. Native code may only read
    # supplied fields, and only the two actual output tables are writable.
    put(DEFINITION, bytes(0x1000))
    readable.pop()
    readable.extend([(DEFINITION + 0x790, DEFINITION + 0x7b0),
                     (DEFINITION + 0x7d4, DEFINITION + 0x7d8),
                     (DEFINITION + 0x72d, DEFINITION + 0x72e)])
    put(OUTPUT, bytes(0x1000))
    readable.pop()
    readable.append((OUTPUT + 4, OUTPUT + 0x404))
    writable.append((OUTPUT + 4, OUTPUT + 0x404))
    put(FRAME - 0x4000, bytes(0x5000), write=True)
    put(RNG_OBJECT, bytes(0x88), write=True)
    put(RETURN, b'\xcc', execute=True)
    counts = {'constructor': 0, 'randomFloat': 0, 'integerRng': 0, 'instructions': 0}
    current_count, stop_at = 0, None
    integer_at = int(rng['binding']['target'], 16)

    def instruction(machine, address, size, _):
        nonlocal current_count
        current_count += 1
        counts['instructions'] += 1
        if address == stop_at:
            machine.emu_stop()
            return
        assert current_count <= 200000, 'Instruction budget exceeded'
        assert any(lo <= address and address + size <= hi for lo, hi in execute_ranges), hex(address)
        # Resource-resolution prefix and epilogue are not part of supplied-state replay.
        if 0x1456380 <= address < 0x14566d0:
            assert ENTRY <= address < END or 0x145667d <= address < 0x14566c1, hex(address)
        if address == ctor:
            counts['constructor'] += 1
        elif address == floating:
            counts['randomFloat'] += 1
        elif address == integer_at:
            counts['integerRng'] += 1

    def memory(machine, access, address, size, value, _):
        ranges = writable if access == UC_MEM_WRITE else readable
        assert any(lo <= address and address + size <= hi for lo, hi in ranges), (access, hex(address), size)

    u.hook_add(UC_HOOK_CODE, instruction)
    u.hook_add(UC_HOOK_MEM_READ | UC_HOOK_MEM_WRITE, memory)

    def execute(entry, end):
        nonlocal current_count, stop_at
        current_count, stop_at = 0, end
        u.reg_write(UC_X86_REG_MXCSR, 0x1f80)
        u.reg_write(UC_X86_REG_EFLAGS, 2)
        u.emu_start(entry, end, count=200000)
        assert u.reg_read(UC_X86_REG_RIP) == end, ('Unexpected exit', hex(u.reg_read(UC_X86_REG_RIP)))
        return current_count

    tables, alternate, invocation_counts = {}, {}, []
    for weapon in WEAPONS:
        values = inputs['weapons'][weapon]
        u.mem_write(DEFINITION, bytes(0x1000))
        u.mem_write(OUTPUT, b'\xa5' * 0x1000)
        u.mem_write(FRAME - 0x4000, bytes(0x5000))
        for offset, name in ((0x790, 'angle'), (0x798, 'variance'), (0x7a0, 'magnitude'), (0x7a8, 'magnitudeVariance')):
            pair = values[name]
            assert len(pair) == 2 and all(math.isfinite(x) for x in pair)
            u.mem_write(DEFINITION + offset, struct.pack('<ff', *pair))
        u.mem_write(DEFINITION + 0x7d4, struct.pack('<i', values['seed']))
        u.mem_write(DEFINITION + 0x72d, bytes([values['fullAuto']]))
        u.reg_write(UC_X86_REG_RSP, FRAME - 0x160)
        u.reg_write(UC_X86_REG_RBP, FRAME)
        u.reg_write(UC_X86_REG_RBX, FRAME - 0x140)
        u.reg_write(UC_X86_REG_R12, OUTPUT)
        u.reg_write(UC_X86_REG_R13, DEFINITION)
        prior_counts = counts.copy()
        n = execute(ENTRY, END)
        assert counts['constructor'] - prior_counts['constructor'] == 2
        assert counts['randomFloat'] - prior_counts['randomFloat'] == 256
        assert counts['integerRng'] - prior_counts['integerRng'] == 256
        assert bytes(u.mem_read(OUTPUT, 4)) == b'\xa5' * 4
        assert bytes(u.mem_read(OUTPUT + 0x404, 16)) == b'\xa5' * 16
        for mode, destination in ((0, tables), (1, alternate)):
            rows = []
            for index in range(64):
                angle, magnitude = struct.unpack('<ff', u.mem_read(OUTPUT + 4 + mode * 0x200 + index * 8, 8))
                assert math.isfinite(angle) and math.isfinite(magnitude)
                rows.append({'angle': angle, 'magnitude': magnitude})
            destination[weapon] = rows
        invocation_counts.append({'weapon': weapon, 'instructions': n, 'modes': 2, 'randomDraws': 256})
    table_counts = counts.copy()
    seeds = sorted(set([0, 1, -1, 223, -223, 2147483646, -2147483646, 2147483647,
                        -2147483647] + [w['seed'] for w in inputs['weapons'].values()]))
    random_values = {}

    def rng_call(entry, seed=None):
        u.mem_write(FRAME + 0x808, struct.pack('<Q', RETURN))
        u.reg_write(UC_X86_REG_RSP, FRAME + 0x808)
        u.reg_write(UC_X86_REG_RDI, RNG_OBJECT)
        if seed is not None:
            u.reg_write(UC_X86_REG_ESI, seed & 0xffffffff)
        u.reg_write(UC_X86_REG_XMM0, bits(-30.0))
        u.reg_write(UC_X86_REG_XMM1, bits(30.0))
        execute(entry, RETURN)
        return struct.unpack('<f', struct.pack('<I', u.reg_read(UC_X86_REG_XMM0) & 0xffffffff))[0]

    for seed in seeds:
        u.mem_write(RNG_OBJECT, bytes(0x1000))
        rng_call(ctor, seed)
        random_values[str(seed)] = [rng_call(floating) for _ in range(16)]
    report = {'method': __doc__, 'serverSha256': SERVER_HASH, 'tier0Sha256': TIER_HASH,
              'wholeArtifactHashesVerified': True, 'scriptSha256': sha(Path(__file__)),
              'arithmeticReadSha256': sha(arithmetic_path), 'rngReadSha256': sha(rng_path),
              'nativeInputsSha256': sha(source_inputs), 'inputs': inputs,
              'entry': hex(ENTRY), 'exit': hex(END), 'nativeRanges': native_ranges,
              'imports': needed_stubs, 'rngBinding': rng['binding'],
              'tableInvocationCounts': invocation_counts, 'tableExecutionCounts': table_counts,
              'totalExecutionCounts': counts, 'mappedPages': len(pages),
              'executionBoundary': {'instructionsPerInvocation': 200000,
                  'nativeParameterBytesReadable': 37, 'nativeParameterBytesWritable': 0,
                  'outputBytesReadableWritable': 1024, 'standaloneRngStateBytes': 136,
                  'privateStackBytes': 20480,
                  'unknownCodeOrMemoryAccess': 'raises assertion',
                  'numericCallSubstitutions': 0},
              'tables': tables, 'alternateTables': alternate,
              'rngValues': random_values, 'rngRange': {'low': -30, 'high': 30, 'count': 16},
              'limits': ['Supplied-state arithmetic after resource lookup, not full cache allocation or live resource-memory validation.',
                         'All arithmetic and RNG instructions execute unchanged; private GOT pointers implement the exact bound imports.',
                         'Parameter values come from the hash-bound retained native export; field mapping follows the current paired-load arithmetic and prior named-schema interpretation.',
                         'No per-command shot-seed generation, recoil-table selection, physical input, firing or presentation parity claim.',
                         'No production comparison has run in this script; root compares actual trainer source separately.']}
    target.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'output': str(target), 'weapons': len(tables), 'modes': 14,
                      'tableEntries': 896, 'tableExecutionCounts': table_counts,
                      'rngSeeds': len(seeds), 'rngValues': len(seeds) * 16, 'mappedPages': len(pages)}))


if __name__ == '__main__':
    main()
