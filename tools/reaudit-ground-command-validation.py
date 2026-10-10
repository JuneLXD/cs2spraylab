#!/usr/bin/env python3
"""Verify the final serialized timing checks and pin their exact application sources."""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--reports', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
names = ['timing-final-command.json', 'timing-final-crouch.json', 'timing-final-phase.json',
    'timing-final-shots.json']
reports = {name: json.loads((args.reports / name).read_text()) for name in names}
sources = {}
for report in reports.values():
    for name, expected in report['sourceHashes'].items():
        assert digest(repo / name) == expected, name
        assert sources.get(name, expected) == expected
        sources[name] = expected
curves = [reports[n]['summary'] for n in names[:2]]
assert sum(c['cases'] for c in curves) == 84
assert sum(c['rows'] for c in curves) == 16128
assert all(c['mismatchingCases'] == 0 for c in curves)
phase = reports[names[2]]['summary']
assert phase['cases'] == 32 and phase['pairs'] == 16
assert all(value == 0 for key, value in phase.items() if key.startswith('max'))
shots = reports[names[3]]['cases']
assert len(shots) == 16
assert all(c['observed'][0]['movementRatio'] > .9 for c in shots)
for a, b in zip(shots[::2], shots[1::2]):
    assert a['engine'] == 'range' and b['engine'] == 'duel'
    assert a['beforeShot'] == b['beforeShot']
    assert a['observed'][0]['movementRatio'] == b['observed'][0]['movementRatio']
unit = (args.reports / 'timing-unit-final.log').read_text()
assert 'modelAssets.test.ts' in unit and re.search(r'Tests\s+1 failed \| \d+ passed', unit)
assert (args.reports / 'timing-tsc-final.log').read_text() == ''
browser_names = ['timing-browser-stop.log', 'timing-browser-scope-range.log',
    'timing-browser-scope-duel.log', 'timing-browser-rescope.log']
for name in browser_names:
    log = (args.reports / name).read_text()
    assert re.search(r'1 passed', log) and not re.search(r'\d+ failed', log), name
files = names + ['timing-unit-final.log', 'timing-tsc-final.log'] + browser_names
fixtures = ['src/range/native-ground-command-fixture.json', 'src/range/native-scoped-command-fixture.json',
    'src/range/native-scoped-awp-fixture.json']
result = {'schema': 'spraylab.ground-command-validation.v1', 'status': 'passed',
    'sourceHashes': sources, 'artifacts': {name: digest(args.reports / name) for name in files},
    'fixtures': {name: digest(repo / name) for name in fixtures},
    'curves': curves, 'phase': phase, 'freshShots': len(shots), 'zeroMovementShots': 0,
    'unitResult': re.search(r'Tests\s+1 failed \| \d+ passed[^\n]*', unit).group(0),
    'knownFailure': 'Missing pre-existing public/models/ak47.json fallback asset.',
    'typescript': 'passed', 'chromiumCases': 4,
    'resources': {'testsMemoryMax': '2GiB', 'probesMemoryMax': '512MiB', 'swapMax': 0,
        'workers': 1, 'cpuQuota': '100%', 'autoDeploy': 'paused during validation'},
    'limits': ['Native slices use supplied dry-ground state, caps and input command boundaries.',
        'Intermediate render positions are predictions, not new native samples.',
        'Rescope shots compare actual trainer engines; no full native moving-rescope shot is executed.',
        'Generated bot steering retains its existing explicit segments.',
        'No physical input latency, native collision parity or new runtime capture claim.']}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'status': 'passed', 'sourceFiles': len(sources), 'curves': 84, 'rows': 16128,
    'sha256': digest(args.output)}))
