"""Read-only optional fields for a future parent-owned, hash-checked CS2 capture.

No process opening, launch, input, writes, or timing loop lives in this helper.
The caller must retain its whole-snapshot double-read/coherence checks.
Bindings: reports/reaudit-scene-writer/findings.json.
"""
import struct

CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'


def read_scene_writer_fields(read, base, player, node):
    q = lambda address: struct.unpack('<Q', read(address, 8))[0]
    service = q(player + 0x12b8)
    if not service:
        return {'sceneWriterValid': False, 'sceneWriterReason': 'null movement service'}
    table = q(service) - base
    if table != 0x44bf148:
        return {'sceneWriterValid': False, 'sceneWriterReason': 'unbound movement-service class',
                'sceneWriterMovementVtableRelative': table}
    b = read(service + 0x310, 0xe0)
    f = lambda offset: struct.unpack_from('<f', b, offset)[0]
    i = lambda offset: struct.unpack_from('<i', b, offset)[0]
    p = lambda offset: struct.unpack_from('<Q', b, offset)[0]
    u = lambda offset: b[offset]
    vec = lambda offset: list(struct.unpack_from('<3f', b, offset))
    identity = q(player + 0x10)
    globals_pointer = q(base + 0x467be58)
    global_clock = read(globals_pointer + 0x44, 0x10) if globals_pointer else None
    return {
        'sceneWriterValid': p(8) == service and p(0x40) == player,
        'sceneWriterMovementService': service,
        'sceneWriterState': service + 0x310,
        'sceneWriterStateVtableRelative': p(0) - base,
        'sceneWriterStateServiceOwner': p(8),
        'sceneWriterCachedPawn': p(0x40),
        'sceneWriterActiveWeapon': p(0x48),
        'sceneWriterCurrentMoveType': u(0x10),
        'sceneWriterGroundState': u(0x11),
        'sceneWriterGroundActionDirection': u(0x12),
        'sceneWriterAirAction': u(0x13),
        'sceneWriterWasOnGround': u(0x14),
        'sceneWriterWasStationary': u(0x15),
        'sceneWriterActionStartTick': i(0x18),
        'sceneWriterStaticAimStartTick': i(0x1c),
        'sceneWriterPlantTurnStartTick': i(0x20),
        'sceneWriterTurnOnSpotAngle': f(0x24),
        'sceneWriterPreviousAimYaw': f(0x28),
        'sceneWriterPreviousHorizontalSpeed': f(0x2c),
        'sceneWriterTransientAirOverride': u(0x50),
        'sceneWriterCommandDirectionCode': u(0x51),
        'sceneWriterNormalizedCommandDirection': vec(0x54),
        'sceneWriterLocalVelocity': vec(0x60),
        'sceneWriterMovementDirection': vec(0x90),
        'sceneWriterMaxSpeed': f(0xa0),
        'sceneWriterHorizontalSpeed': f(0xa4),
        'sceneWriterDuckAmount': f(0xb0),
        'sceneWriterTurnRate': f(0xb8),
        'sceneWriterAimYaw': f(0xc4),
        'sceneWriterAimPitch': f(0xc8),
        'sceneWriterSignedAimBodyDifference': f(0xcc),
        'sceneWriterAbsoluteAimBodyDifference': f(0xd0),
        'sceneWriterAimYawChangeRate': f(0xd4),
        'sceneWriterProducedYaw': f(0xd8),
        'sceneWriterMovementInputs': list(struct.unpack('<3f', read(service + 0x1c0, 12))),
        'sceneWriterLastCommandNumberProcessed': struct.unpack('<i', read(service + 0x188, 4))[0],
        'sceneWriterContextSelector': struct.unpack('<i', read(identity + 0x38, 4))[0] if identity else None,
        # The context-zero tick helper can override this raw global tick. These
        # values alone do not establish its prediction context or call cadence.
        'sceneWriterRawGlobalTick': struct.unpack_from('<i', global_clock, 0)[0] if global_clock else None,
        'sceneWriterRawGlobalFraction': struct.unpack_from('<f', global_clock, 12)[0] if global_clock else None,
    }
