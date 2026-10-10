#!/usr/bin/env python3
"""Extend immutable v2 with the exact native WalkMove stop branch and long releases."""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
V2 = ROOT / 'reaudit-friction-native-oracle-v2.py'
V2_SHA = '7069613d14ace0cf96c905f73309647b78dcaf832080bc9ff6ae02cddf38dcdd'
GATE = 0x15d67ad
CONTINUE = 0x15d6833
CLEAR = 0x15d7070
CLEAR_END = 0x15d709d

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

assert digest(V2) == V2_SHA, 'Immutable v2 changed'
spec = importlib.util.spec_from_file_location('preserved_friction_v2', V2)
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
v1 = v2.v1
f32 = v2.f32
v1.CODE.update({'projected-speed-predicate': (GATE, CONTINUE - GATE), 'clear-motion': (CLEAR, CLEAR_END - CLEAR)})
assert sum(size for _, size in v1.CODE.values()) == 5217

class Native(v2.Native):
    def __init__(self):
        self.gate_running = False
        super().__init__()

    def hook(self, u, at, size, data):
        if self.gate_running and at in (CONTINUE, CLEAR_END):
            u.emu_stop()
            return
        super().hook(u, at, size, data)

    def vectors(self):
        return {name: [self.rf(v1.DATA + offset + i * 4) for i in range(3)]
                for name, offset in [('velocity', 0x38), ('accelerationWork', 0x104), ('carriedDelta', 0x110)]}

    def stop_gate(self):
        self.registers()
        self.u.reg_write(v1.UC_X86_REG_RSP, v1.FRAME - 0x300)
        for reg, value in [(v1.UC_X86_REG_RBP, v1.FRAME), (v1.UC_X86_REG_RBX, v1.MOVE),
                           (v1.UC_X86_REG_R13, v1.DATA), (v1.UC_X86_REG_R14, 0x2796428)]:
            self.u.reg_write(reg, value)
        self.wf(v1.FRAME - 0x24c, 1)
        self.gate_running = True
        try:
            self.u.emu_start(GATE, CONTINUE, count=50000)
        finally:
            self.gate_running = False
        stopped_at = self.u.reg_read(v1.UC_X86_REG_RIP)
        assert stopped_at in (CONTINUE, CLEAR_END), 'Unexpected stop-gate exit'
        actual = self.u.reg_read(v1.UC_X86_REG_MXCSR)
        assert actual & ~0x3f == v2.PROFILES[self.profile], 'MXCSR control changed'
        key = f'{self.profile}:{actual:#x}'
        self.mxcsr_calls[key] = self.mxcsr_calls.get(key, 0) + 1
        return {'taken': stopped_at == CLEAR_END, 'state': self.state(), 'vectors': self.vectors()}

def fixtures():
    result = v2.fixtures()
    for fixture in result:
        if fixture['kind'] == 'release':
            repeated = fixture['commands'][-1]
            fixture['commands'] = fixture['commands'] + [dict(repeated) for _ in range(44)]
            assert len(fixture['commands']) == 64
    return result

