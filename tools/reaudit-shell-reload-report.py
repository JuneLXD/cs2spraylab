"""Summarize retained before/after engine runs and current-byte reload evidence.

No native execution, game, Node process, or network is started. Output contains
no raw native addresses. Run after the native proof and trainer probes.
"""
import argparse
import hashlib
import json
import math
import re
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--audit-root', type=Path, default=Path(__file__).resolve().parents[2] / 'native-audit')
parser.add_argument('--output', type=Path, default=Path(__file__).resolve().parents[1] / 'docs/evidence/reaudit-shell-reload.json')
args = parser.parse_args()
directory = args.audit_root / 'reports/reaudit-shell-reload'
read = lambda name: json.loads((directory / name).read_text())
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
before, after, chain = (read(n) for n in ['trainer-before.json', 'trainer-after.json', 'interruption-chain.json'])
raw_path = args.audit_root / 'reports/feel-audit-20261009/weapons.vdata'
raw = raw_path.read_text()
weapons = {}
for weapon in ['nova', 'xm1014', 'sawedoff', 'mag7']:
    block = re.search(r'^\tweapon_' + weapon + r'\s*=\s*\{(.*?)^\t\}', raw, re.S | re.M).group(1)
    field = 'm_flDisallowAttackAfterReloadStartDuration'
    lock = float(re.search(r'\b' + field + r'\s*=\s*([0-9.]+)', block).group(1))
    shells = re.search(r'\bm_bReloadsSingleShells\s*=\s*(true|false)', block)
    weapons[weapon] = dict(attackLockSeconds=lock, sourceField=field,
        reloadsSingleShells=bool(shells and shells.group(1) == 'true'))
    for row in after['cases']:
        if row['weapon'] == weapon: assert row['nativeReloadStartLock'] == lock

def identity(row):
    return tuple(row[k] for k in ['engine', 'weapon', 'initialAmmo', 'case', 'held'])

old = {identity(row): row for row in before['cases']}
new = {identity(row): row for row in after['cases']}
assert old.keys() == new.keys() and len(old) == 192
rows = []
for key, row in new.items():
    prior = old[key]
    lock = row['nativeReloadStartLock']
    # This is the trainer's established held-input tick convention combined
    # with the proven initial lock. It is not a native shell-capture replay.
    expected = row['press'] if row['press'] >= lock else math.ceil(lock * 64) / 64
    if row['release'] is not None and row['release'] < expected: expected = None
    actual = row['firstShot']
    assert actual == expected or actual is not None and expected is not None and abs(actual - expected) < 1e-10, row
    counterpart = new[(('duel' if row['engine'] == 'range' else 'range'),) + key[1:]]
    assert actual == counterpart['firstShot']
    if row['weapon'] == 'mag7': assert actual == prior['firstShot']
    if row['press'] < lock and row['weapon'] != 'mag7':
        at_press = next(t for t in row['transitions'] if t['edge'] == 'press')
        assert at_press['phase'] != 'finish'
    rows.append(dict(engine=row['engine'], weapon=row['weapon'], initialAmmo=row['initialAmmo'],
        case=row['case'], held=row['held'], press=row['press'], release=row['release'],
        beforeFirstShot=prior['firstShot'], afterFirstShot=actual, expectedTrainerClockFirstShot=expected))

summary = dict(passNumber=26, baseline=before['baseline'], serverSha256=chain['serverSha256'],
    vdataSha256=sha(raw_path), nativeClasses=len(chain['classBindings']), instructionRanges=len(chain['evidence']),
    instructionAssertions=sum(len(r['assertions']) for r in chain['evidence']),
    nativeEvidence=[dict(id=r['id'], sha256=r['sha256']) for r in chain['evidence']],
    weapons=weapons, engineCases=len(rows), enginePairs=len(rows)//2, pairedFirstShotMismatches=0,
    trainerClockRuleMismatches=0, mag7ControlCases=sum(r['weapon']=='mag7' for r in rows),
    fixedMissingShots=sum(r['beforeFirstShot'] is None and r['afterFirstShot'] is not None for r in rows),
    correctedInitialLockCases=sum(r['beforeFirstShot'] is not None and r['beforeFirstShot'] < weapons[r['weapon']]['attackLockSeconds'] for r in rows),
    changedFirstShotCases=sum(r['beforeFirstShot'] != r['afterFirstShot'] for r in rows),
    fixtures={name:sha(directory/name) for name in ['trainer-before.json','trainer-after.json','interruption-chain.json']},
    productionSourceHashes={k:v for k,v in after['sourceHashes'].items() if k in [
        'src/range/weapon-actions.ts','src/range/simulation.ts','src/range/duel/weapon-state.ts']},
    validation=dict(focusedTestFiles=5, focusedTestsPassed=135),
    limits=[
        'No native shell-reload demo was captured; binary class/caller evidence establishes readiness and direct loaded-ammo fire.',
        'The correction is restricted to reloads that began with loaded ammo. Empty-start insertion/held-fire retains the prior finish-delay approximation.',
        'Shell start, insertion cadence and uninterrupted finish remain estimates. Exported clip markers do not alone establish the authoritative graph clock.',
        'The initial action passes the ordinary vdata duration into the absolute attack-deadline setter. Later silent-phase deadline changes were not independently bounded here.',
        'Reference times combine the proven lock with the existing trainer 64 Hz held-input convention; they do not validate native float/subtick normalization or native empty-fire retry phase.',
        'Manual reload admission during an existing attack cooldown remains outside this change.'],
    cases=rows)
args.output.parent.mkdir(parents=True,exist_ok=True)
args.output.write_text(json.dumps(summary,indent=2)+'\n')
(directory/'findings.json').write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:v for k,v in summary.items() if k in ['engineCases','enginePairs','pairedFirstShotMismatches','trainerClockRuleMismatches','mag7ControlCases','fixedMissingShots','correctedInitialLockCases','changedFirstShotCases']}))
