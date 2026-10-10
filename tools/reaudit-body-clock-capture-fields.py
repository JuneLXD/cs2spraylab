"""Prepared read-only body-clock inputs for the parent-owned hash-bound sampler.

No process launch/open/write or polling loop. The caller must verify the full
client hash, double-read every guardBlock after its entire row, and reject any
changed block. Stable polling still cannot identify an exact writer invocation
or associate a later controller tick with an earlier retained body result.
"""
import math
import struct

CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'


def read_body_clock_fields(read, base, player, node=None):
    guards = []

    def take(address, length):
        assert 0 < address < 2**63 and 0 < length <= 128
        raw = read(address, length)
        assert len(raw) == length
        guards.append((address, raw.hex()))
        return raw

    def q(address):
        return struct.unpack('<Q', take(address, 8))[0]

    def i(address):
        return struct.unpack('<i', take(address, 4))[0]

    def u(address):
        return struct.unpack('<I', take(address, 4))[0]

    fields = {}
    gp = q(base + 0x467be58)
    if not gp:
        return {'fields': {'bodyClockValid': False, 'bodyClockReason': 'globals unavailable'}, 'guardBlocks': guards}
    clock = take(gp + 0x30, 0x24)
    current, delta = struct.unpack_from('<2f', clock)
    raw_tick = struct.unpack_from('<i', clock, 0x14)[0]
    fraction = struct.unpack_from('<f', clock, 0x20)[0]
    identity = q(player + 0x10)
    context = i(identity + 0x38) if identity else None
    processing_pawn = q(base + 0x491f6f0)
    processing_controller = q(base + 0x46d1180)
    fields.update(bodyClockGlobalCurrentTime=current, bodyClockGlobalFrameDelta=delta,
                  bodyClockGlobalTick=raw_tick, bodyClockGlobalFraction=fraction,
                  bodyClockContext=context, bodyClockProcessingPawnMatches=processing_pawn == player,
                  bodyClockAnyProcessingPawn=bool(processing_pawn),
                  bodyClockAnyProcessingController=bool(processing_controller))
    rules = q(base + 0x4933170)
    paused_ticks = pause_start = 0
    paused = False
    converter_bound = True
    if rules and context == 0:
        table = q(rules)
        converter_bound = table == base + 0x446eea8 and q(table + 0x218) == base + 0x1954470
        raw = take(rules + 0x30, 9)
        paused_ticks, pause_start = struct.unpack_from('<2i', raw)
        paused = bool(raw[8])
    fields.update(bodyClockGameRulesPresent=bool(rules), bodyClockDefaultTickConverter=converter_bound,
                  bodyClockTotalPausedTicks=paused_ticks, bodyClockPauseStartTick=pause_start,
                  bodyClockGamePaused=paused)
    selected = raw_tick
    if context == 0 and rules and converter_bound:
        selected = min(selected, pause_start) if paused and pause_start > 0 else selected
        selected -= paused_ticks
    # Deliberately support only the normalized finite fraction branch. Other
    # inputs remain captured but do not receive a guessed normalization result.
    normalized = math.isfinite(fraction) and 0 <= fraction < 1
    fields['bodyClockSampledProviderTick'] = selected + int(fraction > 0) if context is not None and converter_bound and normalized else None
    fields['bodyClockSampledProviderFraction'] = fraction if normalized else None
    handle = u(player + 0x1444)
    fields['bodyClockControllerHandleValid'] = handle not in (0xffffffff, 0xfffffffe)
    controller = 0
    if fields['bodyClockControllerHandleValid']:
        table = q(base + 0x46b7100)
        if table:
            bucket = q(table + ((handle & 0xffff) >> 9 & 0x3f) * 8)
            if bucket:
                entry = bucket + (handle & 0x1ff) * 0x70
                identity_record = take(entry, 0x18)
                if struct.unpack_from('<I', identity_record, 0x10)[0] == handle:
                    controller = struct.unpack_from('<Q', identity_record)[0]
    controller_bound = bool(controller) and q(controller) == base + 0x44bd1c8
    fields.update(bodyClockControllerClassBound=controller_bound,
                  bodyClockProcessingControllerMatches=bool(controller) and controller == processing_controller)
    if controller_bound:
        tick_base = u(controller + 0x838)
        fields['bodyClockControllerTickBase'] = tick_base
        # This is a prospective ordinary command seed. Only a phase-associated
        # runtime observation can identify it as the retained body's writer tick.
        # In this explicitly bounded range every integer tick survives the
        # native float32 /64, *64, +.5, trunc sequence exactly.
        normal_tick = 0 <= tick_base < 2**23
        fields['bodyClockControllerTickBaseNormalRange'] = normal_tick
        candidate = tick_base
        if context == 0 and rules and converter_bound:
            candidate = min(candidate, pause_start) if paused and pause_start > 0 else candidate
            candidate -= paused_ticks
        fields['bodyClockControllerSeedCandidate'] = candidate if converter_bound and context is not None and normal_tick else None
    fields['bodyClockValid'] = context is not None and converter_bound and controller_bound and normalized and fields.get('bodyClockControllerTickBaseNormalRange', False)
    return {'fields': fields, 'guardBlocks': guards}