def replay(n, fixture, profile):
    n.profile = profile
    n.seed(fixture['initialState'])
    rows, generated = [], []
    release_start = fixture['commands'][0]['startFraction']
    threshold = f32(f32(.34) * fixture['suppliedSpeed']) if fixture['kind'] == 'release' else None
    first, first_stop = None, None
    for index, cmd in enumerate(fixture['commands']):
        incoming = n.state()
        if cmd['beginCommand']:
            n.command_start()
        after_begin = n.state()
        bounds, why = v2.intervals(cmd, after_begin)
        generated.append({'command': index + 1, 'supplied': cmd, 'beforeCommand': incoming,
                          'afterBeginCommand': after_begin, 'boundaries': why})
        wish = cmd['wishAtStart']
        events = {e['fraction']: e['wish'] for e in cmd['events']}
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
            after_pre = n.velocity_helper(v2.PRE)
            gate = n.stop_gate()
            after_post = n.velocity_helper(v2.POST)
            after_copy = n.copy_wish()
            assert after_copy['previousWish'] == {'x': f32(wish[0]), 'y': f32(wish[1])}
            when = (index + end - release_start) / 64
            row = {'command': index + 1, 'startFraction': start, 'endFraction': end, 'duration': duration,
                   'startTimeFromFixtureStart': (index + start - release_start) / 64,
                   'endTimeFromFixtureStart': when, 'beforePreparation': before_preparation, 'before': before,
                   'currentWish': {'x': wish[0], 'y': wish[1]}, 'afterCache': after_cache,
                   'nativeControlSpeed': control, 'afterFriction': after_friction, 'afterPreHelper': after_pre,
                   'nativeStopGate': gate, 'afterPostHelper': after_post, 'afterWishCopy': after_copy,
                   'derivedUncollidedDisplacement': {'x': 0 if gate['taken'] else f32(after_pre['speedX'] * duration),
                                                    'y': 0 if gate['taken'] else f32(after_pre['speedY'] * duration)}}
            rows.append(row)
            speed = f32(math.sqrt(f32(f32(after_post['speedX'] ** 2) + f32(after_post['speedY'] ** 2))))
            boundary = {'timeFromFixtureStart': when, 'previousTimeFromFixtureStart': row['startTimeFromFixtureStart'],
                        'command': index + 1, 'fraction': end, 'speed': speed, 'rowIndex': len(rows) - 1}
            if threshold is not None and first is None and speed <= threshold:
                first = boundary
            if first_stop is None and after_post['speedX'] == 0 and after_post['speedY'] == 0:
                first_stop = boundary
        if cmd['finishCommand']:
            n.command_end()
            rows[-1]['afterCommandHandoff'] = n.state()
        generated[-1]['afterCommand'] = n.state()
    if fixture['kind'] == 'release':
        assert first_stop is not None, 'Long release did not reach exact zero'
    return ({'fixtureId': fixture['id'], 'mxcsrProfile': profile, 'generatedCommands': generated, 'rows': rows},
            {'fixtureId': fixture['id'], 'mxcsrProfile': profile, 'threshold': threshold,
             'firstQualifiedBoundary': first, 'firstExactStopBoundary': first_stop})

def gate_controls(n):
    result = []
    below = v1.frombits(v1.bits(1) - 1)
    above = v1.frombits(v1.bits(1) + 1)
    for axis in range(3):
        for speed, expected in [(below, True), (1, False), (above, False)]:
            n.profile = 'nearest-gradual'
            n.seed(v2.seed(0))
            velocity = [0, 0, 0]
            velocity[axis] = speed
            for i, value in enumerate(velocity):
                n.wf(v1.DATA + 0x38 + i * 4, value)
                n.wf(v1.DATA + 0x110 + i * 4, 7 + i)
            n.wf(v1.GLOBALS + 0x34, 1 / 128)
            before = n.vectors()
            gate = n.stop_gate()
            assert gate['taken'] == expected
            if expected:
                assert all(v == 0 for vector in gate['vectors'].values() for v in vector)
            else:
                assert gate['vectors'] == before
            result.append({'id': f'axis-{axis}-speed-{speed}', 'duration': 1 / 128, 'before': before, 'gate': gate})
    # Acceleration-sensitive controls distinguish projection from midpoint-only gating.
    for velocity, acceleration, expected in [(2, -128, True), (.5, 128, False), (1, 0, False)]:
        n.seed(v2.seed(velocity))
        n.wf(v1.DATA + 0x104, acceleration)
        n.wf(v1.GLOBALS + 0x34, 1 / 128)
        before = n.vectors()
        gate = n.stop_gate()
        assert gate['taken'] == expected
        result.append({'id': f'projection-{velocity}-{acceleration}', 'duration': 1 / 128, 'before': before, 'gate': gate})
    return result

