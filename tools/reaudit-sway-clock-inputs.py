"""Bounded current-client sway input reads, supplied by the approved sampler.

Importing this module does not open any process or binary. read_sway_fields
accepts the sampler's existing game-only read callback. Raw locations remain
in this local probe and its local output. Every individual read is <= 128 bytes.
Run this file directly for static current-hash layout verification only.
"""
import hashlib
import json
import struct
import sys
from pathlib import Path

CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
GLOBAL_PTR = 0x467be58
CONTROLLER_PTR = 0x4933170
PREDICTION_PTR = 0x467cb20
INTERPOLATION_CONTEXT = 0x46b8180
DEFAULT_TIME_CONVERTER = 0x19544f0


def read_sway_fields(read, base, player):
    """Return fields, raw local buffers and blocks the caller can double-read.

The caller must bind the target to CLIENT_SHA256 first, limit its lifetime and
handle read errors. No process handle, launch, memory write or retry is owned
here. guardBlocks must all still match after the complete sampler row is read.
Presence is reported separately from a zero numeric value; unknown branches
are retained, never silently replaced by a guessed clock.
"""
    guards = []

    def take(address, length):
        assert 0 < address < 2**63 and 0 < length <= 128
        raw = read(address, length)
        assert len(raw) == length
        guards.append((address, raw.hex()))
        return raw

    def pointer(address):
        return struct.unpack('<Q', take(address, 8))[0]

    def number(raw, offset=0, kind='f'):
        return struct.unpack_from('<' + kind, raw, offset)[0]

    def floats(raw, offset, count):
        return list(struct.unpack_from('<' + str(count) + 'f', raw, offset))

    globals_ptr = pointer(base + GLOBAL_PTR)
    controller_ptr = pointer(base + CONTROLLER_PTR)
    prediction_ptr = pointer(base + PREDICTION_PTR)
    identity_ptr = pointer(player + 0x10)
    context = take(base + INTERPOLATION_CONTEXT, 17)
    cache = take(player + 0x44a0, 0x60)
    interpolation_enabled = take(player + 0x4518, 1)[0]
    history = take(player + 0x4538, 0x4c)
    caller_gate = take(player + 0x6e1, 1)[0]
    getter_gate = take(player + 0x144d, 1)[0]
    fields = {
        'interpolationMode': number(context, 0, 'i'),
        'interpolationState': number(context, 4, 'i'),
        'interpolationTimes': floats(context, 8, 2),
        'interpolationHelperMode': context[16],
        'sourceAngles': floats(cache, 0, 3),
        'sourceAngleCache0': floats(cache, 0x18, 3),
        'sourceAngleCache1': floats(cache, 0x24, 3),
        'sourceAngleCacheTimes': floats(cache, 0x30, 2),
        'sourceAngleCacheFlags': list(cache[0x48:0x4c]),
        'sourceAngleHistoryPresent': number(cache, 0x58, 'Q') != 0,
        'predictionInterpolation': bool(interpolation_enabled),
        'historyTimes': floats(history, 0, 4),
        'historyAngles': floats(history, 0x10, 12),
        'pawnSwayRate': floats(history, 0x40, 3),
        'pawnHistoryCallerGate': caller_gate,
        'pawnSourceGetterGate': getter_gate,
        'clockControllerPresent': bool(controller_ptr),
        'predictionObjectPresent': bool(prediction_ptr),
        'identityPresent': bool(identity_ptr),
    }
    if identity_ptr:
        fields['clockDomainSelector'] = number(take(identity_ptr + 0x38, 4), kind='i')
    if globals_ptr:
        clock = take(globals_ptr, 0x50)
        fields.update(globalFrame=number(clock, 4, 'i'),
                      globalCurrentTime=number(clock, 0x30),
                      globalFrameDelta=number(clock, 0x34),
                      globalOtherFraction=number(clock, 0x38),
                      globalPlayerFraction=number(clock, 0x3c),
                      globalOtherClockGate=clock[0x40],
                      globalTick=number(clock, 0x44, 'i'),
                      globalOtherClockTime=number(clock, 0x4c))
    if controller_ptr:
        vtable = pointer(controller_ptr)
        controller = take(controller_ptr + 0x30, 9)
        fields.update(clockOffsetTicks=number(controller, 0, 'i'),
                      clockCeilingTick=number(controller, 4, 'i'),
                      clockCeilingEnabled=bool(controller[8]),
                      clockDefaultConverter=bool(vtable) and
                      pointer(vtable + 0x228) == base + DEFAULT_TIME_CONVERTER)
    if prediction_ptr:
        fields['cachedPredictedTick'] = number(take(prediction_ptr + 0x10c, 4), kind='i')
    # Local raw preservation allows later interpretation without rereading the
    # game. The known cache/history fields above are numeric capture evidence.
    return {'fields': fields, 'guardBlocks': guards,
            'raw': {'sourceAngleCache': cache.hex(), 'interpolationContext': context.hex()}}