def self_test():
    """Synthetic decoder checks only; never reads a process."""
    memory, reads = {}, []
    base, player, identity = 0x10000000, 0x20000000, 0x20010000
    globals_, rules, controller = 0x20020000, 0x20030000, 0x20040000
    table, bucket = 0x20050000, 0x20060000
    handle, entry = 17, bucket+17*0x70
    def put(address, value):
        memory.update({address+n: b for n,b in enumerate(value)})
    def q(address, value): put(address, struct.pack('<Q', value))
    def i(address, value): put(address, struct.pack('<i', value))
    def read(address, length):
        reads.append((address, length))
        return bytes(memory[address+n] for n in range(length))
    q(base+0x467be58, globals_)
    put(globals_+0x30, bytes(0x24))
    put(globals_+0x30, struct.pack('<2f', 100/64, 1/64))
    i(globals_+0x44, 100)
    q(player+0x10, identity); i(identity+0x38, 0)
    q(base+0x491f6f0, player); q(base+0x46d1180, controller)
    q(base+0x4933170, rules); q(rules, base+0x446eea8)
    q(base+0x446eea8+0x218, base+0x1954470)
    put(rules+0x30, bytes(9))
    i(player+0x1444, handle)
    q(base+0x46b7100, table); q(table, bucket)
    put(entry, bytes(0x18)); q(entry, controller); i(entry+0x10, handle)
    q(controller, base+0x44bd1c8); i(controller+0x838, 101)
    assertions = 0
    def expect(actual, expected):
        nonlocal assertions
        assert actual == expected, (actual, expected)
        assertions += 1
    def capture(): return read_body_clock_fields(read, base, player)['fields']
    f = capture()
    expect(f['bodyClockValid'], True)
    expect(f['bodyClockSampledProviderTick'], 100)
    expect(f['bodyClockControllerSeedCandidate'], 101)
    expect(f['bodyClockProcessingPawnMatches'], True)
    expect(f['bodyClockProcessingControllerMatches'], True)
    put(rules+0x30, struct.pack('<iiB', 10, 95, 1))
    f = capture()
    expect(f['bodyClockSampledProviderTick'], 85)
    expect(f['bodyClockControllerSeedCandidate'], 85)
    put(rules+0x30, bytes(9)); put(globals_+0x50, struct.pack('<f', .5))
    expect(capture()['bodyClockSampledProviderTick'], 101)
    put(globals_+0x50, struct.pack('<f', 1))
    f = capture()
    expect(f['bodyClockValid'], False)
    expect(f['bodyClockSampledProviderTick'], None)
    put(globals_+0x50, bytes(4))
    q(base+0x446eea8+0x218, base+1)
    f = capture()
    expect(f['bodyClockValid'], False)
    expect(f['bodyClockSampledProviderTick'], None)
    expect(f['bodyClockControllerSeedCandidate'], None)
    q(base+0x446eea8+0x218, base+0x1954470)
    i(entry+0x10, handle+0x8000); reads.clear()
    f = capture()
    expect(f['bodyClockControllerClassBound'], False)
    expect(f['bodyClockValid'], False)
    expect((controller+0x838, 4) in reads, False)
    i(entry+0x10, handle); i(controller+0x838, 2**23)
    f = capture()
    expect(f['bodyClockControllerSeedCandidate'], None)
    expect(f['bodyClockValid'], False)
    expect(all(0<n<=128 for a,n in reads), True)
    return {'syntheticDecoderAssertions': assertions, 'maximumReadBytes': max(n for a,n in reads),
            'provenance': 'Private synthetic byte fixtures only; no live sampler validation.'}

if __name__ == '__main__':
    import json
    print(json.dumps(self_test()))
