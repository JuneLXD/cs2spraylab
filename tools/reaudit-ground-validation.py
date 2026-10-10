#!/usr/bin/env python3
"""Summarize saved checks and verify they still describe the current source.

Run serially under the 512MiB audit cap. Large native reports are not loaded.
"""
import argparse
import hashlib
import json
import re
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--reports', type=Path, required=True)
parser.add_argument('--repo', type=Path, default=Path.cwd())
parser.add_argument('--browser', action='append', required=True, help='Passed browser log relative to reports')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert not args.output.exists()

def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def read_report(relative):
    path = args.reports / relative
    assert path.stat().st_size < 32 * 1024 * 1024
    return json.loads(path.read_text()), sha(path)

sources = {}
comparisons = {}
paths = {
    'combined': 'portable-ground-001/combined/trainer-final-002.json',
    'stance': 'portable-stance-001/trainer-final-002.json',
    'release': 'portable-ground-001/release/trainer-final-002.json',
    'engineConsistency': 'stopping-engines-final-002.json',
}
for name, relative in paths.items():
    report, digest = read_report(relative)
    for filename, expected in report['sourceHashes'].items():
        assert sha(args.repo / filename) == expected, f'Changed source: {filename}'
        assert filename not in sources or sources[filename] == expected
        sources[filename] = expected
    if name == 'engineConsistency':
        assert report['summary']['mismatchedTriplets'] == []
    else:
        assert report['summary']['mismatches'] == 0
    comparisons[name] = {'report': relative, 'sha256': digest, 'summary': report['summary'],
                         'probeSha256': report['probeSha256']}
    tool = {'combined': 'reaudit-ground-combined-trainer.mjs', 'stance': 'reaudit-ground-combined-trainer.mjs',
            'release': 'reaudit-ground-release-trainer.mjs', 'engineConsistency': 'reaudit-stopping-engines.mjs'}[name]
    assert sha(args.repo / 'tools' / tool) == report['probeSha256'], f'Changed probe: {tool}'
baseline, digest = read_report('portable-ground-001/combined/trainer-baseline.json')
assert baseline['baseline'] is True and baseline['summary']['thresholdMismatches'] == 164
comparisons['baseline'] = {'commit': 'e99fd0520230b0f8ff88c1d11d02c9bf1d96b5e7',
    'sha256': digest, 'summary': baseline['summary'], 'sourceHashes': baseline['sourceHashes']}

logs = {}
for filename in ['tsc-final-002.log', 'units-final-002.log', *args.browser]:
    path = args.reports / filename
    logs[filename] = {'sha256': sha(path), 'bytes': path.stat().st_size}
assert (args.reports / 'tsc-final-002.log').read_text().strip() == ''
units = (args.reports / 'units-final-002.log').read_text()
match = re.search(r'Tests\s+1 failed \| (\d+) passed \((\d+)\)', units)
assert match and match.groups() == ('2660', '2661'), 'Unexpected unit result'
assert units.count('\n FAIL ') == 1 and 'src/lib/modelAssets.test.ts' in units
assert 'public/models/ak47.json' in units
browser = []
for filename in args.browser:
    contents = (args.reports / filename).read_text()
    passed = re.search(r'(\d+) passed \(', contents)
    assert passed and not re.search(r'\d+ failed', contents), f'Browser failure: {filename}'
    browser.append({'log': filename, 'passed': int(passed[1])})
freeze = args.reports / 'browser-freeze.sha256'
for row in freeze.read_text().splitlines():
    digest, filename = row.split(maxsplit=1)
    assert sha(args.repo / filename) == digest, f'Changed after browser freeze: {filename}'
logs['browser-freeze.sha256'] = {'sha256': sha(freeze), 'bytes': freeze.stat().st_size}
tests = ['src/range/ground-friction.test.ts', 'src/range/ground-friction-stop.test.ts',
    'src/range/ground-counter.test.ts', 'src/range/stopping-accuracy.test.ts', 'src/range/actor-contact.test.ts',
    'src/range/native-movement.test.ts', 'src/range/simulation.test.ts', 'src/range/duel/arena-index.test.ts',
    'src/range/view-animation.test.ts', 'src/range/changelog.test.ts', 'tests/stopping-accuracy.spec.ts',
    'tests/glock-timing.spec.ts', 'tests/view-punch.spec.ts']
evidence = sorted(p for p in (args.repo / 'docs/evidence').glob('reaudit-ground-*.json')
                  if p.resolve() != args.output.resolve())
result = {'schema': 'spraylab.ground-friction-validation.v1',
    'scope': 'Current supplied native stopping/counter/cap/work/accuracy proof and actual Range/Duel integration for seven common weapons.',
    'typescript': {'exitCode': 0},
    'units': {'passed': 2660, 'failed': 1, 'total': 2661,
              'knownFailure': 'Missing public/models/ak47.json fallback fixture'},
    'browser': {'casesPassed': sum(item['passed'] for item in browser), 'runs': browser},
    'comparisons': comparisons, 'sourceHashes': sources,
    'testHashes': {p: sha(args.repo / p) for p in tests},
    'evidenceHashes': {str(p.relative_to(args.repo)): sha(p) for p in evidence}, 'logs': logs,
    'caps': {'nativeProbesMiB': 512, 'appChecksMiB': 2048, 'swapBytes': 0, 'cpuPercent': 100, 'workers': 1,
             'concurrentHeavyJobs': 1, 'deployPausedDuringChecks': True},
    'priorAttempts': {
        'focused004': '301 passed, four ideal-double midpoint/cap assertions failed; independently checked native outputs replaced the assumptions.',
        'unitsInitial': '2655 passed, five failed: known missing model, long-dt recursive stack overflow, tagged stop-gate expectation, diagonal rounding, and random-walk net-distance guard.',
        'corrections': 'Iterative bounded-depth segmentation, exact supplied native expectations, and cumulative movement for the arena-index non-vacuity check. Focused250 then full suite repeated.',
        'memory': 'No scope or host OOM during this movement pass; earlier pass41–43 contained Duel browser cap incident is retained in its separate validation ledger.'},
    'limits': ['Supplied-state native replay, not full command/collision or physical input latency parity.',
               'Native accuracy normalization/zero branch only; base spread and other penalties remain.',
               'Variable surfaces, full mode transitions and upstream stance/tag/input production remain partial.']}
args.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'output': str(args.output), 'sha256': sha(args.output),
                  'sourcesChecked': len(sources), 'browserCases': result['browser']['casesPassed'], 'status': 'passed'}))
