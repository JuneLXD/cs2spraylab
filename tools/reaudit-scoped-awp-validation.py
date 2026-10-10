#!/usr/bin/env python3
"""Verify final scoped-AWP source, native comparison, fixture and check identities."""
import argparse
import hashlib
import json
import re
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--repo', type=Path, default=Path.cwd())
p.add_argument('--reports', type=Path, required=True)
p.add_argument('--browser', action='append', required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists()

def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

def report(name):
    path = a.reports / name
    assert path.stat().st_size < 16 * 1024 * 1024
    return json.loads(path.read_text())

before = report('trainer-before-002.json')
after = report('trainer-after-002.json')
assert before['baseline'] is True and after['baseline'] is False
assert before['commit'].startswith('5efcfb0')
assert before['nativeReportSha256'] == after['nativeReportSha256'] == '5e908e813f902d790c643eb33e90ac9066f34913fa3821827527f333a955a03a'
assert before['probeSha256'] == after['probeSha256'] == sha(a.repo / 'tools/reaudit-scoped-awp-trainer.mjs')
assert after['summary']['mismatches'] == 0
assert after['summary']['predictionRows'] == 3120
assert after['summary']['primitiveRows'] == 844
assert after['summary']['cases'] == 180
assert before['summary']['predictionMismatches'] == 816
for name, expected in after['sourceHashes'].items():
    assert sha(a.repo / name) == expected, f'Changed bundled source: {name}'
assert set(before['sourceHashes']) == set(after['sourceHashes'])
changed = [name for name in before['sourceHashes'] if before['sourceHashes'][name] != after['sourceHashes'][name]]
assert set(changed) == {'src/range/actor-physics.ts', 'src/range/simulation.ts',
                        'src/range/duel/simulation.ts', 'src/range/weapon-actions.ts'}
controls = 0
for old, new in zip(before['cases'], after['cases']):
    assert [old[k] for k in ['fixtureId', 'engine', 'schedule']] == [new[k] for k in ['fixtureId', 'engine', 'schedule']]
    assert len(old['rows']) == len(new['rows'])
    if [r['actual'] for r in old['rows']] == [r['actual'] for r in new['rows']]:
        controls += 1
    for row in new['rows']:
        if new['engine'] != 'actor':
            assert row['prediction']['error'] <= .00004

fixture_path = a.repo / 'src/range/native-scoped-awp-fixture.json'
fixture = json.loads(fixture_path.read_text())
assert len(fixture['cases']) == 30 and sum(len(c['rows']) for c in fixture['cases']) == 780
assert fixture['nativeInputSha256'] == after['nativeReportSha256']
assert fixture['generatorSha256'] == sha(a.repo / 'tools/reaudit-scoped-awp-fixture.mjs')
logs = {}
for name in ['tsc-final.log', 'units-final.log', 'browser-guided-json-import-attempt.log',
             'browser-guided-rotated-input-attempt.log', *a.browser]:
    path = a.reports / name
    logs[name] = {'sha256': sha(path), 'bytes': path.stat().st_size}
assert (a.reports / 'tsc-final.log').read_text().strip() == ''
units = (a.reports / 'units-final.log').read_text()
match = re.search(r'Tests\s+1 failed \| (\d+) passed \((\d+)\)', units)
assert match and match.groups() == ('2730', '2731')
assert units.count('\n FAIL ') == 1 and 'public/models/ak47.json' in units
browser = []
for name in a.browser:
    text = (a.reports / name).read_text()
    passed = re.search(r'(\d+) passed \(', text)
    assert passed and not re.search(r'\d+ failed', text)
    browser.append({'log': name, 'passed': int(passed[1])})
assert sum(item['passed'] for item in browser) == 4
freeze = a.reports / 'browser-freeze.sha256'
for row in freeze.read_text().splitlines():
    expected, name = row.split(maxsplit=1)
    assert sha(a.repo / name) == expected, f'Changed after browser freeze: {name}'
logs['browser-freeze.sha256'] = {'sha256': sha(freeze), 'bytes': freeze.stat().st_size}

tests = ['src/range/scoped-awp-movement.test.ts', 'src/range/actor-physics.test.ts',
         'src/range/changelog.test.ts', 'tests/scoped-awp-movement.spec.ts',
         'tests/awp-rescope.spec.ts', 'tests/stopping-accuracy.spec.ts']
native = a.repo / 'docs/evidence/reaudit-scoped-awp-native.json'
result = {'schema': 'spraylab.scoped-awp-validation.v1',
    'scope': 'Supplied AWP movement at both scopes, actual Range/Duel prediction and firing integration.',
    'typescript': {'exitCode': 0},
    'units': {'passed': 2730, 'failed': 1, 'total': 2731, 'knownFailure': 'Missing public/models/ak47.json fallback fixture'},
    'browser': {'casesPassed': 4, 'runs': browser},
    'nativeEvidenceSha256': sha(native),
    'comparisons': {label: {'report': name, 'sha256': sha(a.reports / name), 'summary': data['summary']}
        for label, name, data in [('before', 'trainer-before-002.json', before), ('after', 'trainer-after-002.json', after)]},
    'unchangedCommittedTrajectories': controls,
    'changedBundledSources': changed,
    'sourceHashes': after['sourceHashes'], 'baselineSourceHashes': before['sourceHashes'],
    'testHashes': {name: sha(a.repo / name) for name in tests},
    'fixture': {'sha256': sha(fixture_path), 'cases': 30, 'rows': 780, 'generatorSha256': fixture['generatorSha256']},
    'logs': logs,
    'previousGroundValidation': {'commit': '98002af',
        'sha256': sha(a.repo / 'docs/evidence/reaudit-ground-friction-validation.json'),
        'note': 'Preserved pass44 snapshot; scoped predicate and prediction propagation are validated here. Ground arithmetic is unchanged.'},
    'caps': {'probesMiB': 512, 'appChecksMiB': 2048, 'swapBytes': 0, 'cpuPercent': 100,
             'workers': 1, 'concurrentHeavyJobs': 1, 'deployPaused': True},
    'priorComparisons': 'Initial -001 comparisons passed the same numerical checks. Final -002 retains each predicted position and uses a detached exact baseline checkout; originals remain archived.',
    'priorBrowserAttempts': [
        'First invocation stopped before test discovery because the new JSON import lacked its required type attribute.',
        'The next fixture moved the locked pointer while scoping, rotating the cardinal strafe. Its trace retains identical predicted/committed vectors (3.751056671142578,-2.095879316329956). Stationary right-button edges preserve the declared yaw; final tests explicitly assert yaw zero.',
        'Only the browser fixture changed after the full unit run; application and unit-test sources remained frozen. No memory kill or cap increase occurred.'],
    'limits': ['Supplied scoped state and native getter values, not full native scope transition or input production.',
               'Position is derived uncollided displacement; other movement modes and full collision remain outside.',
               'Shot tests verify consumption of current movement output, not new native full accuracy-updater execution.']}
a.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': str(a.output), 'sha256': sha(a.output), 'sourceCount': len(after['sourceHashes']),
                  'unchangedCommittedTrajectories': controls, 'status': 'passed'}))
