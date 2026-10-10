"""Compare retained actual-trainer Glock runs; no simulation/native execution.

Requires the exact same probe and fixture list, a clean bfebff8 baseline, and
the explicit source-change allowlist. Reports processed shot times separately
from the Range-only scheduled timestamps carried by the raw input reports.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--before', type=Path, required=True)
parser.add_argument('--after', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
before, after = [json.loads(p.read_text()) for p in [args.before, args.after]]
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
assert before['commit'] == after['commit'] == 'bfebff89319f90d7451b1dbe4e6cb9f4c9b38b79'
assert before['trackedChanges'] == []
assert before['scriptSha256'] == after['scriptSha256'] == sha(Path(__file__).with_name('reaudit-glock-trainer.mjs'))
assert before['fixtures'] == after['fixtures']
assert before['sourceHashes'].keys() == after['sourceHashes'].keys()
changes = [k for k in before['sourceHashes'] if before['sourceHashes'][k] != after['sourceHashes'][k]]
expected = ['src/range/duel/weapon-state.ts', 'src/range/engine.ts', 'src/range/simulation.ts', 'src/range/weapon-actions.ts',
            'src/range/native-reload-timing.json', 'src/range/sound-events-data.json']
assert sorted(changes) == sorted(expected)


def extract(case):
    transitions = [{'at': round(e['at'], 9), 'burst': e['burst']} for i, e in enumerate(case['events'])
                   if i and e['burst'] != case['events'][i - 1]['burst']]
    return {'shots': [round(s['at'], 9) for s in case['shots']], 'modeTransitions': transitions}


rows = []
for b, a in zip(before['cases'], after['cases'], strict=True):
    assert (b['engine'], b['scenario']) == (a['engine'], a['scenario'])
    rows.append({'engine': a['engine'], 'scenario': a['scenario'], 'before': extract(b), 'after': extract(a)})
assert len(rows) == 24
for scenario in {r['scenario'] for r in rows}:
    pair = [r for r in rows if r['scenario'] == scenario]
    assert len(pair) == 2 and pair[0]['after'] == pair[1]['after'], scenario
for row in rows:
    if row['scenario'].startswith('normal-'): assert row['before'] == row['after']
    if row['scenario'] == 'toggle-immediate-burst': assert row['after']['shots'] == [1, 1.0625, 1.109375]
    if row['scenario'] == 'toggle-immediate-semi': assert row['after']['shots'] == [1]
    if row['scenario'] == 'burst-mid-secondary-held':
        assert row['after']['modeTransitions'] == [{'at': 1.5, 'burst': False}]
    if row['scenario'] == 'primary-then-secondary-held':
        assert row['after']['modeTransitions'] == [{'at': 1.5, 'burst': True}]
report = {'method': __doc__, 'scriptSha256': sha(Path(__file__)), 'probeSha256': before['scriptSha256'],
          'baselineCommit': before['commit'], 'beforeSha256': sha(args.before), 'afterSha256': sha(args.after),
          'sameFixtureAndInputSources': True, 'changedSourceInputs': sorted(changes),
          'otherPatchInputs': 'The integrated isolated checkout also contains the independently audited Deagle reload metadata correction in native-reload-timing.json and sound-events-data.json. Glock data and non-action source inputs are otherwise byte-identical; these scenarios do not reload or render/play audio.',
          'pairedScenarios': 12, 'afterShotAndModeParity': 12, 'unchangedNormalControls': 6,
          'rows': rows, 'limits': ['Actual trainer measurements, not native runtime observations.',
            '128 Hz maximum steps quantize held-input admission; native float32/subtick mask production is not emulated.',
            'Primary-then-secondary fixture uses ordered input edges; the simultaneous Duel command is covered separately in glock-timing.test.ts.']}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'pairedScenarios': 12, 'afterShotAndModeParity': 12, 'unchangedNormalControls': 6}))
