#!/usr/bin/env python3
"""Bind actual transition measurements to source identities; no native parity assertion."""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--repo', type=Path, required=True)
p.add_argument('--reports', type=Path, required=True)
p.add_argument('--out', type=Path, required=True)
a = p.parse_args()
assert not a.out.exists()

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def read(name):
    path = a.reports / name
    assert path.stat().st_size < 16 * 1024 * 1024
    return json.loads(path.read_text())

before = read('trainer-baseline-normal-003.json')
after = read('trainer-candidate-normal-003.json')
diagnostic_before = read('trainer-baseline-diagnostic-003.json')
diagnostic_after = read('trainer-candidate-diagnostic-003.json')
shots_before = read('shots-baseline-001.json')
shots_after = read('shots-candidate-001.json')
probe = a.repo / 'tools/reaudit-awp-movement-phase-trainer.mjs'
assert before['probeSha256'] == after['probeSha256'] == sha(probe)
assert before['commit'].startswith('e99fd05') and after['commit'].startswith('4bb6223')
for name, expected in after['sourceHashes'].items():
    assert sha(a.repo / name) == expected, name
validation = json.loads((a.repo / 'docs/evidence/reaudit-scoped-awp-validation.json').read_text())
assert after['sourceHashes'] == validation['sourceHashes']
for label, report in [('baseline', before), ('candidate', after),
                      ('baseline-diagnostic', diagnostic_before), ('candidate-diagnostic', diagnostic_after)]:
    assert report['probeSha256'] == sha(probe)
    assert report['sourceHashes'] == (before if label.startswith('baseline') else after)['sourceHashes']
    assert report['zeroTimeDiagnostic'] == label.endswith('diagnostic')
    assert report['summary']['cases'] == 32 and len(report['pairs']) == 16
    for pair in report['pairs']:
        first = pair['stages'][0]
        assert first['stage'] == 'before-arrival'
        assert first['velocityDifference'] == first['positionDifference'] == 0
        if pair['empty']:
            assert all(s['velocityDifference'] == s['positionDifference'] == 0 for s in pair['stages'])
    for r in report['cases'][::2]:
        d = next(c for c in report['cases'] if c['engine'] == 'duel' and all(c[k] == r[k] for k in ['zoom', 'walk', 'empty', 'schedule']))
        assert r['engine'] == 'range'
        assert [(x['time'], x['velocity'], x['position']) for x in r['rows'] if x['stage'] == 'approach'] == [
            (x['time'], x['velocity'], x['position']) for x in d['rows'] if x['stage'] == 'approach']
    if label.startswith('candidate'):
        for pair in report['pairs']:
            if not pair['empty']:
                arrival = next(s for s in pair['stages'] if s['stage'] == 'arrival')
                assert arrival['rangeZoomUsed'] == [pair['zoom']] and arrival['duelZoomUsed'] == [0]

shot_probe = a.repo / 'tools/reaudit-awp-rescope-shot.mjs'
for label, shots, movement in [('baseline', shots_before, before), ('candidate', shots_after, after)]:
    assert shots['sourceHashes'] == movement['sourceHashes']
    assert shots['probeSha256'] == sha(shot_probe)
    assert len(shots['cases']) == 16
    for case in shots['cases']:
        original = next(c for c in movement['cases'] if not c['empty'] and all(c[k] == case[k] for k in ['zoom', 'walk', 'schedule', 'engine']))
        arrival = next(row for row in original['rows'] if row['stage'] == 'arrival')
        assert arrival['velocity'] == case['beforeShot']['velocity']
        assert len(case['observed']) == 1
        assert case['beforeShot']['ammo'] - case['afterShot']['ammo'] == 1
assert sum(c['observed'][0]['movementRatio'] == 0 for c in shots_before['cases']) == 0
assert sum(c['observed'][0]['movementRatio'] == 0 for c in shots_after['cases']) == 4

native_path = a.repo / 'docs/evidence/reaudit-awp-movement-phase-native.json'
native = json.loads(native_path.read_text())
assert native['status'] == 'passed'
result = {'schema': 'spraylab.awp-movement-phase-comparison.v1',
    'status': 'measured-unresolved-release-held', 'gameplayChangedByThisPass': False,
    'nativeEvidenceSha256': sha(native_path), 'probeSha256': sha(probe),
    'summaryGeneratorSha256': sha(Path(__file__)),
    'applicationValidationSha256': sha(a.repo / 'docs/evidence/reaudit-scoped-awp-validation.json'),
    'sourceHashes': after['sourceHashes'],
    'reports': {label: {'commit': data['commit'], 'sha256': sha(a.reports / name), 'summary': data['summary'], 'pairs': data['pairs']}
        for label, data, name in [('baseline', before, 'trainer-baseline-normal-003.json'), ('candidate', after, 'trainer-candidate-normal-003.json'),
            ('baseline-diagnostic', diagnostic_before, 'trainer-baseline-diagnostic-003.json'),
            ('candidate-diagnostic', diagnostic_after, 'trainer-candidate-diagnostic-003.json')]},
    'shots': {label: {'commit': data['commit'], 'sha256': sha(a.reports / name), 'cases': data['cases']}
        for label, data, name in [('baseline', shots_before, 'shots-baseline-001.json'), ('candidate', shots_after, 'shots-candidate-001.json')]},
    'shotProbeSha256': sha(shot_probe),
    'checks': {'pairedApproachTracesAgree': True, 'emptyControlsAgree': 8,
               'candidateLoadedPairsUseOppositeScopeStateAtArrival': 8, 'validatedApplicationSourcesUnchanged': True,
               'normalAndDiagnosticContinuationsIndependent': True, 'freshShotsPerVersion': 16,
               'baselineZeroMovementShots': 0, 'candidateZeroMovementShots': 4},
    'limits': after['limits'] + ['The native proof orders whole commands; this comparison does not associate a trainer half-step with a native command.',
        'Normal and diagnostic continuations are separate; only diagnostic reports include an extra zero-time call before the next half-tick.',
        'Native upstream speed-cap construction and scope/input lifecycle remain unexecuted.'],
    'caps': {'memoryMiB': 512, 'swapBytes': 0, 'cpuPercent': 100, 'concurrentHeavyJobs': 1},
    'delivery': 'Hold the prepared movement batch: native fixed-state arithmetic does not establish native command association for abrupt scope caps or the new zero-movement shot states.',
    'previousReports': 'The -001/-002 traces and probes remain archived. Their next-half-tick rows follow an explicit zero-time diagnostic; they are not the independent normal continuation.'}
a.out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'baseline': before['summary'], 'candidate': after['summary'], 'sha256': sha(a.out)}))
for old, new in zip(before['pairs'], after['pairs']):
    if new['zoom'] == 1 and not new['empty']:
        print(json.dumps({'walk': new['walk'], 'schedule': new['schedule'],
            'baselineArrival': old['stages'][1], 'candidateArrival': new['stages'][1]}))