def verify():
    root = Path(__file__).resolve().parents[2] / 'native-audit'
    sys.path.insert(0, str(root / 'python'))
    from elftools.elf.elffile import ELFFile
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    path = root.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    assert digest.hexdigest() == CLIENT_SHA256
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    with path.open('rb') as source:
        elf = ELFFile(source)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments()
                    if s['p_type'] == 'PT_LOAD']

        def read(address, length):
            assert 0 < length <= 8192
            offset = next(o + address - a for a, o, n in segments
                          if a <= address and address + length <= a + n)
            source.seek(offset)
            return source.read(length)

        checks = [
            (0x1389c14, 'lea', 'rax, [rip + 0x35a9555]'),
            (0x1389c30, 'lea', 'rax, [rip + 0x32f2221]'),
            (0x1a599fb, 'mov', 'edi, dword ptr [rax + 0x38]'),
            (0x195435f, 'cmp', 'byte ptr [rdi + 0x38], 0'),
            (0x195436d, 'mov', 'eax, dword ptr [rdi + 0x34]'),
            (0x19543b4, 'cvtsi2ss', 'xmm1, dword ptr [rbx + 0x30]'),
            (0x1954429, 'sub', 'eax, dword ptr [rdi + 0x30]'),
            (0x198eb48, 'mov', 'edi, dword ptr [rdi + 0x10c]'),
            (0x198ebc8, 'movss', 'xmm0, dword ptr [rax + 0x3c]'),
            (0x1a59b11, 'mov', 'r14d, dword ptr [rip + 0x2c5e668]'),
            (0x1a59b3c, 'movzx', 'edx, byte ptr [rbx + 0x44e8]'),
            (0x1a59b57, 'lea', 'r13, [rbx + rax + 0x44b0]'),
            (0x1a59b62, 'movss', 'xmm1, dword ptr [rbx + rdx*4 + 0x44d0]'),
            (0x1a6f15a, 'cmp', 'byte ptr [rbx + 0x6e1], 0'),
            (0x1a595d7, 'cmp', 'byte ptr [rbx + 0x144d], 0'),
        ]
        for address, mnemonic, operands in checks:
            instruction = next(cs.disasm(read(address, 15), address))
            assert (instruction.mnemonic, instruction.op_str) == (mnemonic, operands), hex(address)
        assert struct.unpack('<Q', read(PREDICTION_PTR, 8))[0] == 0x4934440
        assert CONTROLLER_PTR == 0x1389c1b + 0x35a9555
        assert GLOBAL_PTR == 0x1389c37 + 0x32f2221
        assert INTERPOLATION_CONTEXT == 0x1a59b18 + 0x2c5e668
        ranges = [('writer-time-accessor', 0x1389c10, 0x30),
                  ('time-controller', 0x1954320, 0x2c0),
                  ('prediction-player-pair', 0x198eb40, 0x90),
                  ('source-angle-getter', 0x1a59580, 0x460),
                  ('writer-cache-selection', 0x1a59afa, 0x113),
                  ('writer-cache-alternate-selection', 0x1a5a6d0, 0x30),
                  ('writer-cache-slot-selection', 0x1a5a7c0, 0x36),
                  ('source-update-caller', 0x15a0a60, 0x140),
                  ('pawn-update-caller', 0x1a6f120, 0x116)]
        out = root / 'reports/reaudit-sway-clock-inputs'
        out.mkdir(exist_ok=True)
        manifests = []
        for name, address, length in ranges:
            raw = read(address, length)
            (out / (name + '.txt')).write_text('\n'.join(
                f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(raw, address)) + '\n')
            manifests.append(dict(name=name, address=hex(address), bytes=length,
                                  sha256=hashlib.sha256(raw).hexdigest()))
    report = dict(clientSha256=CLIENT_SHA256, instructionAssertions=len(checks),
                  checks=[dict(address=hex(a), instruction=m+' '+o) for a,m,o in checks],
                  ranges=manifests, helper='read_sway_fields(read, base, player)',
                  scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  limits=['Raw cache ring payload and all source-angle alternative-path gates are not yet sampled.',
                          'Identity/clock/cache semantic names remain descriptive except current schema-verified fields.',
                          'This script statically verifies addresses; only the parent-owned sampler may call the read helper.'])
    (out / 'layout.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: report[k] for k in ('clientSha256','instructionAssertions','helper')}))


if __name__ == '__main__':
    verify()