def friction_controls(n):
    result = []
    controls = [0, v1.frombits(v1.bits(.1) - 1), f32(.1), v1.frombits(v1.bits(.1) + 1)]
    for control in controls:
        n.seed(v2.seed(.05, active=True, stored=control))
        before = n.state()
        after_friction = n.friction(1 / 128)
        assert n.last_control == control
        if control < f32(.1):
            assert after_friction['speedX'] == before['speedX']
        after_pre = n.velocity_helper(v2.PRE)
        gate = n.stop_gate()
        after_post = n.velocity_helper(v2.POST)
        assert after_post['speedX'] == 0 and after_post['speedY'] == 0
        result.append({'id': f'cached-control-{control}', 'duration': 1 / 128, 'before': before,
                       'nativeControlSpeed': n.last_control, 'afterFriction': after_friction,
                       'afterPreHelper': after_pre, 'nativeStopGate': gate, 'afterPostHelper': after_post})
    return result

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    proof = ROOT / 'low-speed-proof.json'
    assert digest(proof) == '882d7d65f31ba93ced004721fe391f4e827d5d103665695015b9b1b29a4ea817'
    from proof import verify
    manifest = ROOT / 'proof-manifest.json'
    static_proof = verify(args.binary.resolve(), manifest)
    v1.BINARY = args.binary.resolve()
    bound = json.loads(proof.read_text())
    assert bound['serverSha256'] == v1.SHA and bound['savedBytesDecoded'] == 179
    args.out.mkdir(parents=True, exist_ok=False)
    definition = {'schema': 'cs2.native-friction-segment-fixtures.v3', 'fixtures': fixtures(),
                  'mxcsrProfiles': v2.PROFILES, 'friction': 5.2, 'stopSpeed': 80, 'surfaceFactor': 1,
                  'ownerFactor': 1, 'ownerExternalVector': [0, 0, 0], 'initialAccelerationWork': [0, 0, 0],
                  'initialCarriedDelta': [0, 0, 0]}
    (args.out / 'fixtures.json').write_text(json.dumps(definition, indent=2, allow_nan=False) + '\n')
    n = Native()
    controls = gate_controls(n)
    small_controls = friction_controls(n)
    sequences, thresholds = [], []
    for fixture in definition['fixtures']:
        for profile in fixture['mxcsrProfiles']:
            sequence, summary = replay(n, fixture, profile)
            sequences.append(sequence)
            if fixture['kind'] == 'release':
                thresholds.append(summary)
    report = {'schema': 'cs2.native-friction-segment-oracle.v3', 'guardedNativeExecution': True,
              'serverSha256': v1.SHA, 'readerSha256': digest(Path(__file__)), 'preservedV2ReaderSha256': V2_SHA,
              'originalLocalReaderSha256': '4c039bd146a6069f9a5d223e36d341f2baa56fe39a0ba6a508cbb516fb0fe8c5',
              'portableManifestSha256': digest(manifest), 'portableStaticProof': static_proof,
              'preservedV1ReaderSha256': v2.V1_SHA, 'lowSpeedProofSha256': digest(proof),
              'fixtureDefinitionSha256': hashlib.sha256(v2.canonical(definition)).hexdigest(),
              'fixtureFileSha256': digest(args.out / 'fixtures.json'), 'selectedNativeCodeBytes': 5217,
              'fixtures': definition['fixtures'], 'sequences': sequences, 'derivedReleaseThresholds': thresholds,
              'stopGateControls': controls, 'smallControlSpeedCases': small_controls,
              'mxcsrProfiles': v2.PROFILES, 'mxcsrExecutionResults': n.mxcsr_calls, 'readLedger': n.reads,
              'hooks': n.calls, 'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts,
                  'policy': 'Every native instruction/data span checked against imported read-only ranges or declared private/initializer read-write ranges.',
                  'accessLedger': [{'operation': op, 'address': hex(at), 'bytes': size, 'count': count}
                                  for (op, at, size), count in sorted(n.memory_accesses.items())]},
              'limits': ['Explicit supplied initial state, processed wish and command schedules; no live physical input replay.',
                         'Native selected blocks only: no Accelerate, collision, complete WalkMove, pawn publishing or full command dispatcher.',
                         'The stop predicate is executed after the pre helper and before the post helper; non-taken collision path is omitted.',
                         'Nonzero-wish controls test cache/friction/stop state without acceleration.',
                         'Zero owner external vector and unit owner/surface factors are supplied.',
                         'Active saved-fraction insertion, temporary preparation and command-marker lifecycle are byte-bound harness rules.',
                         'Derived position is zero when the native stop branch skips position movement; otherwise supplied uncollided midpoint integration.',
                         'Thresholds use supplied speeds and float32(.34); GetInaccuracy is not invoked.',
                         'MXCSR settings are explicit supplied profiles, not observed runtime configuration.']}
    target = args.out / 'native.json'
    # Stream JSON serialization to avoid holding a second full report string.
    with target.open('w') as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write('\n')
    native_hash = digest(target)
    release_ids = {f['id']: f['suppliedSpeed'] for f in definition['fixtures'] if f['kind'] == 'release'}
    endpoints = {'schema': 'cs2.native-friction-release-endpoints.v3',
                 'sourceSchema': report['schema'], 'sourceNativeSha256': native_hash,
                 'serverSha256': v1.SHA, 'readerSha256': report['readerSha256'],
                 'fixtureDefinitionSha256': report['fixtureDefinitionSha256'],
                 'fixtureFileSha256': report['fixtureFileSha256'], 'guardedNativeExecution': True,
                 'unexpectedAccesses': 0,
                 'endpointSemantics': 'Native post-velocity-helper output after native stop gate; flat supplied-state release without acceleration/collision.',
                 'releaseFixtures': [{'id': f['id'], 'kind': f['kind'], 'suppliedSpeed': f['suppliedSpeed']}
                                     for f in definition['fixtures'] if f['kind'] == 'release'],
                 'derivedReleaseThresholds': thresholds,
                 'releaseSequences': [
                     {'fixtureId': s['fixtureId'], 'suppliedSpeed': release_ids[s['fixtureId']],
                      'mxcsrProfile': s['mxcsrProfile'],
                      'rows': [{'command': r['command'], 'startFraction': r['startFraction'], 'duration': r['duration'],
                                'endFraction': r['endFraction'], 'endTimeFromFixtureStart': r['endTimeFromFixtureStart'],
                                'afterPostHelper': {'speedX': r['afterPostHelper']['speedX'], 'speedY': r['afterPostHelper']['speedY']},
                                'nativeStopGateTaken': r['nativeStopGate']['taken']} for r in s['rows']]}
                     for s in sequences if s['fixtureId'] in release_ids]}
    endpoint_target = args.out / 'release-endpoints.json'
    with endpoint_target.open('w') as output:
        json.dump(endpoints, output, separators=(',', ':'), allow_nan=False)
        output.write('\n')
    print(json.dumps({'output': str(target), 'sha256': native_hash, 'status': 'passed',
                      'fixtureDefinitionSha256': report['fixtureDefinitionSha256'], 'fixtures': len(definition['fixtures']),
                      'sequences': len(sequences), 'rows': sum(len(s['rows']) for s in sequences),
                      'stopGateControls': len(controls), 'smallControlSpeedCases': len(small_controls),
                      'releaseEndpointOutput': str(endpoint_target), 'releaseEndpointSha256': digest(endpoint_target),
                      'releaseEndpointRows': sum(len(s['rows']) for s in endpoints['releaseSequences'])}))

if __name__ == '__main__':
    main()
