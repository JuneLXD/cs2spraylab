#!/usr/bin/env python3
"""Replay three supplied historical-test states through the frozen native blocks.

This checks one step from supplied state, not the preceding stance ramp. Run
serially under MemoryMax=512M, MemorySwapMax=0 and CPUQuota=100%.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STANCE = ROOT / 'stance_oracle.py'
STANCE_SHA = 'caba74a0ae3ffb4e32a3d3a5ba329f88aa5ae9a111e36ff4d44590c6e99c3584'
INPUT_SHA = 'dc6d7bc3d392c718cdc20e5e1d81f7ae99354ccc25c9657f4b9a668830a8c2b3'
COMPARE_SHA = '3433a8539a8060af211097d350c35885a33e12f222f69b83ecb16dd424a384b6'
STANCE_CONTENT_SHA = '07a134fd393ed319968f2c51b644c3152ea46cae8d4d3cba868a3ab0439e0ce1'
VELOCITY_EPSILON = 1e-11  # Native units/s; only SI conversion round trips.
POSITION_EPSILON = 1e-11  # Native units; only SI conversion/subtraction.


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


assert digest(STANCE) == STANCE_SHA
assert digest(ROOT / 'compare.py') == COMPARE_SHA
spec = importlib.util.spec_from_file_location('frozen_stance', STANCE)
stance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stance)
from compare import content_digest
from proof import verify


def read_midpoints(path):
    assert path.stat().st_size <= 48 * 1024 * 1024
    report = json.loads(path.read_text())
    assert report['schema'] == 'cs2.native-ground-stance-oracle.v1'
    assert report['serverSha256'] == stance.v1.SHA
    assert report['guardedNativeExecution'] is True
    assert report['memoryGuard']['unexpectedAccesses'] == 0
    assert content_digest(report, 'stance') == STANCE_CONTENT_SHA
    fixtures = {f['id']: f for f in report['fixtures'] if f['kind'] == 'old-midpoint-state'}
    selected = []
    for sequence in report['sequences']:
        if sequence['fixtureId'] in fixtures and sequence['mxcsrProfile'] == 'nearest-gradual':
            assert len(sequence['rows']) == 1
            selected.append({'fixture': fixtures[sequence['fixtureId']], 'native': sequence['rows'][0]})
    assert len(selected) == 4
    return selected


def cache_state(native):
    return {'active': bool(native['stashActive']), 'savedFraction': native['savedFraction'],
            'storedSpeed': native['storedSpeed'], 'commandMarked': bool(native['commandMarker']),
            'previousWish': {'x': native['previousWish']['x'], 'z': native['previousWish']['y']}}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--stance-report', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, default=ROOT / 'stance-regression-inputs.json')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite regression output'
    assert args.inputs.stat().st_size <= 32768 and digest(args.inputs) == INPUT_SHA
    inputs = json.loads(args.inputs.read_text())
    cases = inputs['cases']
    assert [c['id'] for c in cases] == ['running-to-walk-215', 'crouch-steady-215', 'crouch-steady-240']
    midpoints = read_midpoints(args.stance_report)
    static_proof = verify(args.binary.resolve(), ROOT / 'proof-manifest.json')
    stance.v1.BINARY = args.binary.resolve()
    n = stance.Native()
    results = []
    for case in cases:
        assert case['stance'] in ('walk', 'crouch')
        assert case['dt'] == 1 / 128
        assert case['beginCommand'] is (case['startFraction'] == 0)
        assert case['finishCommand'] is (case['endFraction'] == 1)
        assert (case['endFraction'] - case['startFraction']) / 64 == case['dt']
        fixture = {'id': case['id'], 'kind': 'supplied-historical-test-state',
                   'stance': case['stance'], 'weaponSpeed': case['weaponSpeed'],
                   'suppliedSpeed': case['suppliedSpeed'],
                   'suppliedProcessedCap': case['suppliedSpeed'], 'initialState': case['initialState'],
                   'commands': [stance.v2.command(start=case['startFraction'], end=case['endFraction'],
                       wish=case['wish'], begin=case['beginCommand'], finish=case['finishCommand'])],
                   'mxcsrProfiles': ['nearest-gradual']}
        n.configure(fixture)
        sequence = stance.combined.replay(n, fixture, 'nearest-gradual')
        assert len(sequence['rows']) == 1, 'Unexpected segment insertion'
        row = sequence['rows'][0]
        assert row['duration'] == case['dt']
        assert row['beforePreparation']['speedX'] == stance.f32(case['initialState']['velocity'][0])
        assert row['beforePreparation']['speedY'] == stance.f32(case['initialState']['velocity'][1])
        native_after = row.get('afterCommandHandoff', row['afterWishCopy'])
        native_velocity = [row['afterPostHelper']['speedX'], row['afterPostHelper']['speedY']]
        native_position = [row['derivedUncollidedDisplacement']['x'], row['derivedUncollidedDisplacement']['y']]
        velocity_error = [actual - expected for actual, expected in zip(case['trainerAfter']['velocity'], native_velocity)]
        position_error = [actual - expected for actual, expected in zip(case['trainerAfter']['derivedPosition'], native_position)]
        native_cache = cache_state(native_after)
        assert max(map(abs, velocity_error)) <= VELOCITY_EPSILON, (case['id'], 'velocity', velocity_error)
        assert max(map(abs, position_error)) <= POSITION_EPSILON, (case['id'], 'position', position_error)
        assert native_cache == case['trainerAfter']['state'], (case['id'], 'cache', native_cache)
        results.append({'id': case['id'], 'fixture': fixture,
                        'generatedCommands': sequence['generatedCommands'], 'native': row,
                        'nativeCacheAfter': native_cache, 'nativeVelocityAfter': native_velocity,
                        'nativeDerivedDisplacement': native_position, 'trainerAfter': case['trainerAfter'],
                        'comparison': {'velocityDifferenceNativeUnitsPerSecond': velocity_error,
                            'derivedPositionDifferenceNativeUnits': position_error,
                            'cacheStateExact': True, 'status': 'passed'}})
    result = {'schema': 'spraylab.native-ground-stance-regressions.v1',
              'serverSha256': stance.v1.SHA, 'readerSha256': digest(Path(__file__)),
              'stanceReaderSha256': STANCE_SHA, 'suppliedInputsSha256': INPUT_SHA,
              'sourceHashes': inputs['sourceHashes'],
              'sourceStanceReportSha256': digest(args.stance_report),
              'sourceStanceExecutionContentSha256': STANCE_CONTENT_SHA,
              'guardedNativeExecution': True, 'selectedNativeCodeBytes': 7192,
              'addedNativeCodeBytes': 0, 'stancePrivateExtensionBytes': 88,
              'newNativeAccessorHooks': 0,
              'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts},
              'mxcsrProfiles': stance.v2.PROFILES, 'mxcsrExecutionResults': n.mxcsr_calls,
              'hooks': n.calls,
              'comparisonBounds': {'velocityNativeUnitsPerSecond': VELOCITY_EPSILON,
                  'derivedPositionNativeUnits': POSITION_EPSILON, 'cacheState': 'Exact',
                  'reason': 'Only trainer SI conversion/subtraction round trips; native float32 endpoint precision is preserved.'},
              'oldMidpointControls': midpoints, 'suppliedStateRegressions': results,
              'limits': [inputs['method'],
                  'Only the three supplied states are newly executed; the four midpoint controls come from the digest-checked stance replay.',
                  'The walking case starts a command; the crouch cases start at the supplied half-command fraction without resetting the marker.',
                  'Stance flags, processed cap, getter speed, prior wish, cache state, marker and command fractions are supplied.',
                  'No claim that the native game produced the preceding trainer stance ramp or complete trajectory.',
                  'Derived displacement is the existing uncollided midpoint diagnostic; collision and position publishing remain outside the replay.'],
              'status': 'passed'}
    args.out.mkdir(parents=True, exist_ok=False)
    raw = {**result, 'portableStaticProof': static_proof, 'readLedger': n.reads,
           'memoryAccessLedger': [{'operation': op, 'address': hex(at), 'bytes': size, 'count': count}
                                  for (op, at, size), count in sorted(n.memory_accesses.items())]}
    raw_path = args.out / 'native.json'
    raw_path.write_text(json.dumps(raw, indent=2, allow_nan=False) + '\n')
    result['sourceNativeReportSha256'] = digest(raw_path)
    compact = args.out / 'regressions.json'
    compact.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(compact), 'sha256': digest(compact), 'nativeSha256': digest(raw_path),
                      'regressions': len(results), 'midpointControls': len(midpoints),
                      'guardCounts': n.memory_counts, 'status': 'passed',
                      'results': [{'id': r['id'], 'velocity': r['nativeVelocityAfter'],
                                   'displacement': r['nativeDerivedDisplacement'],
                                   'comparison': r['comparison']} for r in results]}))


if __name__ == '__main__':
    main()
