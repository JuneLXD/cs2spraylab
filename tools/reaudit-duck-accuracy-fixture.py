#!/usr/bin/env python3
"""Prepare a flag-vs-amount regression from the retained stationary duck demo.

Reads retained primary CSV; does not launch CS2, parse a new demo, or emulate
native code. The optional raw-demo hash check only verifies provenance.
Output is a proposed numeric fixture, not a replay of either trainer engine.
"""
import argparse
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AUDIT = ROOT / 'native-audit'
STEM = 'native_reaudit_airduck_003'
DEMO_SHA = 'b2e4254179264568f323339cb87b22d1217b9447c88b4a419fb75b9d88e0ceb8'
PREFIX = 'CCSPlayerPawn.CCSPlayer_MovementServices.'
PHASES = [('ground-entry', 411, 426), ('ground-release', 541, 552),
          ('air-entry', 680, 683), ('air-entry-and-release', 881, 896)]


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def boolean(value):
    assert value in ('True', 'False'), value
    return value == 'True'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path,
                        default=AUDIT / 'reports/reaudit-duck-accuracy/retained-demo.json')
    parser.add_argument('--verify-demo', action='store_true')
    parser.add_argument('--write-portable', action='store_true')
    args = parser.parse_args()
    source_dir = AUDIT / 'reports' / STEM
    metadata_path = source_dir / 'movement-source.json'
    metadata = json.loads(metadata_path.read_text())
    assert metadata['demo'] == STEM + '.dem' and metadata['sha256'] == DEMO_SHA
    csv_path = source_dir / 'movement-ticks.csv'
    rows = []
    with csv_path.open(newline='') as handle:
        for raw in csv.DictReader(handle):
            flags = int(raw['CCSPlayerPawn.m_fFlags'])
            row = dict(tick=int(raw['tick']), time=float(raw['game_time']),
                       amount=float(raw[PREFIX + 'm_flDuckAmount']),
                       speed=float(raw[PREFIX + 'm_flDuckSpeed']),
                       onGround=bool(flags & 1), duckFlag=bool(flags & 2),
                       ducked=boolean(raw[PREFIX + 'm_bDucked']),
                       ducking=boolean(raw[PREFIX + 'm_bDucking']),
                       desiresDuck=boolean(raw[PREFIX + 'm_bDesiresDuck']),
                       override=boolean(raw[PREFIX + 'm_bDuckOverride']))
            assert 0 <= row['amount'] <= 1 and row['speed'] >= 0
            rows.append(row)
    assert len(rows) == metadata['samples'] == 1188
    assert [r['tick'] for r in rows] == list(range(1188))
    by_tick = {r['tick']: r for r in rows}
    # Directly observed transitions; amount tolerance covers CSV decimal output.
    checks = [(424, .98428404, False), (425, 1, True),
              (542, .91146564, True), (543, .8162966, True),
              (544, .7203951, False), (680, 0, False), (681, 1, True),
              (881, 0, False), (882, 1, True), (893, 1, True), (894, 0, False)]
    for tick, amount, flag in checks:
        assert abs(by_tick[tick]['amount'] - amount) < 1e-7
        assert by_tick[tick]['duckFlag'] == flag
    assert not by_tick[542]['ducked'] and by_tick[542]['duckFlag']
    portable_path = ROOT / 'cs2spraylab/src/range/native-duck-flag-fixture.json'
    portable_checks = 0
    if portable_path.exists():
        portable = json.loads(portable_path.read_text())
        assert portable['demoSha256'] == DEMO_SHA
        assert portable['decodedCsvSha256'] == digest(csv_path)
        for name in ['groundDuck', 'groundUnduck']:
            for tick, flag in portable[name]:
                assert by_tick[tick]['duckFlag'] == flag
                portable_checks += 1
        for change in portable['airChanges']:
            before, after = by_tick[change['tick'] - 1], by_tick[change['tick']]
            assert (before['amount'], before['duckFlag']) == (change['beforeAmount'], change['beforeFlag'])
            assert (after['amount'], after['duckFlag']) == (change['afterAmount'], change['afterFlag'])
            portable_checks += 2
    paths = {
        'movementCsv': csv_path,
        'movementMetadata': metadata_path,
        'duckSavedPseudocode': AUDIT / 'rea/out/0x16b2200.c',
        'accuracyUpdateSavedPseudocode': AUDIT / 'rea/out/reaudit-combat-accuracy-update.c',
        'accuracyRecoverySavedPseudocode': AUDIT / 'rea/out/reaudit-combat-accuracy-recovery.c',
        'rangeSource': ROOT / 'cs2spraylab/src/range/simulation.ts',
        'duelWeaponSource': ROOT / 'cs2spraylab/src/range/duel/weapon-state.ts',
        'duelSimulationSource': ROOT / 'cs2spraylab/src/range/duel/simulation.ts',
    }
    provenance = {name: {'path': str(path.relative_to(ROOT)), 'sha256': digest(path)}
                  for name, path in paths.items()}
    verified = False
    if args.verify_demo:
        assert digest(ROOT / 'cs2-game/game/csgo' / (STEM + '.dem')) == DEMO_SHA
        verified = True
    accuracy_path = AUDIT / 'reports/reaudit-accuracy-native.json'
    assert accuracy_path.stat().st_size < 16 * 1024 * 1024
    accuracy = json.loads(accuracy_path.read_text())
    assert accuracy['serverSha256'] == 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
    native_updates = []
    for weapon in ['ak47', 'm4a4', 'm4a1s', 'deagle', 'awp', 'usp']:
        for stance in ['stand', 'crouch', 'air']:
            candidates = [r for r in accuracy['samples'] if r['weapon'] == weapon and
                          r['mode'] == 0 and r['stance'] == stance and
                          r['index'] == 3 and r['gate'] == 'equal']
            assert candidates, (weapon, stance)
            native_updates.append(max(candidates, key=lambda r: r['penalty']))
    result = dict(
        method='Retained decoded server samples, flag-versus-amount comparison only.',
        demo=STEM + '.dem', demoSha256=DEMO_SHA, rawDemoHashVerifiedThisRun=verified,
        provenance=provenance, decodedRows=len(rows), nativeChecks=len(checks) + 1,
        portableFlagFixtureChecks=portable_checks,
        nativeUpdates=native_updates,
        nativeUpdateSource=dict(path=str(accuracy_path.relative_to(ROOT)), sha256=digest(accuracy_path),
                                serverSha256=accuracy['serverSha256'], method=accuracy['method']),
        limits=[
            '64 Hz sampled states; no exact physical input or invocation timestamp inferred.',
            'CSV decimal precision retained; no claim of full binary float reconstruction.',
            'No weapon accuracy penalty or shot was measured by this movement recording.',
            'The .95 predicate is the inspected pre-fix trainer predicate, not an executed engine result.',
            'Blocked unduck and fatigue/cooldown boundaries are static-only; not observed here.',
            'No Ghidra session, native invocation, or production code is run by this extractor.'
        ],
        baselinePredicate='amount >= .95',
        baselineDisagreements=[r for r in rows if (r['amount'] >= .95) != r['duckFlag']],
        duckedIsNotFlag=[r for r in rows if r['ducked'] != r['duckFlag']],
        phases=[dict(name=name, rows=[by_tick[tick] for tick in range(lo, hi + 1)])
                for name, lo, hi in PHASES])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    if args.write_portable:
        portable = {key: result[key] for key in ['method', 'demo', 'demoSha256', 'nativeUpdateSource',
                    'nativeUpdates', 'baselineDisagreements', 'phases', 'limits']}
        portable['decodedCsvSha256'] = provenance['movementCsv']['sha256']
        target = ROOT / 'cs2spraylab/docs/evidence/reaudit-duck-accuracy-fixture.json'
        target.write_text(json.dumps(portable, indent=2) + '\n')
    print(json.dumps(dict(out=str(args.out), rows=len(rows), nativeChecks=result['nativeChecks'],
                          baselineDisagreements=len(result['baselineDisagreements']),
                          rawDemoHashVerifiedThisRun=verified)))


if __name__ == '__main__':
    main()
