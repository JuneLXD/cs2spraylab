"""Replay bounded native bob using raw versus selected evaluated velocity.

This compares native input hypotheses, not trainer before/after behavior.
Reads immutable capture windows; never opens a running process.
"""
import collections
import hashlib
import json
import runpy
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent / 'native-audit'
fixture_path = REPO / 'docs/evidence/reaudit-bob-cache-fixture.json'
fixture_bytes = fixture_path.read_bytes()
fixture = json.loads(fixture_bytes)
probe = REPO / 'tools/reaudit-viewmodel-bob-native.py'
ns = runpy.run_path(str(probe))


def choose_velocity(row):
    c = row['interpolationContext']
    flags = row['velocityHistoryFlags'][0]
    index = None
    if row['velocityInterpolationEnabled']:
        assert row['moveType'] != 5, 'Unmodeled parent/physics branch'
        if c['selector'] == -1:
            index = 0
        elif c['selector'] == 1 and c['stage'] == 1:
            index = 1 if flags & 0x20 else 0
        elif c['selector'] == 0:
            if c['stage'] == 1:
                index = 0
            elif flags & 0x20:
                index = 1
    if index is None:
        return row['storedVelocity'], 'stored'
    requested = c['times'][(flags >> 7) & 1]
    assert row['velocityCacheTimes'][index] == requested, 'Need history evaluation'
    return row['velocityCache' + str(index)], 'cache' + str(index)


def invoke(previous, row, velocity):
    for offset, key in [(0x12d4, 'cycle'), (0x12d8, 'smoothVelocity'),
                        (0x12e8, 'bob'), (0x12f4, 'animationBob'), (0x131c, 'air')]:
        value = previous[key]
        ns['u'].mem_write(ns['state'] + offset,
                          ns['pack'](value if isinstance(value, list) else [value]))
    result = ns['step'](row['frameDelta'], velocity, [0, 0, 0],
                        bool(row['flags'] & 1), 0, row['currentTime'],
                        row['pawnTransform'][4:8])
    errors = {}
    for key, alias in [('cycle', 'cycle'), ('smoothVelocity', 'velocity'),
                       ('bob', 'bob'), ('animationBob', 'animationBob'), ('air', 'air')]:
        actual, expected = row[key], result[alias]
        if not isinstance(actual, list):
            actual, expected = [actual], [expected]
        errors[key] = max(abs(a - b) for a, b in zip(actual, expected))
    return errors


results = []
for capture in fixture['captures']:
    name = capture['capture']
    unique = [dict(zip(fixture['fields'], row)) for row in capture['rows']]
    pairs = []
    for previous, row in zip(unique, unique[1:]):
        velocity, branch = choose_velocity(row)
        pairs.append({
            'frame': row['frame'], 'frameGap': row['frame'] - previous['frame'],
            'time': row['currentTime'], 'dt': row['frameDelta'],
            'selectedBranch': branch,
            'storedVsSelected': max(abs(a-b) for a,b in zip(row['storedVelocity'], velocity)),
            'storedErrors': invoke(previous, row, row['storedVelocity']),
            'selectedErrors': invoke(previous, row, velocity),
        })
    def summarize(subset):
        return {
            'pairs': len(subset),
            'branches': dict(collections.Counter(r['selectedBranch'] for r in subset)),
            'maxStoredVsSelectedUnitsPerSecond': max(r['storedVsSelected'] for r in subset),
            **{kind: {'maxError': {key: max(r[kind][key] for r in subset)
                                    for key in subset[0][kind]},
                      'allFieldsWithin1e4': sum(max(r[kind].values()) <= 1e-4 for r in subset),
                      'allFieldsExact': sum(max(r[kind].values()) == 0 for r in subset)}
               for kind in ['storedErrors', 'selectedErrors']},
        }
    results.append({'capture': name, 'snapshotSha256': capture['snapshotSha256'],
                    'rawRows': capture['rawRows'], 'hudStates': len(unique),
                    'all': summarize(pairs),
                    'consecutiveFrames': summarize([r for r in pairs if r['frameGap'] == 1]),
                    'frameGaps': dict(collections.Counter(r['frameGap'] for r in pairs)),
                    'rows': pairs})
report = {'method': __doc__, 'clientSha256': fixture['clientSha256'],
          'probeSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'nativeOracleSha256': hashlib.sha256(probe.read_bytes()).hexdigest(),
          'fixtureSha256': hashlib.sha256(fixture_bytes).hexdigest(),
          'productionChanged': False, 'captures': results,
          'limits': ['After-update polling is not an invocation trace; frame gaps are explicit.',
                     'Previous native state is seeded for each comparison. This is not a free-running trainer replay.',
                     'Both windows have similar observed HUD cadence despite different requested FPS caps.',
                     'Only ordinary unscoped AK, captured scene transform, cache-hit path and finite values tested.',
                     'Correct consumed cache does not reconstruct its interpolation history or the scene-angle writer.']}
out = ROOT / 'reports/reaudit-bob-cache-portable.json'
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({**{k:v for k,v in report.items() if k != 'captures'},
                  'captures': [{k:v for k,v in r.items() if k != 'rows'} for r in results]}, indent=2))
