#!/usr/bin/env python3
"""Supplied standing dry-ground cache/friction/acceleration/cap/stop replay.

Preserves v3. No live game, collision, full command dispatch or input capture.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V3 = ROOT / 'reaudit-friction-native-oracle-v3.py'
V3_SHA = '4c039bd146a6069f9a5d223e36d341f2baa56fe39a0ba6a508cbb516fb0fe8c5'
PROOF = ROOT / 'accelerate-proof.json'
PROOF_SHA = 'a26c977379a571d8c5372a1d83112c812cbeab4db868e4f1edc2209cfb3822f6'
ACCEL = 0x158cdd0
NORM_START, NORM_END = 0x15d6513, 0x15d6560
CAP_START, CAP_END = 0x15d66cf, 0x15d67a2
SERVICE, WEAPON, WEAPON_TABLE = 0x5010000, 0x5010100, 0x5011000
SCALE_SETTING, DEBUG_SETTING, DIRECTION = 0x5012000, 0x5012100, 0x5012200
SPEED_HOOK, ZOOM_HOOK = 0x501e000, 0x501e100
ACTIVE_WEAPON, WATER_LEVEL = 0x17d84c0, 0xd43630

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

assert digest(V3) == V3_SHA
assert digest(PROOF) == PROOF_SHA
spec = importlib.util.spec_from_file_location('preserved_ground_v3', V3)
v3 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v3)
v2, v1, f32 = v3.v2, v3.v1, v3.f32
proof = json.loads(PROOF.read_text())
assert proof['unresolvedBranches'] == [{'caller': '0x158d026', 'target': '0x9fc0c0', 'kind': 'outgoing-branch'}]
merged = []
for row in proof['reachableInstructionRanges']:
    start, size = int(row['start'], 16), row['bytes']
    if merged and merged[-1][0] + merged[-1][1] == start:
        merged[-1][1] += size
    else:
        merged.append([start, size])
assert sum(size for _, size in merged) == 1652
for index, (start, size) in enumerate(merged):
    v1.CODE[f'accelerate-reachable-{index}'] = (start, size)
v1.CODE.update({'finite-wish-length': (NORM_START, 57), 'finite-wish-normalize': (0x15d6df8, 55),
                'ground-final-cap': (CAP_START, CAP_END - CAP_START)})
assert sum(size for _, size in v1.CODE.values()) == 7192
v1.SUPPLIED_DATA.extend([
    (SERVICE, 0x20, 'supplied-active-weapon-service'), (WEAPON, 0x100, 'supplied-unscoped-weapon'),
    (WEAPON_TABLE, 0xd00, 'supplied-weapon-dispatch'), (SCALE_SETTING, 0x60, 'supplied-weapon-scaling-enabled'),
    (DEBUG_SETTING, 0x60, 'supplied-acceleration-debug-disabled'), (DIRECTION, 12, 'supplied-normalized-wish'),
    (0x29a41f8, 8, 'supplied-weapon-scaling-pointer'), (0x29a41e8, 8, 'supplied-debug-setting-pointer')])

class Native(v3.Native):
    def __init__(self):
        self.weapon_speed = None
        super().__init__()
        self.wq(v1.PAWN + 0xdf0, SERVICE)
        self.wq(WEAPON, WEAPON_TABLE)
        self.wq(WEAPON_TABLE + 0xc60, SPEED_HOOK)
        self.wq(WEAPON_TABLE + 0xcf0, ZOOM_HOOK)
        self.wq(0x29a41f8, SCALE_SETTING)
        self.wq(0x29a41e8, DEBUG_SETTING)
        self.wb(SCALE_SETTING + 0x58, 1)
        self.wb(DEBUG_SETTING + 0x58, 0)
        for offset in (0x58, 0x5a, 0x416):
            self.wb(v1.MOVE + offset, 0)
        self.wb(v1.PAWN + 0x668, 0)

    def hook(self, u, at, size, data):
        expected = {ACTIVE_WEAPON: (SERVICE, 'supplied-active-weapon'),
                    WATER_LEVEL: (v1.PAWN, 'supplied-dry-water-level'),
                    SPEED_HOOK: (WEAPON, 'supplied-mode-weapon-speed'),
                    ZOOM_HOOK: (WEAPON, 'supplied-unscoped-zoom-level')}
        if at in expected:
            receiver, role = expected[at]
            assert u.reg_read(v1.UC_X86_REG_RDI) == receiver
            self.calls[role] = self.calls.get(role, 0) + 1
            if at == ACTIVE_WEAPON:
                u.reg_write(v1.UC_X86_REG_RAX, WEAPON)
            elif at == SPEED_HOOK:
                assert self.weapon_speed in (200, 215, 225, 230, 240)
                self.xmm(v1.UC_X86_REG_XMM0, self.weapon_speed)
            else:
                u.reg_write(v1.UC_X86_REG_RAX, 0)
            self.ret()
            return
        # These finite fixtures must never enter fallback normalization,
        # null-owner repair, spectator, water, walk, duck or debug branches.
        forbidden = {0x1e685e0, 0x17d8dd0, 0x1512ea0, 0x1512f40, 0x9fc0c0,
                     0x158ceff, 0x158d100, 0x158d1f8, 0x158d3d0}
        assert at not in forbidden, f'Out-of-scope native branch {at:x}'
        super().hook(u, at, size, data)

    def state(self):
        return {**super().state(), 'frictionOvershoot': self.rf(v1.DATA + 0x124)}

    def normalize_wish(self, wish, cap):
        if wish == [0, 0]:
            return {'direction': [0, 0, 0], 'nativeLength': 0, 'wishSpeed': 0}
        assert all(abs(value) <= 240 for value in wish)
        self.registers()
        self.u.reg_write(v1.UC_X86_REG_RSP, v1.FRAME - 0x300)
        self.u.reg_write(v1.UC_X86_REG_RBP, v1.FRAME)
        self.u.reg_write(v1.UC_X86_REG_RBX, v1.MOVE)
        self.wf(v1.FRAME - 0x24c, 1)
        self.wf(v1.FRAME - 0x238, wish[0])
        self.wf(v1.FRAME - 0x234, wish[1])
        self.wf(v1.FRAME - 0x230, 0)
        self.u.reg_write(v1.UC_X86_REG_XMM0, v1.bits(wish[0]) | (v1.bits(wish[1]) << 32))
        self.xmm(v1.UC_X86_REG_XMM1, wish[1])
        self.xmm(v1.UC_X86_REG_XMM2, wish[0])
        self.xmm(v1.UC_X86_REG_XMM3, f32(1e-17))
        self.run(NORM_START, NORM_END)
        length = self.rf(v1.FRAME - 0x248)
        assert 1e-17 <= length <= 1e17
        direction = [self.rf(v1.FRAME - 0x238 + i * 4) for i in range(3)]
        # Native MINSS selects one already-float32 operand; no authored
        # normalization or effective acceleration coefficient is used.
        return {'direction': direction, 'nativeLength': length, 'wishSpeed': min(f32(cap), length)}

    def accelerate(self, wish, cap, duration):
        prepared = self.normalize_wish(wish, cap)
        if prepared['wishSpeed'] == 0:
            return prepared
        self.weapon_speed = cap
        for index, value in enumerate(prepared['direction']):
            self.wf(DIRECTION + index * 4, value)
        self.registers()
        self.u.reg_write(v1.UC_X86_REG_RDI, v1.MOVE)
        self.u.reg_write(v1.UC_X86_REG_RSI, v1.DATA)
        self.u.reg_write(v1.UC_X86_REG_RDX, DIRECTION)
        self.xmm(v1.UC_X86_REG_XMM0, duration)
        self.xmm(v1.UC_X86_REG_XMM1, prepared['wishSpeed'])
        self.xmm(v1.UC_X86_REG_XMM2, 5.5)
        self.run(ACCEL)
        return prepared

    def cap_ground_speed(self, cap):
        self.wf(v1.DATA + 0x11c, cap)
        self.registers()
        self.u.reg_write(v1.UC_X86_REG_RSP, v1.FRAME - 0x300)
        for reg, value in [(v1.UC_X86_REG_RBP, v1.FRAME), (v1.UC_X86_REG_RBX, v1.MOVE),
                           (v1.UC_X86_REG_R13, v1.DATA)]:
            self.u.reg_write(reg, value)
        self.wf(v1.FRAME - 0x24c, 1)
        self.run(CAP_START, CAP_END)
        return self.state()

WEAPONS = {'ak47': 215, 'm4a4': 225, 'm4a1-s': 225, 'awp-unscoped': 200,
           'glock': 240, 'usp-s': 240, 'deagle': 230}

def fixtures():
    out = []
    for weapon, cap in WEAPONS.items():
        for sign in (-1, 1):
            for fraction in (0, .25, .5, .75):
                for diagonal in (False, True):
                    counter = (-sign * cap, -sign * cap if diagonal else 0)
                    commands = [v2.command(start=fraction, extra=(.5,), begin=fraction == 0),
                                v2.command(events=[(.25, counter)], extra=(.5,))]
                    commands.extend(v2.command(wish=counter, extra=(.5,)) for _ in range(14))
                    out.append({'id': f'{weapon}-release-counter-{sign:+d}-{fraction:g}-' + ('diagonal' if diagonal else 'axis'),
                                'kind': 'release-counter', 'weaponLabel': weapon, 'suppliedSpeed': cap,
                                'initialState': v2.seed(sign * cap, prior=(sign * cap, 0)),
                                'commands': commands, 'mxcsrProfiles': ['nearest-gradual']})
            for speed in (.05, .5, 1, 3.25, 6.5, 7):
                wish = (-sign * cap, 0)
                out.append({'id': f'{weapon}-near-zero-{sign:+d}-{speed:g}', 'kind': 'near-zero-reversal',
                            'weaponLabel': weapon, 'suppliedSpeed': cap,
                            'initialState': v2.seed(sign * speed, prior=(sign * cap, 0)),
                            'commands': [v2.command(wish=wish, extra=(.25, .5, .75)), v2.command(wish=wish)],
                            'mxcsrProfiles': ['nearest-gradual']})
            for diagonal in (False, True):
                wish = (sign * cap, sign * cap if diagonal else 0)
                out.append({'id': f'{weapon}-start-{sign:+d}-' + ('diagonal' if diagonal else 'axis'),
                            'kind': 'start-from-rest', 'weaponLabel': weapon, 'suppliedSpeed': cap,
                            'initialState': v2.seed(0), 'commands': [v2.command(wish=wish, extra=(.5,)) for _ in range(12)],
                            'mxcsrProfiles': ['nearest-gradual']})
        # A deliberately supplied above-cap velocity forces the native cap/work
        # correction branch. It is not asserted to be an ordinary input start.
        out.append({'id': f'{weapon}-supplied-above-cap', 'kind': 'supplied-cap-correction',
                    'weaponLabel': weapon, 'suppliedSpeed': cap,
                    'initialState': v2.seed(cap * 1.2, prior=(cap, 0)),
                    'commands': [v2.command(wish=(0, cap), extra=(.25, .5, .75))],
                    'mxcsrProfiles': ['nearest-gradual']})
    for ident in ['ak47-release-counter-+1-0.25-diagonal', 'deagle-near-zero--1-0.5', 'glock-start-+1-axis']:
        next(f for f in out if f['id'] == ident)['mxcsrProfiles'].append('nearest-ftz-daz')
    assert len(out) == 231
    return out

def replay(n, fixture, profile):
    n.profile = profile
    n.seed(fixture['initialState'])
    cap = fixture['suppliedSpeed']
    rows, generated = [], []
    start_fraction = fixture['commands'][0]['startFraction']
    for index, command in enumerate(fixture['commands']):
        incoming = n.state()
        if command['beginCommand']:
            n.command_start()
        after_begin = n.state()
        bounds, reasons = v2.intervals(command, after_begin)
        generated.append({'command': index + 1, 'supplied': command, 'beforeCommand': incoming,
                          'afterBeginCommand': after_begin, 'boundaries': reasons})
        wish = command['wishAtStart']
        events = {event['fraction']: event['wish'] for event in command['events']}
        for start, end in zip(bounds, bounds[1:]):
            if start in events:
                wish = events[start]
            duration = f32(f32(end - start) * f32(1 / 64))
            before_preparation = n.state()
            n.prepare_segment()
            before = n.state()
            after_cache = n.cache_current(start, wish)
            after_friction = n.friction(duration)
            control = n.last_control
            prepared_wish = n.accelerate(wish, cap, duration)
            after_accelerate = n.state()
            after_cap = n.cap_ground_speed(cap)
            after_pre = n.velocity_helper(v2.PRE)
            gate = n.stop_gate()
            after_post = n.velocity_helper(v2.POST)
            after_copy = n.copy_wish()
            assert after_copy['previousWish'] == {'x': f32(wish[0]), 'y': f32(wish[1])}
            rows.append({'command': index + 1, 'startFraction': start, 'endFraction': end, 'duration': duration,
                         'startTimeFromFixtureStart': (index + start - start_fraction) / 64,
                         'endTimeFromFixtureStart': (index + end - start_fraction) / 64,
                         'beforePreparation': before_preparation, 'before': before, 'currentWish': {'x': wish[0], 'y': wish[1]},
                         'afterCache': after_cache, 'nativeControlSpeed': control, 'afterFriction': after_friction,
                         'preparedWish': prepared_wish, 'afterAccelerate': after_accelerate, 'afterNativeCap': after_cap,
                         'afterPreHelper': after_pre, 'nativeStopGate': gate, 'afterPostHelper': after_post,
                         'afterWishCopy': after_copy,
                         'derivedUncollidedDisplacement': {'x': 0 if gate['taken'] else f32(after_pre['speedX'] * duration),
                                                          'y': 0 if gate['taken'] else f32(after_pre['speedY'] * duration)}})
        if command['finishCommand']:
            n.command_end()
            rows[-1]['afterCommandHandoff'] = n.state()
        generated[-1]['afterCommand'] = n.state()
    return {'fixtureId': fixture['id'], 'mxcsrProfile': profile, 'generatedCommands': generated, 'rows': rows}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    from proof import verify
    manifest = ROOT / 'proof-manifest.json'
    static_proof = verify(args.binary.resolve(), manifest)
    v1.BINARY = args.binary.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    definition = {'schema': 'cs2.native-ground-combined-fixtures.v1', 'fixtures': fixtures(),
                  'mxcsrProfiles': v2.PROFILES, 'friction': 5.2, 'stopSpeed': 80, 'accelerate': 5.5,
                  'surfaceFactor': 1, 'ownerFactor': 1, 'ownerExternalVector': [0, 0, 0],
                  'weaponSpeedScaling': True, 'debug': False, 'duck': False, 'walk': False, 'waterLevel': 0, 'zoomLevel': 0}
    (args.out / 'fixtures.json').write_text(json.dumps(definition, indent=2, allow_nan=False) + '\n')
    n = Native()
    sequences = [replay(n, fixture, profile) for fixture in definition['fixtures'] for profile in fixture['mxcsrProfiles']]
    report = {'schema': 'cs2.native-ground-combined-oracle.v1', 'guardedNativeExecution': True,
              'serverSha256': v1.SHA, 'readerSha256': digest(Path(__file__)), 'preservedV3ReaderSha256': V3_SHA,
              'originalLocalReaderSha256': 'cc784a00031e18006d57da6da252a6fd5916b4768278e3885cd146a50368dd74',
              'portableManifestSha256': digest(manifest), 'portableStaticProof': static_proof,
              'accelerateProofSha256': PROOF_SHA, 'fixtureDefinitionSha256': hashlib.sha256(v2.canonical(definition)).hexdigest(),
              'fixtureFileSha256': digest(args.out / 'fixtures.json'), 'selectedNativeCodeBytes': 7192,
              'fixtures': definition['fixtures'], 'sequences': sequences, 'hooks': n.calls,
              'mxcsrProfiles': v2.PROFILES, 'mxcsrExecutionResults': n.mxcsr_calls, 'readLedger': n.reads,
              'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts,
                  'policy': 'Every native instruction/data span checked against imported read-only ranges or declared private/initializer read-write ranges.',
                  'accessLedger': [{'operation': op, 'address': hex(at), 'bytes': size, 'count': count}
                                  for (op, at, size), count in sorted(n.memory_accesses.items())]},
              'limits': ['Explicit supplied states and schedules, not live physical input replay.',
                         'Standing, unscoped, dry ground only; ordinary getter results and scaling/debug settings are supplied private inputs.',
                         'Weapon labels map supplied cap values; this harness does not invoke the real per-weapon getter implementations.',
                         'Native finite nonzero wish normalization is invoked; min(length,supplied cap) is the retained MINSS selection reproduced by the harness.',
                         'Native acceleration, overshoot budget, final cap/work correction, pre/stop/post and wish copy execute; collision and position publishing do not.',
                         'Temporary preparation, marker lifecycle and saved-fraction boundaries remain byte-bound harness operations.',
                         'Derived uncollided displacement is authored; no complete WalkMove or complete command dispatcher is invoked.',
                         'MXCSR is explicitly supplied, not sampled from a live process.']}
    target = args.out / 'native.json'
    with target.open('w') as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write('\n')
    native_hash = digest(target)
    summary = {'sourceNativeSha256': native_hash, 'readerSha256': report['readerSha256'],
               'fixtureDefinitionSha256': report['fixtureDefinitionSha256'], 'fixtureFileSha256': report['fixtureFileSha256'],
               'fixtures': len(definition['fixtures']), 'sequences': len(sequences),
               'rows': sum(len(s['rows']) for s in sequences), 'memoryGuardCounts': n.memory_counts,
               'overshootRows': sum(r['afterFriction']['frictionOvershoot'] > 0 for s in sequences for r in s['rows']),
               'stopGateRows': sum(r['nativeStopGate']['taken'] for s in sequences for r in s['rows']),
               'hooks': n.calls, 'status': 'passed'}
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'output': str(target), **summary}))

if __name__ == '__main__':
    main()
