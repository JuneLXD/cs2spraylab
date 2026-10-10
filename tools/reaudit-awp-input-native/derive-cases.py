"""Reproducible branch-table examples derived from the checked native dispatcher.

This is a small decision model, not execution of native instructions or a model
of physical input masks. All unmodeled player/weapon gates are assumed to allow
the ordinary loaded AWP path, with other action buttons absent.
"""
import argparse, hashlib, itertools, json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--proof', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert not args.output.exists(), 'Refusing to overwrite derived evidence'
proof = json.loads(args.proof.read_text())
assert proof['concreteClass'] == 'CWeaponAWP'
assert proof['serverSha256'] == 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'

def dispatch(primary_active, primary_ready, prior_shot, secondary_active, secondary_ready, debounce):
    if primary_active and primary_ready:
        return {'dispatch': 'primary', 'fires': not prior_shot, 'secondaryCalls': 0, 'secondaryConsumeRequested': False}
    if secondary_active and secondary_ready:
        return {'dispatch': 'secondary', 'fires': False, 'secondaryCalls': 1, 'secondaryConsumeRequested': debounce > 0}
    return {'dispatch': 'none', 'fires': False, 'secondaryCalls': 0, 'secondaryConsumeRequested': False}

table = []
names = ['primaryActive', 'primaryReady', 'priorShot', 'secondaryActive', 'secondaryReady', 'debounce']
for values in itertools.product([False, True], repeat=6):
    row = dict(zip(names, values)); result = dispatch(*values)
    # Independently state the key priority predicate, including rejected shots.
    assert (result['dispatch'] == 'primary') == (row['primaryActive'] and row['primaryReady'])
    assert result['secondaryCalls'] == int(not (row['primaryActive'] and row['primaryReady']) and row['secondaryActive'] and row['secondaryReady'])
    table.append({'input': row, 'result': result})

examples = [
    ('both-ready-fresh-primary', (True, True, False, True, True, False), 'primary', True),
    ('both-ready-semi-rejection', (True, True, True, True, True, False), 'primary', False),
    ('held-primary-cooldown-allows-secondary', (True, False, True, True, True, False), 'secondary', False),
    ('secondary-before-readiness', (False, True, False, True, False, True), 'none', False),
    ('secondary-ready-repeat-enabled', (False, True, False, True, True, False), 'secondary', False),
    ('secondary-ready-debounce-enabled', (False, True, False, True, True, True), 'secondary', False),
    ('released-primary-same-invocation', (False, True, True, True, True, False), 'secondary', False),
    ('released-secondary-before-ready', (False, True, False, False, True, False), 'none', False),
]
named = []
for label, values, branch, fires in examples:
    result = dispatch(*values)
    assert result['dispatch'] == branch and result['fires'] == fires
    named.append({'name': label, 'input': dict(zip(names, values)), 'result': result})

report = {'method': __doc__, 'sourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'proofSha256': hashlib.sha256(args.proof.read_bytes()).hexdigest(),
    'cases': len(table), 'namedExamples': named, 'truthTable': table,
    'notRuntime': True, 'limits': [
        'Inputs are already evaluated native activity/readiness booleans, not physical browser buttons.',
        'Fresh primary acceptance assumes all omitted gates allow firing; primary priority itself does not require acceptance.',
        'No input-mask state evolution, natural reachability of every readiness combination, repeat cadence, or cooldown/FOV timing is modeled.',
        'The debounce result is a consume request at the ordinary scope thunk, not proof of its lifetime through future commands.'
    ]}
args.output.parent.mkdir(parents=True, exist_ok=True)
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'truthTableCases': len(table), 'namedExamples': len(named)}))
