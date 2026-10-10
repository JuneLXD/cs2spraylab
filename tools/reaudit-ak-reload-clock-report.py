"""Package measured before/after ViewAnimation clocks without recomputing a ratio."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT.parent / 'native-audit/reports/animation-clock-trace'
BEFORE_VIEW_SHA = 'd2eca9451940d34fb75014fa20bf34d4a7e460b733ca06349bd6f546d96c5adc'
BEFORE_RESULT_SHA = '3d190405cd2a947f9f38d5b730e5dcba2004e8c1b9f5b1e7f07bf8ea87263cbd'


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--before', type=Path, default=AUDIT / 'runtime-clock-before.json')
    p.add_argument('--after', type=Path, default=AUDIT / 'runtime-clock-after.json')
    p.add_argument('--out', type=Path, default=ROOT / 'docs/evidence/reaudit-ak-reload-clock.json')
    args = p.parse_args()
    before_bytes, after_bytes = args.before.read_bytes(), args.after.read_bytes()
    sha = lambda data: hashlib.sha256(data).hexdigest()
    assert sha(before_bytes) == BEFORE_RESULT_SHA
    before, after = json.loads(before_bytes), json.loads(after_bytes)
    assert before['schema'] == after['schema'] == 2
    assert before['probeSha256'] == after['probeSha256']
    assert before['metadataSha256'] == after['metadataSha256']
    sources_before = {s['path']: s['sha256'] for s in before['sources']}
    sources_after = {s['path']: s['sha256'] for s in after['sources']}
    assert sources_before['src/range/view-animation.ts'] == BEFORE_VIEW_SHA
    assert sources_after['src/range/view-animation.ts'] == sha((ROOT / 'src/range/view-animation.ts').read_bytes())
    assert [k for k in sources_before if sources_before[k] != sources_after[k]] == ['src/range/view-animation.ts']
    unchanged = lambda data: [r for r in data['rows'] if not (r['id'] == 'ak47' and r['kind'] in ['reload', 'ammo-event'])]
    assert unchanged(before) == unchanged(after)
    def selected(data):
        return [r for r in data['rows'] if r['kind'] == 'ammo-event' or r['id'] == 'ak47' and r['kind'] == 'reload']
    old, new = [next(r for r in d['rows'] if r['id'] == 'ak47' and r['kind'] == 'ammo-event') for d in [before, after]]
    for r in [old, new]:
        assert r['clockBefore'] < r['authoredInsert'] <= r['clockAfter']
        assert r['crossingBracket'][1] - r['crossingBracket'][0] < 1e-10
        assert r['ammo'] == 30 and r['phaseDuration'] == 2.466667
    assert new['clock'] == new['authoredInsert'] == 1.1
    result = dict(schema=1, scope='AK magazine reload rate only; actual ViewAnimation clock',
        probe=dict(path='tools/reaudit-animation-timing-runtime.mjs', sha256=before['probeSha256']),
        metadataSha256=before['metadataSha256'],
        before=dict(resultSha256=sha(before_bytes), sources=before['sources'], rows=selected(before)),
        after=dict(resultSha256=sha(after_bytes), sources=after['sources'], rows=selected(after)),
        checks=dict(unchangedOtherClockRows=len(unchanged(before)), fire=after['checks'],
            beforeInsertionDriftMs=(old['visualInsertWallTime']-old['gameplayInsert'])*1000,
            afterInsertionDriftMs=(new['visualInsertWallTime']-new['gameplayInsert'])*1000),
        limits=['Visual event crossing is measured relative to the trainer action clock, not native displayed onset.',
            'The synthetic tracks measure clock and mixer behavior; this is not a newly captured full native skeleton or audio comparison.',
            'Native steady rate is supported separately by current-byte graph-clock proof and resource graph assertions.'])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result['checks']))


if __name__ == '__main__':
    main()
