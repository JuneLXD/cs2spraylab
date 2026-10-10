#!/usr/bin/env python3
"""Validate completed reports and produce the compact investigation ledger."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--reports', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert not args.output.exists()
sha = lambda data: hashlib.sha256(data).hexdigest()
canonical = lambda obj: json.dumps(obj, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
native_names = ['native-command.json', 'native-crouch-long.json']
trainer_names = ['live-128-vs-native-command.json', 'held-128-vs-native-command.json',
                 'held-matched-command.json', 'live-crouch-long.json', 'held-crouch-matched.json']
records, reports = {}, {}
for name in native_names + trainer_names + ['cap-duration.json', 'preparation-prefix.json']:
    data = (args.reports / name).read_bytes()
    report = reports[name] = json.loads(data)
    record = records[name] = {'sha256': sha(data), 'probeSha256': report['probeSha256']}
    if name in native_names:
        assert report['guardedNativeExecution'] and report['memoryGuard']['unexpectedAccesses'] == 0
        record.update(fixtures=len(report['fixtures']), rows=sum(len(s['rows']) for s in report['sequences']),
                      executionContentSha256=sha(canonical({key: report[key] for key in
                        ['serverSha256', 'fixtures', 'sequences', 'memoryGuard', 'hooks']})))
    elif name in trainer_names:
        assert report['nativeSha256'] in [records[n]['sha256'] for n in native_names]
        for source, expected in report['sourceHashes'].items():
            assert sha((Path(report['repo']) / source).read_bytes()) == expected, source
        record.update(summary=report['summary'], sourceHashes=report['sourceHashes'])
for name in ['held-matched-command.json', 'held-crouch-matched.json']:
    assert reports[name]['summary']['mismatchingCases'] == 0
for name in ['live-128-vs-native-command.json', 'held-128-vs-native-command.json']:
    report = reports[name]
    assert report['summary']['cases'] == 63 and report['summary']['rows'] == 11088
    # Real Range/Duel and the shared actor must agree independently.
    for case in report['cases']:
        actor = next(c for c in report['cases'] if c['fixtureId'] == case['fixtureId'] and c['engine'] == 'actor')
        assert case['rows'] == actor['rows']
table = []
for live in reports['live-128-vs-native-command.json']['cases']:
    if live['engine'] != 'range':
        continue
    held = next(c for c in reports['held-128-vs-native-command.json']['cases']
                if c['fixtureId'] == live['fixtureId'] and c['engine'] == 'range')
    table.append({'weapon': live['weapon'], 'stance': live['stance'], 'cap': live['suppliedCap'],
                  'native': live['native'], 'live': live['trainer'], 'held128': held['trainer']})
cap = reports['cap-duration.json']
assert len(cap['cases']) == 12 and cap['memoryGuard']['unexpectedAccesses'] == 0
duration_cases = []
for case in cap['cases']:
    fixture, row = case['fixture'], case['native']
    assert row['nativeStopGate']['taken'] == (row['duration'] == 1 / 128)
    duration_cases.append({'id': fixture['id'], 'duration': row['duration'],
                           'stopped': row['nativeStopGate']['taken'], 'velocity': row['afterPostHelper']['speedX']})
long_crouch = [{key: c[key] for key in ['weapon', 'native', 'trainer']}
               for c in reports['live-crouch-long.json']['cases'] if c['engine'] == 'range']
result = {'schema': 'spraylab.ground-start-stop-ledger.v1', 'probeSha256': sha(Path(__file__).read_bytes()),
          'status': 'Investigation complete for supplied fixed-state curves; command integration remains held.',
          'records': records, 'metrics': table, 'longCrouch': long_crouch, 'capDuration': duration_cases,
          'validation': {'actualEnginesAgree': True, 'matchedSegmentsAgree': True, 'applicationSourcesUnchanged': True},
          'resourceLimits': {'memoryMax': '512M', 'memorySwapMax': 0, 'cpuQuota': '100%',
            'failedExpandedRuns': 2, 'reason': 'Scope-only OOM; partial outputs excluded; no cap increase or production deployment.'},
          'limits': ['Native slices execute guarded instructions; outer inputs/command schedules and stance caps are supplied.',
            'All reported thresholds are first observations on the shared 15.625 ms grid, not physical input latency or sub-command crossing times.',
            'Zero movement accuracy contribution is distinct from complete stopping.',
            'Matching 64 Hz command segments in this diagnostic is not an implemented simulation-rate change.',
            'Actual moving-rescope command/cap/weapon-event association and collisions remain unverified.']}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'outputSha256': sha(args.output.read_bytes()), 'status': 'passed',
                  'metrics': len(table), 'longCrouch': long_crouch}))
