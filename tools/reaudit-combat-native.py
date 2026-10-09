"""Reparse CS2 combat evidence from original demos, retaining hashes and tick rows.

Uses the local vendored parser by default. No game process is launched. Pass
demo paths to include a new capture; the default is every native_*.dem recording.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT.parent / 'native-audit'
sys.path.insert(0, str(AUDIT / 'python'))
from demoparser2 import DemoParser

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('demos', nargs='*', type=Path)
parser.add_argument('--out', type=Path, default=AUDIT / 'reports/reaudit-combat/native.json')
parser.add_argument('--write-recoil-fixture', action='store_true', help='Regenerate the fresh recovery-demo six-shot fixture')
args = parser.parse_args()
game = ROOT.parent / 'cs2-game/game/csgo'
digest = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
props = ['active_weapon_name', 'active_weapon_ammo', 'accuracy_penalty', 'fl_recoil_idx',
         'last_shot_time', 'next_primary_attack_tick', 'next_primary_attack_tick_ratio',
         'is_in_reload', 'total_ammo_left', 'zoom_lvl', 'is_scoped', 'duck_amount',
         'is_airborne', 'shots_fired', 'game_time', 'pitch', 'yaw', 'X', 'Y', 'Z',
         'velocity_X', 'velocity_Y', 'velocity_Z', 'FIRE', 'RELOAD']
recordings = []
for demo in args.demos or sorted(game.glob('native_*.dem')):
    p = DemoParser(str(demo.resolve()))
    fields = p.list_updated_fields()
    requested = props + [f for f in fields if 'CCSPlayer_AimPunchServices.' in f]
    ticks = p.parse_ticks(requested).drop(columns=['steamid', 'name'], errors='ignore')
    events = p.list_game_events()
    selected_events = {}
    for name in ['weapon_fire', 'weapon_reload', 'weapon_zoom', 'player_hurt', 'player_death']:
        if name in events:
            table = p.parse_event(name)
            table = table.drop(columns=[c for c in table if 'steamid' in c or c.endswith('_name')], errors='ignore')
            selected_events[name] = json.loads(table.to_json(orient='records'))
    header = p.parse_header()
    recordings.append(dict(demo=demo.name, sha256=digest(demo), bytes=demo.stat().st_size,
        header={k: header.get(k) for k in ['patch_version', 'map_name', 'demo_version_name']},
        rows=json.loads(ticks.to_json(orient='records', double_precision=15)), events=selected_events,
        missingFields=[k for k in requested if k not in ticks]))
    print(demo.name, len(ticks), 'rows', flush=True)
report = dict(method='Fresh demoparser2 extraction from original demos; identities omitted; weapon labels come from entities, not filenames.',
    binaries={name: digest(game / 'bin/linuxsteamrt64' / name) for name in ['libclient.so', 'libserver.so']},
    currentSteamInfo=(game / 'steam.inf').read_text(), recordings=recordings)
args.out.parent.mkdir(parents=True, exist_ok=True)
args.out.write_text(json.dumps(report, separators=(',', ':')) + '\n')
if args.write_recoil_fixture:
    recording = next(r for r in recordings if r['demo'] == 'native_reaudit_recovery_001.dem')
    prefix = 'CCSPlayerPawn.CCSPlayer_AimPunchServices.'
    shots = [b for a, b in zip(recording['rows'], recording['rows'][1:])
             if b['last_shot_time'] > 0 and a['last_shot_time'] != b['last_shot_time']]
    burst = shots[1:7]
    assert len(burst) == 6 and all(abs(b['last_shot_time'] - a['last_shot_time'] - .1) < .001
                                  for a, b in zip(burst, burst[1:])), 'Revalidate changed capture'
    anchor = lambda r: r[prefix + 'm_predictableBaseTick'] / 128 + r[prefix + 'm_predictableBaseTickInterpAmount'] / 64
    fixture = dict(source=recording['demo'], sha256=recording['sha256'],
        method='Fresh original demo predictable aim-punch base fields. Relative times use decoded native anchor integer/128 + fraction/64; trainer axes negate native pitch and yaw.',
        samples=[dict(elapsed=anchor(r) - anchor(burst[0]), angle=r[prefix + 'm_predictableBaseAngle'],
                      velocity=r[prefix + 'm_predictableBaseAngleVel']) for r in burst])
    (ROOT / 'src/range/native-reaudit-recoil-fixture.json').write_text(json.dumps(fixture, indent=2) + '\n')
print('Wrote', args.out)
