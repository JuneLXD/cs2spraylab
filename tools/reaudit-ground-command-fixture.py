#!/usr/bin/env python3
"""Compact the two completed, hash-pinned native command captures for unit tests."""
import hashlib
import json
import sys
from pathlib import Path

root, output = map(Path, sys.argv[1:])
inputs = {'native-command.json': '6d55402a9ad3426fba1bdabe8b5a241f44486039e68302e33630746c9a909f66',
    'native-crouch-long.json': 'e115a32141c3af8fbb6703f3bcdf3472f42f7fb3267266d329212b407368eadd'}
cases = []
for filename, expected in inputs.items():
    data = (root / filename).read_bytes()
    assert hashlib.sha256(data).hexdigest() == expected
    report = json.loads(data)
    assert report['memoryGuard']['unexpectedAccesses'] == 0
    for fixture, sequence in zip(report['fixtures'], report['sequences']):
        assert fixture['id'] == sequence['fixtureId']
        x = z = 0
        rows = []
        for row in sequence['rows']:
            x += row['derivedUncollidedDisplacement']['x']
            z += row['derivedUncollidedDisplacement']['y']
            rows.append([(row['command'] - 1 + row['endFraction']) / 64,
                row['currentWish']['x'] / fixture['suppliedSpeed'],
                -row['currentWish']['y'] / fixture['suppliedSpeed'],
                row['afterPostHelper']['speedX'], row['afterPostHelper']['speedY'], x, z])
        cases.append({'id': fixture['id'] + ('-long' if 'long' in filename else ''),
            'weapon': {'awp-unscoped': 'awp', 'm4a1-s': 'm4a1s', 'usp-s': 'usp'}.get(fixture['weaponLabel'], fixture['weaponLabel']),
            'speed': fixture['weaponSpeed'], 'stance': fixture['stance'], 'rows': rows})
assert len(cases) == 28 and sum(len(c['rows']) for c in cases) == 5376
with output.open('x') as out:
    json.dump({'schema': 'spraylab.ground-command-fixture.v1', 'inputs': inputs,
        'columns': ['time', 'side', 'forward', 'vx', 'vz', 'x', 'z'], 'cases': cases}, out, separators=(',', ':'))
    out.write('\n')
