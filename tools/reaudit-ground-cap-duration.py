#!/usr/bin/env python3
"""Supplied moving AWP cap state at three durations; not live rescope replay."""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GROUND = ROOT / 'reaudit-ground-friction-native'
SCOPED = ROOT / 'reaudit-scoped-awp-native'
sys.path.insert(0, str(GROUND))
spec = importlib.util.spec_from_file_location('frozen_scoped', SCOPED / 'oracle.py')
scoped = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scoped)
assert scoped.digest(SCOPED / 'oracle.py') == '3ef80ff86342ddc0d0f07eb13388f89160eb96fa868fba148ebf6e223d86eacb'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    assert not args.output.exists()
    from proof import verify
    proof = verify(args.binary.resolve(), GROUND / 'proof-manifest.json')
    scope_join = scoped.verify_scope_join()
    scoped.v1.BINARY = args.binary.resolve()
    n, cases = scoped.Native(), []
    for zoom in (1, 2):
        for stance, previous, cap in [('stand', 200, 100), ('walk', 104, 52)]:
            for fraction in (.25, .5, 1):
                fixture = {'id': f'zoom{zoom}-{stance}-duration{fraction:g}', 'stance': stance,
                           'weaponSpeed': 100, 'suppliedSpeed': cap, 'zoomLevel': zoom, 'zoomLevels': 2,
                           'initialState': scoped.v2.seed(previous, prior=(previous, 0)),
                           'commands': [scoped.v2.command(end=fraction, wish=(cap, 0), finish=fraction == 1)]}
                n.configure(fixture)
                sequence = scoped.combined.replay(n, fixture, 'nearest-gradual')
                assert len(sequence['rows']) == 1
                cases.append({'fixture': fixture, 'native': sequence['rows'][0]})
    report = {'schema': 'cs2.awp-cap-duration.v1', 'probeSha256': scoped.digest(Path(__file__)),
              'serverSha256': scoped.v1.SHA, 'staticProof': proof, 'scopeJoin': scope_join,
              'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts}, 'cases': cases,
              'limits': ['Supplied pre-cap velocity and new scope/cap, not an actual native rescope command.',
                         'The native command producer is not executed; this isolates duration sensitivity.',
                         'No justification for a universal pre-clamp, delay or simulation-rate change.']}
    args.output.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps([{'id': c['fixture']['id'], 'dt': c['native']['duration'],
                       'stopped': c['native']['nativeStopGate']['taken'],
                       'speed': c['native']['afterPostHelper']['speedX']} for c in cases]))


if __name__ == '__main__':
    main()
