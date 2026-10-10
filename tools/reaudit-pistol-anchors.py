"""Reparse selected retained pistol demos, without launching the game.

Keep native punch anchors around confirmed fire events. Original demo headers,
hashes and decoded weapon names establish provenance; current binary versions
are deliberately not assigned to these historical captures.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
p.add_argument('demos', nargs='+')
a = p.parse_args()
assert not a.output.exists(), a.output
sys.path.insert(0, str(a.root / 'native-audit/python'))
from demoparser2 import DemoParser

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()

prefix = 'CCSPlayerPawn.CCSPlayer_AimPunchServices.'
anchor_names = ['m_predictableBaseAngle', 'm_predictableBaseAngleVel',
                'm_predictableBaseTick', 'm_predictableBaseTickInterpAmount']
fields = ['active_weapon_name', 'active_weapon_ammo', 'fl_recoil_idx',
          'last_shot_time', 'game_time', 'shots_fired', 'accuracy_penalty',
          'zoom_lvl', 'duck_amount', 'is_airborne', 'pitch', 'yaw']
names = {'AK-47': 'ak47', 'M4A4': 'm4a4', 'M4A1-S': 'm4a1s',
         'Glock-18': 'glock', 'USP-S': 'usp', 'Desert Eagle': 'deagle', 'AWP': 'awp'}

def state(row):
    return {'tick': row['tick'], **{k: row.get(k) for k in fields},
            'punch': {k: row.get(prefix + k) for k in anchor_names}}

recordings = []
for name in a.demos:
    assert Path(name).name == name and name.startswith('native_') and name.endswith('.dem')
    path = a.root / 'cs2-game/game/csgo' / name
    parser = DemoParser(str(path))
    header = parser.parse_header()
    rows = json.loads(parser.parse_ticks(fields + [prefix + k for k in anchor_names])
                      .drop(columns=['steamid', 'name'], errors='ignore')
                      .to_json(orient='records', double_precision=15))
    events = parser.parse_event('weapon_fire')
    fire_ticks = set(events['tick'])
    shots = []
    for before, after in zip(rows, rows[1:]):
        weapon = names.get(after.get('active_weapon_name'))
        if not weapon or before.get('active_weapon_name') != after.get('active_weapon_name'):
            continue
        if after['tick'] != before['tick'] + 1 or after['tick'] not in fire_ticks:
            continue
        if after['last_shot_time'] <= 0 or after['last_shot_time'] == before['last_shot_time']:
            continue
        shots.append({'weapon': weapon, 'fireEvent': True,
                      'before': state(before), 'after': state(after)})
    recordings.append({'demo': name, 'sha256': digest(path),
                       'header': {k: header.get(k) for k in ['patch_version', 'map_name', 'demo_version_name']},
                       'rows': len(rows), 'shots': shots})
    print(json.dumps({'demo': name, 'rows': len(rows), 'shots': len(shots),
                      'weapons': sorted({s['weapon'] for s in shots})}), flush=True)

report = {'method': __doc__, 'parserVersion': '0.42.0',
          'parserSha256': digest(a.root / 'native-audit/python/demoparser2/demoparser2.cpython-310-x86_64-linux-gnu.so'),
          'probeSha256': digest(Path(__file__)), 'recordings': recordings}
a.output.write_text(json.dumps(report, indent=2) + '\n')
