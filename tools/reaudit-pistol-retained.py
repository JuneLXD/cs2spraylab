"""Select common-weapon shot anchors from retained original-demo extraction.

No native execution or new parser run. Original demo hashes must still match.
Capture headers identify their own builds; the extraction's binary identity is
not retroactively assigned to historical captures.
"""
import argparse, hashlib, json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists()
src = a.root / 'native-audit/reports/reaudit-combat/native.json'
raw = src.read_bytes()
source_hash = hashlib.sha256(raw).hexdigest()
data = json.loads(raw)
del raw
prefix = 'CCSPlayerPawn.CCSPlayer_AimPunchServices.'
names = {'AK-47':'ak47', 'M4A4':'m4a4', 'M4A1-S':'m4a1s', 'Glock-18':'glock',
         'USP-S':'usp', 'Desert Eagle':'deagle', 'AWP':'awp'}
fields = ['game_time', 'fl_recoil_idx', 'last_shot_time', 'active_weapon_ammo',
          'next_primary_attack_tick', 'next_primary_attack_tick_ratio', 'shots_fired',
          'zoom_lvl', 'is_in_reload', 'accuracy_penalty', 'duck_amount', 'is_airborne',
          'pitch', 'yaw', 'velocity_X', 'velocity_Y', 'velocity_Z']
anchors = ['m_predictableBaseAngle', 'm_predictableBaseAngleVel', 'm_predictableBaseTick',
           'm_predictableBaseTickInterpAmount']
records = []
def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1<<20), b''):h.update(chunk)
    return h.hexdigest()
def state(row):
    return {'tick':row['tick'], **{key:row.get(key) for key in fields},
            'punch':{key:row.get(prefix+key) for key in anchors}}
for recording in data['recordings']:
    rows = recording['rows']
    weapons = sorted({names[r['active_weapon_name']] for r in rows if r.get('active_weapon_name') in names})
    if not weapons:continue
    sha = digest(a.root/'cs2-game/game/csgo'/recording['demo'])
    assert sha == recording['sha256'], recording['demo']
    fire_ticks = {e['tick'] for e in recording['events'].get('weapon_fire', [])}
    shots = []
    for previous, current in zip(rows, rows[1:]):
        weapon = names.get(current.get('active_weapon_name'))
        if not weapon or previous.get('active_weapon_name') != current.get('active_weapon_name'):continue
        if current['tick'] != previous['tick'] + 1:continue
        if not (current.get('last_shot_time',0)>0 and current['last_shot_time'] != previous.get('last_shot_time')):continue
        shots.append({'weapon':weapon, 'fireEvent':current['tick'] in fire_ticks,
                      'before':state(previous), 'after':state(current)})
    records.append({'demo':recording['demo'], 'sha256':sha,
                    'header':{k:recording['header'].get(k) for k in ['patch_version','map_name','demo_version_name']},
                    'rows':len(rows), 'decodedWeapons':weapons, 'shots':shots})
report = {'method':__doc__, 'source':str(src.relative_to(a.root)), 'sourceSha256':source_hash,
          'selectorSha256':digest(Path(__file__)), 'retainedExtractionBinaries':data['binaries'],
          'recordings':records}
a.output.write_text(json.dumps(report,indent=2)+'\n')
for r in records:
    gaps = [round(b['after']['last_shot_time']-v['after']['last_shot_time'],4)
            for v,b in zip(r['shots'],r['shots'][1:]) if v['weapon']==b['weapon']]
    print(json.dumps({'demo':r['demo'],'weapons':r['decodedWeapons'],'shots':len(r['shots']),
                      'eventMatches':sum(s['fireEvent'] for s in r['shots']),'gaps':gaps}))
