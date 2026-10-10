#!/usr/bin/env python3
"""Two supplied-state cap/diagonal regressions using unchanged native ranges.

This executes one segment per case, not the preceding native trajectory or
tagging pipeline. Run serially under MemoryMax=512M / swap0 / CPUQuota=100%.
"""
import argparse
import hashlib
import importlib.util
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BASE = ROOT / 'stance_regressions.py'
BASE_SHA = '0dccc2e7101f1f0097815945c028a01225e0582074d337c72246673b3309e5f5'
INPUT_SHA = '26c0a7f1028d0207790a887f779f7d980b4d636a1be27f0f12c7615a0389b61b'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


assert digest(BASE) == BASE_SHA
spec = importlib.util.spec_from_file_location('preserved_stance_regressions', BASE)
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)
stance = base.stance


def projection_diagnostic(row):
    """Authored float32 diagnostic from native pre-helper values, not a call."""
    f = stance.f32
    before = row['afterPreHelper']
    remaining = f(f(1 / 64) - f(f(.5) * row['duration']))
    x = f(f(before['accelerationWork']['x'] * remaining) + before['speedX'])
    y = f(f(before['accelerationWork']['y'] * remaining) + before['speedY'])
    # Flat supplied state; native final cap already clears vertical work.
    norm = f(math.sqrt(f(f(f(y * y) + 0) + f(x * x))))
    return {'kind': 'Authored float32 diagnostic from native pre-helper state; actual branch is nativeStopGate.taken',
            'remainingFactor': remaining, 'projectedXY': [x, y], 'projectedXYZNorm': norm,
            'strictBelowOne': norm < 1}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--inputs', type=Path, default=ROOT / 'supplied-cap-regression-inputs.json')
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite regression output'
    assert args.inputs.stat().st_size <= 32768 and digest(args.inputs) == INPUT_SHA
    inputs = json.loads(args.inputs.read_text())
    cases = inputs['cases']
    assert [c['id'] for c in cases] == ['running-to-tag-half-215', 'ak-diagonal-one-second']
    static_proof = base.verify(args.binary.resolve(), ROOT / 'proof-manifest.json')
    stance.v1.BINARY = args.binary.resolve()
    n = stance.Native()
    results = []
    for case in cases:
        assert case['stance'] == 'stand' and case['weaponSpeed'] == 215
        assert case['dt'] == 1 / 128
        assert case['beginCommand'] is (case['startFraction'] == 0)
        assert case['finishCommand'] is (case['endFraction'] == 1)
        assert (case['endFraction'] - case['startFraction']) / 64 == case['dt']
        fixture = {'id': case['id'], 'kind': 'supplied-historical-test-state',
                   'stance': case['stance'], 'weaponSpeed': case['weaponSpeed'],
                   'suppliedSpeed': case['suppliedSpeed'], 'suppliedProcessedCap': case['suppliedSpeed'],
                   'initialState': case['initialState'],
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
        native_cache = base.cache_state(native_after)
        assert max(map(abs, velocity_error)) <= base.VELOCITY_EPSILON, (case['id'], 'velocity', velocity_error)
        assert max(map(abs, position_error)) <= base.POSITION_EPSILON, (case['id'], 'position', position_error)
        assert native_cache == case['trainerAfter']['state'], (case['id'], 'cache', native_cache)
        diagnostic = projection_diagnostic(row)
        assert diagnostic['strictBelowOne'] == row['nativeStopGate']['taken']
        results.append({'id': case['id'], 'fixture': fixture,
                        'generatedCommands': sequence['generatedCommands'], 'native': row,
                        'nativeCacheAfter': native_cache, 'nativeVelocityAfter': native_velocity,
                        'nativeDerivedDisplacement': native_position, 'trainerAfter': case['trainerAfter'],
                        'projectionDiagnostic': diagnostic,
                        'derivedEndpointEuclideanNormDouble': math.hypot(*native_velocity),
                        'comparison': {'velocityDifferenceNativeUnitsPerSecond': velocity_error,
                            'derivedPositionDifferenceNativeUnits': position_error,
                            'cacheStateExact': True, 'status': 'passed'}})
    result = {'schema': 'spraylab.native-ground-supplied-cap-regressions.v1',
              'serverSha256': stance.v1.SHA, 'readerSha256': digest(Path(__file__)),
              'preservedRegressionReaderSha256': BASE_SHA, 'stanceReaderSha256': base.STANCE_SHA,
              'suppliedInputsSha256': INPUT_SHA, 'sourceHashes': inputs['sourceHashes'],
              'guardedNativeExecution': True, 'selectedNativeCodeBytes': 7192,
              'addedNativeCodeBytes': 0, 'stancePrivateExtensionBytes': 88, 'newNativeAccessorHooks': 0,
              'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts},
              'mxcsrProfiles': stance.v2.PROFILES, 'mxcsrExecutionResults': n.mxcsr_calls, 'hooks': n.calls,
              'comparisonBounds': {'velocityNativeUnitsPerSecond': base.VELOCITY_EPSILON,
                  'derivedPositionNativeUnits': base.POSITION_EPSILON, 'cacheState': 'Exact',
                  'reason': 'Only trainer SI conversion/subtraction round trips; native float32 endpoint precision is preserved.'},
              'suppliedStateRegressions': results,
              'limits': [inputs['method'],
                  'Exactly two supplied single-segment states; unchanged native ranges, hooks, branches and private spans.',
                  'The half-cap case starts a command; the diagonal case starts at the supplied half-command fraction and finishes afterward.',
                  'Processed cap and tag label are supplied; native tagging application/recovery and upstream cap production are not executed.',
                  'The actual projected-speed branch is nativeStopGate.taken; its numeric projection diagnostic is authored from native pre-helper state.',
                  'The Euclidean endpoint norm is derived in double precision from native float32 components, not a separate native getter result.',
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
                      'regressions': len(results), 'guardCounts': n.memory_counts, 'status': 'passed',
                      'results': [{'id': r['id'], 'velocity': r['nativeVelocityAfter'],
                                   'displacement': r['nativeDerivedDisplacement'],
                                   'nativeStopGateTaken': r['native']['nativeStopGate']['taken'],
                                   'projectionDiagnostic': r['projectionDiagnostic'],
                                   'derivedEndpointEuclideanNormDouble': r['derivedEndpointEuclideanNormDouble'],
                                   'comparison': r['comparison']} for r in results]}))


if __name__ == '__main__':
    main()
