#!/usr/bin/env python3
"""Extend the frozen guarded oracle to full start/release/restart/reverse curves.

No production code changes or extra native hooks. Physical key latency, native
command production, collision and upstream stance caps are outside this replay.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GROUND = ROOT / 'reaudit-ground-friction-native'
sys.path.insert(0, str(GROUND))
spec = importlib.util.spec_from_file_location('frozen_stance', GROUND / 'stance_oracle.py')
stance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stance)
combined, v2, v1, f32 = stance.combined, stance.v2, stance.v1, stance.f32
assert stance.digest(GROUND / 'stance_oracle.py') == 'caba74a0ae3ffb4e32a3d3a5ba329f88aa5ae9a111e36ff4d44590c6e99c3584'


def fixtures(schedule, stance_filter, start_commands):
    result = []
    for weapon, speed in combined.WEAPONS.items():
        for mode, multiplier in [('stand', 1), ('walk', .52), ('crouch', .34)]:
            for phase in ([0, .25, .5, .75] if mode == 'stand' else [0, .25]):
                for diagonal in ([False, True] if mode == 'stand' else [False]):
                    cap = f32(speed * multiplier)
                    wish = (cap, cap if diagonal else 0)
                    commands = []
                    stages = [('start', start_commands, wish), ('release', 32, (0, 0)),
                              ('restart', 32, wish), ('counter', 48, tuple(-v for v in wish))]
                    boundaries = []
                    for stage, count, direction in stages:
                        boundaries.append({'stage': stage, 'command': len(commands) + 1})
                        commands.extend(v2.command(wish=direction, extra=(.5,)) for _ in range(count))
                    commands[0] = v2.command(start=phase, wish=wish, extra=(.5,), begin=phase == 0)
                    result.append({'id': f'{weapon}-{mode}-{phase:g}-' + ('diagonal' if diagonal else 'axis'),
                                   'kind': 'start-release-restart-counter', 'weaponLabel': weapon,
                                   'stance': mode, 'weaponSpeed': speed, 'suppliedSpeed': cap,
                                   'initialState': v2.seed(0), 'commands': commands, 'stages': boundaries,
                                   'mxcsrProfiles': ['nearest-gradual']})
    assert len(result) == 84
    if schedule == 'command':
        result = [f for f in result if f['id'].endswith('-0-axis')]
        for fixture in result:
            for command in fixture['commands']:
                command['extraBoundaries'] = []
        assert len(result) == 21
    if stance_filter:
        result = [f for f in result if f['stance'] == stance_filter]
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--schedule', choices=['half', 'command'], required=True)
    parser.add_argument('--stance', choices=['stand', 'walk', 'crouch'])
    parser.add_argument('--start-commands', type=int, default=64)
    parser.add_argument('--fixture', help='Exact fixture ID; required for half-segment runs to bound emulator memory.')
    args = parser.parse_args()
    assert not args.output.exists()
    assert 1 <= args.start_commands <= 128
    definitions = fixtures(args.schedule, args.stance, args.start_commands)
    if args.schedule == 'half' and not args.fixture:
        parser.error('Half-segment replays require --fixture; run each fixture in a separate capped process.')
    if args.fixture:
        definitions = [f for f in definitions if f['id'] == args.fixture]
        assert len(definitions) == 1, 'Unknown or excluded fixture'
    assert sum(len(f['commands']) for f in definitions) <= 4000, 'Split larger runs into independent capped processes'
    from proof import verify
    proof = verify(args.binary.resolve(), GROUND / 'proof-manifest.json')
    v1.BINARY = args.binary.resolve()
    n = stance.Native()
    keep = ['command', 'startFraction', 'endFraction', 'duration', 'currentWish',
            'derivedUncollidedDisplacement', 'nativeStopGate']
    report = {'schema': 'cs2.ground-start-stop-native.v1', 'serverSha256': v1.SHA,
              'probeSha256': stance.digest(Path(__file__)), 'guardedNativeExecution': True,
              'dependencyHashes': {p.name: stance.digest(p) for p in sorted(GROUND.glob('*.py'))},
              'schedule': args.schedule, 'staticProof': proof, 'fixtures': definitions,
              'limits': ['Supplied processed wish, command fractions, flags and speed caps; no physical key or client latency.',
                         'Existing guarded native movement slices only; no full command, collision or upstream modifier execution.',
                         'Derived displacement uses native midpoint velocity; no game position publisher.',
                         'AWP here is unscoped; abrupt cap transitions and rescope ordering are excluded.']}
    rows = 0
    with args.output.open('x') as output:
        output.write(json.dumps(report, separators=(',', ':'), allow_nan=False)[:-1] + ',"sequences":[')
        for index, fixture in enumerate(definitions):
            n.configure(fixture)
            sequence = combined.replay(n, fixture, 'nearest-gradual')
            compact = {'fixtureId': fixture['id'], 'rows': [
                {**{key: row[key] for key in keep},
                 'afterPostHelper': {key: row['afterPostHelper'][key] for key in ['speedX', 'speedY']}}
                for row in sequence['rows']]}
            rows += len(compact['rows'])
            if index:
                output.write(',')
            json.dump(compact, output, separators=(',', ':'), allow_nan=False)
            output.flush()
            del sequence, compact
            if index % 7 == 6:
                print(json.dumps({'completed': index + 1, 'total': len(definitions)}), flush=True)
        guard = {'unexpectedAccesses': 0, 'counts': n.memory_counts}
        output.write('],"memoryGuard":' + json.dumps(guard) + ',"hooks":' + json.dumps(n.calls) + '}\n')
    print(json.dumps({'fixtures': len(definitions), 'rows': rows,
                      'sha256': stance.digest(args.output), 'guard': guard}))


if __name__ == '__main__':
    main()
