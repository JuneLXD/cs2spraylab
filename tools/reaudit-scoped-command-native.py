#!/usr/bin/env python3
"""Small command-duration replay using the unchanged, guarded scoped oracle."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scoped', ROOT / 'reaudit-scoped-awp-native/oracle.py')
scoped = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scoped)
assert scoped.digest(Path(spec.origin)) == '3ef80ff86342ddc0d0f07eb13388f89160eb96fa868fba148ebf6e223d86eacb'

parser = argparse.ArgumentParser()
parser.add_argument('--binary', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
assert not args.output.exists()
sys.path.insert(0, str(scoped.GROUND))
from proof import verify
proof = verify(args.binary.resolve(), scoped.GROUND / 'proof-manifest.json')
scope = scoped.verify_scope_join()
scoped.v1.BINARY = args.binary.resolve()
n = scoped.Native()
cases = []
for fixture in scoped.fixtures():
    for command in fixture['commands']:
        command['extraBoundaries'] = []
    n.configure(fixture)
    sequence = scoped.combined.replay(n, fixture, 'nearest-gradual')
    x = z = 0
    rows = []
    for row in sequence['rows']:
        x += row['derivedUncollidedDisplacement']['x']
        z += row['derivedUncollidedDisplacement']['y']
        state = row.get('afterCommandHandoff', row['afterWishCopy'])
        rows.append({'time': (row['command'] - 1 + row['endFraction']) / 64,
            'side': row['currentWish']['x'] / fixture['suppliedSpeed'],
            'forward': -row['currentWish']['y'] / fixture['suppliedSpeed'],
            'velocity': {'x': row['afterPostHelper']['speedX'], 'z': row['afterPostHelper']['speedY']},
            'position': {'x': x, 'z': z},
            'friction': {'active': state['stashActive'], 'savedFraction': state['savedFraction'],
                'storedSpeed': state['storedSpeed'], 'commandMarked': state['commandMarker'],
                'previousWish': {'x': state['previousWish']['x'], 'z': state['previousWish']['y']}}})
    cases.append({key: fixture[key] for key in ['id', 'zoomLevel', 'stance', 'weaponSpeed', 'suppliedSpeed']}
        | {'initial': fixture['initialState'], 'origin': 0, 'rows': rows})
assert len(cases) == 30 and sum(len(c['rows']) for c in cases) <= 500
report = {'schema': 'spraylab.scoped-command-fixture.v1', 'serverSha256': scoped.v1.SHA,
    'generatorSha256': scoped.digest(Path(__file__)), 'oracleSha256': scoped.digest(Path(spec.origin)),
    'staticProof': proof, 'scopeJoin': scope, 'cases': cases,
    'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts},
    'limits': ['Supplied native command boundaries, processed wish, stance and scoped cap.',
        'No physical input latency, collision or full game scope transition is executed.']}
args.output.write_text(json.dumps(report, separators=(',', ':'), allow_nan=False) + '\n')
print(json.dumps({'cases': len(cases), 'rows': sum(len(c['rows']) for c in cases),
    'sha256': scoped.digest(args.output)}))
