"""Bounded read-only input/presented-frame history decoder.

The parent must bind both installed module hashes and read only its owned game.
No target is opened or launched here. Guards are repeated internally; the parent
must repeat this whole reader after its other row fields. Stable polling is not
an atomic snapshot, a callback trace, or proof of physical scanout.
"""
import math
import struct

CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
ENGINE_SHA256 = 'f5745c46cb38b1d120c3c7c5f0f19590f46c3d1bd136ee527b276cce8bfaba14'


def read_frame_history_fields(read, base, engine_base, player=None):
    guards = []

    def take(address, size):
        if not 0 < address < 2**63:
            raise ValueError('frame history address unavailable')
        assert 0 < size <= 3072
        raw = read(address, size)
        if len(raw) != size:
            raise OSError('short frame history read')
        guards.append((address, raw.hex()))
        return raw

    def q(address):
        return struct.unpack('<Q', take(address, 8))[0]

    def pair(raw, offset):
        tick, fraction = struct.unpack_from('<if', raw, offset)
        if not math.isfinite(fraction):
            raise ValueError('nonfinite frame history pair')
        return dict(tick=tick, fraction=fraction)

    cursor = struct.unpack('<i', take(engine_base + 0xa01a50, 4))[0]
    # Publisher marks the cursor busy by adding ten before updating its next
    # slot. Reject that state rather than silently reading the previous slot.
    if not 0 <= cursor < 10:
        raise ValueError('presented history publication in progress')
    ring = take(engine_base + 0xa01a60, 400)
    presented = []
    for index in range(10):
        record = ring[index * 40:(index + 1) * 40]
        stamp = struct.unpack_from('<d', record, 32)[0]
        if not math.isfinite(stamp):
            raise ValueError('nonfinite presented timestamp')
        presented.append(dict(slot=index, frame=struct.unpack_from('<i', record)[0],
                              render=pair(record, 4), player=pair(record, 12),
                              publicationTime=stamp,
                              auxiliaryPresent=bool(struct.unpack_from('<Q', record, 24)[0])))

    input_address = base + 0x494a060
    if q(input_address) != base + 0x4513600:
        raise ValueError('input object class changed')
    header = take(input_address + 0xbbc, 48)
    primary, secondary, count = struct.unpack_from('<3i', header, 4)
    values = struct.unpack_from('<Q', header, 20)[0]
    capacity = struct.unpack_from('<i', header, 28)[0]
    if not 0 <= count <= capacity or count > 32 or capacity > 4096:
        raise ValueError('input history outside bounded count/capacity')
    if count and not values:
        raise ValueError('input history storage unavailable')
    records = take(values, count * 96) if count else b''
    entries = []
    for index in range(count):
        record = records[index * 96:(index + 1) * 96]
        entries.append(dict(index=index, render=pair(record, 0), player=pair(record, 8),
                            frame=struct.unpack_from('<i', record, 80)[0]))
    prediction = q(base + 0x467cb20)
    if prediction != base + 0x4934440:
        raise ValueError('prediction instance changed')
    prediction_tick = struct.unpack('<i', take(prediction + 0x10c, 4))[0]
    gp = q(base + 0x467be58)
    clock = take(gp + 0x30, 24)
    current, delta = struct.unpack_from('<2f', clock)
    fraction = struct.unpack_from('<f', clock, 12)[0]
    tick = struct.unpack_from('<i', clock, 20)[0]
    if not all(math.isfinite(v) for v in (current, delta, fraction)):
        raise ValueError('nonfinite sampled prediction clock')
    fields = dict(presentedSlot=cursor, presented=presented, inputCount=count,
                  inputReadDisabled=bool(header[1]),
                  primaryAttackIndex=primary, secondaryAttackIndex=secondary,
                  primaryAttackIndexValid=0 <= primary < count,
                  secondaryAttackIndexValid=0 <= secondary < count,
                  latestPrimaryTransitionDown=bool(header[2]),
                  latestSecondaryTransitionDown=bool(header[3]),
                  processedTransitionCount=struct.unpack_from('<i', header, 36)[0],
                  lastInputFrame=struct.unpack_from('<i', header, 40)[0],
                  lastPrimaryFrame=struct.unpack_from('<i', header, 44)[0],
                  inputEntries=entries, sampledPredictionTick=prediction_tick,
                  sampledGlobalTick=tick, sampledGlobalCurrentTime=current,
                  sampledGlobalFrameDelta=delta, sampledGlobalFraction=fraction)
    if player is not None:
        camera = q(player + 0x12b0)
        if not camera or q(camera) != base + 0x44bcb30 or q(camera + 0x38) != player:
            raise ValueError('camera service class or owner changed')
        raw = take(camera + 0x48, 20)
        angle = list(struct.unpack_from('<3f', raw))
        if not all(math.isfinite(v) for v in angle):
            raise ValueError('nonfinite camera punch')
        fields.update(cameraStoredPunch=angle, cameraAnchor=pair(raw, 12))
    for address, expected in guards:
        if read(address, len(expected) // 2).hex() != expected:
            raise ValueError('frame history changed during read')
    return dict(fields=fields, guardBlocks=guards)


def self_test():
    memory, reads = {}, []
    base, engine, globals_, values = 0x10000000, 0x20000000, 0x30000000, 0x40000000
    input_address = base + 0x494a060

    def put(a, raw):
        memory.update((a+i, value) for i, value in enumerate(raw))

    def read(a, n):
        reads.append((a, n))
        return bytes(memory[a+i] for i in range(n))

    def integer(a, value): put(a, struct.pack('<i', value))
    def pointer(a, value): put(a, struct.pack('<Q', value))

    integer(engine + 0xa01a50, 9)
    put(engine + 0xa01a60, bytes(400))
    for i in range(10):
        put(engine + 0xa01a60 + i*40, struct.pack('<iififIQd', 100+i, 300+i, .25, 400+i, .75, 0, 0, 1+i/60))
    pointer(input_address, base + 0x4513600)
    put(input_address + 0xbbc, bytes(48))
    put(input_address + 0xbc0, struct.pack('<3i', 0, -1, 2))
    pointer(input_address + 0xbd0, values)
    integer(input_address + 0xbd8, 2)
    put(values, bytes(192))
    for i in range(2):
        put(values + i*96, struct.pack('<ifif', 308+i, .25, 408+i, .75))
        integer(values + i*96 + 80, 108+i)
    pointer(base + 0x467cb20, base + 0x4934440)
    integer(base + 0x4934440 + 0x10c, 411)
    pointer(base + 0x467be58, globals_)
    put(globals_ + 0x30, struct.pack('<5fi', 6.5, 1/64, 0, .125, 0, 416))
    assertions = 0

    def expect(a, b):
        nonlocal assertions
        assert a == b, (a, b)
        assertions += 1

    def capture(reader=read): return read_frame_history_fields(reader, base, engine)['fields']
    f = capture()
    expect(f['presentedSlot'], 9)
    expect(f['presented'][9]['frame'], 109)
    expect(f['presented'][9]['player'], {'tick': 409, 'fraction': .75})
    expect(f['inputEntries'][0]['render'], {'tick': 308, 'fraction': .25})
    expect(f['inputEntries'][1]['frame'], 109)
    expect(f['primaryAttackIndexValid'], True)
    expect(f['secondaryAttackIndexValid'], False)
    expect(f['sampledPredictionTick'], 411)
    expect(f['sampledGlobalTick'], 416)
    expect(f['sampledGlobalFraction'], .125)

    def rejected(change, restore, message):
        change()
        try:
            capture()
            raise AssertionError('invalid fixture accepted')
        except ValueError as error:
            expect(message in str(error), True)
        finally: restore()

    rejected(lambda: integer(engine + 0xa01a50, 19), lambda: integer(engine + 0xa01a50, 9), 'publication')
    rejected(lambda: pointer(input_address, base + 1), lambda: pointer(input_address, base + 0x4513600), 'class')
    rejected(lambda: integer(input_address + 0xbc8, 33), lambda: integer(input_address + 0xbc8, 2), 'bounded')
    rejected(lambda: integer(input_address + 0xbd8, 1), lambda: integer(input_address + 0xbd8, 2), 'bounded')
    rejected(lambda: pointer(input_address + 0xbd0, 0), lambda: pointer(input_address + 0xbd0, values), 'storage')
    rejected(lambda: pointer(base + 0x467cb20, 0), lambda: pointer(base + 0x467cb20, base + 0x4934440), 'instance')
    rejected(lambda: put(values+4, struct.pack('<f', float('nan'))), lambda: put(values+4, struct.pack('<f', .25)), 'nonfinite')
    integer(input_address + 0xbc8, 0)
    pointer(input_address + 0xbd0, 0)
    expect(capture()['inputEntries'], [])
    integer(input_address + 0xbc8, 2)
    pointer(input_address + 0xbd0, values)
    seen = 0

    def racing(a, n):
        nonlocal seen
        raw = read(a, n)
        if a == values:
            seen += 1
            if seen == 2: raw = bytes([raw[0] ^ 1]) + raw[1:]
        return raw

    try:
        capture(racing)
        raise AssertionError('racing fixture accepted')
    except ValueError as error:
        expect('changed during read' in str(error), True)
    expect(max(n for _, n in reads), 400)
    player, camera = 0x50000000, 0x50010000
    pointer(player + 0x12b0, camera)
    pointer(camera, base + 0x44bcb30)
    pointer(camera + 0x38, player)
    put(camera + 0x48, struct.pack('<3fif', -1, .5, 0, 410, .25))
    f = read_frame_history_fields(read, base, engine, player)['fields']
    expect(f['cameraStoredPunch'], [-1, .5, 0])
    expect(f['cameraAnchor'], {'tick': 410, 'fraction': .25})
    pointer(camera + 0x38, player + 1)
    try:
        read_frame_history_fields(read, base, engine, player)
        raise AssertionError('wrong camera owner accepted')
    except ValueError as error:
        expect('owner changed' in str(error), True)
    return dict(syntheticDecoderAssertions=assertions, maximumReadBytes=max(n for _, n in reads),
                provenance='Synthetic decoder and rejection fixtures; no live validation.')


if __name__ == '__main__':
    import json
    print(json.dumps(self_test()))
