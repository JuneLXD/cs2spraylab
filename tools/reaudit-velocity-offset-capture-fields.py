"""Numeric offset-producer fields for the parent-owned current-hash sampler.

No process opens, memory writes, polling, or native calls. Caller must check the
client hash and repeat all returned guards after its complete row. An internally
stable row still cannot associate a cached offset with its setter invocation.
"""
import json
import math
import struct

CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'


def read_velocity_offset_fields(read, base, player, node=None):
    guards = []

    def take(address, length):
        if not (0 < address < 2**63 and 0 < length <= 64):
            raise ValueError('Invalid velocity offset field range')
        raw = read(address, length)
        if len(raw) != length:
            raise ValueError('Short velocity offset field read')
        guards.append((address, raw.hex()))
        return raw

    def q(address):
        return struct.unpack('<Q', take(address, 8))[0]

    def finite(value):
        if not math.isfinite(value):
            raise ValueError('Nonfinite velocity offset field')
        return value

    table = q(player)
    pawn_bound = table == base + 0x4500730
    count_bound = bool(table) and q(table + 0x3e8) == base + 0x183d500
    group = take(player + 0x3e8, 17)
    state = take(player + 0x620, 48)
    offset0, count0, offset1, count1 = struct.unpack_from('<fifi', group)
    cache_times = [finite(v) for v in struct.unpack_from('<2f', state)]
    flags = list(state[0x18:0x1c])
    time_class = (flags[2] >> 3) & 7
    if time_class & 4:
        time_class -= 8
    storage = struct.unpack_from('<Q', state, 0x28)[0]
    history_bound = struct.unpack_from('<Q', state, 8)[0] == base + 0x44e06d0
    render_type = struct.unpack('<i', take(player + 0x450, 4))[0]
    fields = {
        'velocityOffsetPawnClassBound': pawn_bound,
        'velocityOffsetCountProviderConstantOne': count_bound,
        'velocityOffsetHistoryClassBound': history_bound,
        'velocityOffsetTimeClass': time_class,
        'velocityOffsetGroupDirty': bool(group[16]),
        'velocityOffsetGroupPairs': [
            {'ring': 0, 'offset': finite(offset0), 'count': count0},
            {'ring': 1, 'offset': finite(offset1), 'count': count1},
        ],
        'velocityOffsetCacheTimes': cache_times,
        'velocityOffsetHistoryFlags': flags,
        'velocityOffsetCacheDirtyMask': flags[1] >> 6,
        'velocityOffsetEntityRenderTimeType': render_type,
        'velocityOffsetRings': [],
        'velocityOffsetSetterInvocationAssociated': False,
        'velocityOffsetEngineGateResult': None,
        'velocityOffsetLocalPawnLookupResult': None,
        'velocityOffsetEffectiveLocalTickInterval': None,
    }
    if storage:
        header = take(storage, 64 if flags[0] & 0x20 else 32)
        for ring in range(len(header) // 32):
            companion, offset = struct.unpack_from('<if', header, ring * 32 + 0x14)
            fields['velocityOffsetRings'].append(
                {'ring': ring, 'offset': finite(offset), 'count': companion})
    globals_ = q(base + 0x467be58)
    fields['velocityOffsetGlobalClientCountGate'] = (
        struct.unpack('<i', take(globals_ + 0x10, 4))[0] if globals_ else None)
    controls = []
    for relative in (0x48fc4f8, 0x48fc4e8, 0x48fc4d8):
        control = q(base + relative)
        controls.append(finite(struct.unpack('<f', take(control + 0x58, 4))[0]) if control else None)
    fields['velocityOffsetNetworkClampInputs'] = dict(zip(('value', 'minimum', 'maximum'), controls))
    switch = q(base + 0x4925388)
    fields['velocityOffsetSingleClientFallbackSwitch'] = bool(take(switch + 0x58, 1)[0]) if switch else None
    fields['velocityOffsetValid'] = pawn_bound and history_bound and count_bound and time_class == 1 and bool(storage)
    # Read again inside this helper; parent repeats these same blocks after its
    # complete row to cover mutations while the remaining readers are running.
    for address, expected in guards:
        actual = read(address, len(expected) // 2)
        if actual.hex() != expected:
            raise ValueError('Velocity offset producer fields changed during read')
    return {'fields': fields, 'guardBlocks': guards}


def self_test():
    """Synthetic decoder/guard checks, no live memory or native execution."""
    memory, reads = {}, []
    base, pawn, ring, globals_ = 0x10000000, 0x20000000, 0x21000000, 0x22000000

    def put(address, raw):
        memory.update((address + i, value) for i, value in enumerate(raw))

    def q(address, value):
        put(address, struct.pack('<Q', value))

    def read(address, length):
        reads.append((address, length))
        return bytes(memory[address + i] for i in range(length))

    q(pawn, base + 0x4500730)
    q(base + 0x4500730 + 0x3e8, base + 0x183d500)
    put(pawn + 0x3e8, struct.pack('<fifiB', 1/64, 1, 1/64, 1, 0))
    put(pawn + 0x620, bytes(48))
    put(pawn + 0x620, struct.pack('<2f', -1, 12.5))
    q(pawn + 0x628, base + 0x44e06d0)
    put(pawn + 0x638, bytes([0xe0, 0x81, 0xc8, 0xfc]))
    q(pawn + 0x648, ring)
    put(pawn + 0x450, struct.pack('<i', 1))
    put(ring, bytes(64))
    for n in range(2):
        put(ring + n*32 + 0x14, struct.pack('<if', 1, 1/64))
    q(base + 0x467be58, globals_)
    put(globals_ + 0x10, struct.pack('<i', 64))
    for n, (location, value) in enumerate(zip((0x48fc4f8, 0x48fc4e8, 0x48fc4d8), (1., 1., 2.))):
        address = 0x23000000 + n*0x100
        q(base + location, address)
        put(address + 0x58, struct.pack('<f', value))
    q(base + 0x4925388, 0x24000000)
    put(0x24000000 + 0x58, b'\x01')
    assertions = 0

    def expect(value, expected):
        nonlocal assertions
        assert value == expected, (value, expected)
        assertions += 1

    def capture(reader=read):
        return read_velocity_offset_fields(reader, base, pawn)

    row = capture()
    f = row['fields']
    expect(f['velocityOffsetValid'], True)
    expect(f['velocityOffsetTimeClass'], 1)
    expect(f['velocityOffsetGroupPairs'], [{'ring': 0, 'offset': 1/64, 'count': 1}, {'ring': 1, 'offset': 1/64, 'count': 1}])
    expect(f['velocityOffsetRings'], f['velocityOffsetGroupPairs'])
    expect(f['velocityOffsetCacheTimes'], [-1., 12.5])
    expect(f['velocityOffsetCacheDirtyMask'], 2)
    expect(f['velocityOffsetEntityRenderTimeType'], 1)
    expect(f['velocityOffsetGlobalClientCountGate'], 64)
    expect(f['velocityOffsetNetworkClampInputs'], {'value': 1., 'minimum': 1., 'maximum': 2.})
    expect(f['velocityOffsetSingleClientFallbackSwitch'], True)
    expect(f['velocityOffsetEngineGateResult'], None)
    expect(f['velocityOffsetEffectiveLocalTickInterval'], None)
    expect(f['velocityOffsetSetterInvocationAssociated'], False)
    expect(all(read(address, len(raw)//2).hex() == raw for address, raw in row['guardBlocks']), True)
    json.dumps(row)
    put(pawn + 0x638, bytes([0xc0, 0xc1, 0xc8, 0xfc]))
    expect(len(capture()['fields']['velocityOffsetRings']), 1)
    expect(capture()['fields']['velocityOffsetCacheDirtyMask'], 3)
    put(pawn + 0x3f8, b'\x01')
    expect(capture()['fields']['velocityOffsetGroupDirty'], True)
    q(base + 0x4500730 + 0x3e8, base + 0x183d510)
    expect(capture()['fields']['velocityOffsetValid'], False)
    q(base + 0x4500730 + 0x3e8, base + 0x183d500)
    q(base + 0x48fc4f8, 0)
    expect(capture()['fields']['velocityOffsetNetworkClampInputs']['value'], None)
    q(base + 0x48fc4f8, 0x23000000)
    put(ring + 0x18, struct.pack('<f', float('nan')))
    try:
        capture()
        raise AssertionError('Nonfinite offset accepted')
    except ValueError:
        assertions += 1
    put(ring + 0x18, struct.pack('<f', 1/64))
    seen = set()

    def changed(address, length):
        value = read(address, length)
        key = (address, length)
        if key in seen and address == pawn + 0x3e8:
            return bytes([value[0] ^ 1]) + value[1:]
        seen.add(key)
        return value

    try:
        capture(changed)
        raise AssertionError('Changing producer fields accepted')
    except ValueError:
        assertions += 1
    try:
        capture(lambda address, length: read(address, length)[:-1])
        raise AssertionError('Short read accepted')
    except ValueError:
        assertions += 1
    expect(max(length for _, length in reads), 64)
    return {'clientSha256': CLIENT_SHA256, 'syntheticAssertions': assertions,
            'maxReadBytes': max(length for _, length in reads), 'nativeExecution': False}


if __name__ == '__main__':
    print(json.dumps(self_test()))
