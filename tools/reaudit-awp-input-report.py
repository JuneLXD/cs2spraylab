"""Compare actual trainer traces for the bounded AWP input-priority correction."""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--before', type=Path, required=True)
p.add_argument('--after', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists(), 'Refusing to overwrite evidence'
before, after = [json.loads(path.read_text()) for path in (a.before, a.after)]
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
assert before['commit'] == after['commit'] == '9021527c735c5974f287d9377b13dd5daa1ffbf8'
assert before['trackedChanges'] == []
assert before['probeSha256'] == after['probeSha256'] == sha(Path(__file__).with_name('reaudit-awp-input-trainer.mjs'))
assert before['fixtures'] == after['fixtures']
assert before['sourceHashes'].keys() == after['sourceHashes'].keys()
changed_sources = [name for name, value in before['sourceHashes'].items() if after['sourceHashes'][name] != value]
assert changed_sources == ['src/range/duel/weapon-state.ts', 'src/range/simulation.ts']
assert len(before['rows']) == len(after['rows']) == 23

def zoom_edges(row):
    return [{'at': value['at'], 'zoom': value['zoom'], **({'edge': value['edge']} if 'edge' in value else {})}
            for i, value in enumerate(row['trace']) if not i or value['zoom'] != row['trace'][i-1]['zoom']]

rows = []
for old, new in zip(before['rows'], after['rows'], strict=True):
    engine, scenario = new['engine'], new['scenario']
    assert (engine, scenario) == (old['engine'], old['scenario'])
    old_times = [(s['scheduledAt'], s['processedAt']) for s in old['shots']]
    new_times = [(s['scheduledAt'], s['processedAt']) for s in new['shots']]
    assert old_times == new_times, 'Shot count or timing changed'
    if scenario.startswith('atomic-both-zoom-'):
        zoom = int(scenario[-1])
        assert engine == 'duel'
        assert old['shots'][0]['zoomBefore'] == (zoom + 1) % 3
        assert new['shots'][0]['zoomBefore'] == zoom
        assert new['trace'][-1]['zoom'] == zoom
    elif scenario.startswith('held-primary-secondary-tap-zoom-'):
        zoom = int(scenario[-1])
        old_tap = next(t for t in old['trace'] if t.get('edge') == 'secondary-down' and t['at'] > 2)
        new_tap = next(t for t in new['trace'] if t.get('edge') == 'secondary-down' and t['at'] > 2)
        assert old_tap['zoom'] == (zoom + 1) % 3 and new_tap['zoom'] == zoom
    elif scenario == 'repeat-true-primary-held':
        recovery = [t for t in new['trace'] if 2.455 - 1e-9 <= t['at'] < 3 - 1e-9]
        assert recovery and all(t['zoom'] == 1 and t['ammo'] == 4 for t in recovery)
        release_zoom = next(t for t in zoom_edges(new) if t['at'] > 2.46)
        expected = 3 + (1 / 120 if engine == 'range' else 0)
        assert abs(release_zoom['at'] - expected) < 1e-9 and release_zoom['zoom'] == 2
    else:
        assert old == new, f'Control changed: {engine}/{scenario}'
    rows.append({'engine': engine, 'scenario': scenario, 'unchanged': old == new,
                 'shotTimes': new_times, 'shotZoomBefore': [s['zoomBefore'] for s in old['shots']],
                 'shotZoomAfter': [s['zoomBefore'] for s in new['shots']],
                 'zoomEdgesBefore': zoom_edges(old), 'zoomEdgesAfter': zoom_edges(new)})
assert sum(r['unchanged'] for r in rows) == 14
result = {'method': __doc__, 'baseline': before['commit'], 'cases': 23, 'unchangedCases': 14,
          'changedCases': 9, 'shotScheduleChanges': 0, 'bundledSourceCount': len(before['sourceHashes']),
          'changedBundledSources': changed_sources, 'atomicDuelCases': 3, 'pairedScenarioCount': 10,
          'comparison': 'Exact JSON equality for whole-case controls and exact scheduled/processed shot times. '
                        'Release frame expected times checked within 1e-9 seconds.',
          'boundary': 'Trainer measurements, not native execution. Ten scenarios use both engines but are '
                      'not asserted to have identical frame-queued zoom timing. Atomic both-input cases are '
                      'Duel-only; separate Range DOM-equivalent edges retain ordering. With repeat enabled '
                      'and primary released at 3 s, Range zooms at 3.008333333 s and Duel at 3 s. '
                      'Existing preference and frame/event cadence are unchanged; no native cadence parity claim.',
          'probeSha256': before['probeSha256'], 'comparatorSha256': sha(Path(__file__)),
          'files': {str(path): sha(path) for path in (a.before, a.after)}, 'rows': rows}
a.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({key: result[key] for key in ['cases', 'unchangedCases', 'changedCases', 'shotScheduleChanges']}))
