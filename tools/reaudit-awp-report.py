"""Compare actual AWP trainer traces; never substitutes a native execution model."""
import argparse, hashlib, json
from pathlib import Path

p = argparse.ArgumentParser()
p.add_argument('--before', type=Path, required=True)
p.add_argument('--after', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists(), 'Refusing to overwrite evidence'
before, after = [json.loads(v.read_text()) for v in (a.before, a.after)]
assert before['probeSha256'] == after['probeSha256']
assert before['fixtures'] == after['fixtures']
def normalize(value):
    if isinstance(value, float): return round(value, 9)
    if isinstance(value, dict): return {k: normalize(v) for k, v in value.items()}
    if isinstance(value, list): return [normalize(v) for v in value]
    return value
def shot_times(row):
    return [(s['processedAt'], s['scheduledAt']) for s in row['shots']]
def comparable(row):
    return {'trace': row['trace'], 'shots': [{k: v for k, v in s.items() if k not in ('callbackAt', 'lastShotAt')} for s in row['shots']]}
def pair_comparable(row):
    result = comparable(row)
    # Range decrements ammo before afterShot; Duel does so just after it.
    # Compare clock/FOV state inside the hook, and full ammo in completed traces.
    result['shots'] = [{**s, **{phase: {k: v for k, v in s[phase].items() if k != 'ammo'}
                       for phase in ['before', 'after']}} for s in result['shots']]
    return result
summaries = []
for old, new in zip(before['rows'], after['rows'], strict=True):
    assert (old['engine'], old['scenario']) == (new['engine'], new['scenario'])
    assert shot_times(old) == shot_times(new), 'Shot schedule changed'
    if new['engine'] == 'range':
        for shot in new['shots']:
            assert shot['lastShotAt'] == shot['scheduledAt']
            assert shot['callbackAt'] == shot['processedAt']
    summaries.append({'engine': new['engine'], 'scenario': new['scenario'],
        'unchanged': normalize(comparable(old)) == normalize(comparable(new)),
        'shotTimes': shot_times(new),
        'secondaryBefore': [s['after']['secondary'] for s in old['shots']],
        'secondaryAfter': [s['after']['secondary'] for s in new['shots']],
        'resumeBefore': [s['after']['resumeAt'] for s in old['shots']],
        'resumeAfter': [s['after']['resumeAt'] for s in new['shots']]})
for report in [before, after]:
    for i in range(0, len(report['rows']), 2):
        assert normalize(pair_comparable(report['rows'][i])) == normalize(pair_comparable(report['rows'][i+1])), 'Engine disagreement'
result = {'method': __doc__, 'beforeCommit': before['commit'], 'afterBaseCommit': after['commit'],
    'cases': len(summaries), 'enginePairs': len(summaries)//2, 'pairMismatches': 0, 'shotScheduleChanges': 0,
    'unchangedCases': sum(s['unchanged'] for s in summaries), 'rows': summaries,
    'files': {str(v): hashlib.sha256(v.read_bytes()).hexdigest() for v in (a.before, a.after)},
    'probeSha256': before['probeSha256'], 'comparatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'comparisonTolerance': 'Floating point values rounded to 9 decimal places for whole traces; shot times compared exactly.',
    'pairScope': 'All completed trace fields including ammo; inside afterShot compare clock/FOV fields, excluding ammo because Range decrements before the hook and Duel after it. Raw hook ammo retained.',
    'boundary': 'Trainer measurements only. No claim of native context/history selection or exact postframe cadence.'}
a.output.write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({k: result[k] for k in ['cases','enginePairs','pairMismatches','shotScheduleChanges','unchangedCases']}))
