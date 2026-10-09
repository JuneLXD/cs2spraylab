"""Retain native movement state from an approved recording; never launches CS2.

Usage: python3 tools/reaudit-movement-native.py native_reaudit_airduck_003
Reads the vendored demoparser2 and writes sanitized CSV/JSON beside the audit.
"""
import hashlib
import json
from pathlib import Path
import sys

root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(root / 'native-audit/python'))
from demoparser2 import DemoParser

stem = sys.argv[1] if len(sys.argv) > 1 else 'native_reaudit_airduck_003'
demo = root / 'cs2-game/game/csgo' / (stem + '.dem')
output = root / 'native-audit/reports' / stem
output.mkdir(exist_ok=True)
parser = DemoParser(str(demo))
fields = parser.list_updated_fields()
props = ['X', 'Y', 'Z', 'game_time', 'duck_amount', 'duck_speed', 'is_airborne',
         'velocity_X', 'velocity_Y', 'velocity_Z', 'usercmd_forward_move', 'usercmd_left_move',
         'usercmd_viewangle_x', 'usercmd_viewangle_y', 'is_walking']
props += [f for f in fields if '.CCSPlayer_MovementServices.' in f or
          f in ['CCSPlayerPawn.m_fFlags', 'CCSPlayerPawn.m_flGravityScale'] or
          'viewoffset' in f.lower()]
rows = parser.parse_ticks(props).drop(columns=['name', 'steamid'], errors='ignore')
rows.to_csv(output / 'movement-ticks.csv', index=False)
rows.to_json(output / 'movement-ticks.json', orient='records')
summary = {'demo': demo.name, 'sha256': hashlib.sha256(demo.read_bytes()).hexdigest(),
           'samples': len(rows), 'tickRange': [int(rows.tick.min()), int(rows.tick.max())],
           'fields': props, 'limits': ['Network samples at 64 Hz are not rendered camera frames.',
             'Demoparser velocity aliases are position-interval averages delayed by one interval.']}
(output / 'movement-source.json').write_text(json.dumps(summary, indent=2) + '\n')
if '--write-fixture' in sys.argv:
    if stem != 'native_reaudit_airduck_003':
        raise ValueError('The fixture tick ranges belong only to native_reaudit_airduck_003')
    records = rows.set_index('tick').to_dict(orient='index')
    prefix = 'CCSPlayerPawn.CCSPlayer_MovementServices.'
    phases = []
    for name, start, end, held, air in [('groundDuck', 412, 425, True, False),
            ('groundUnduck', 542, 554, False, False), ('airDuck', 681, 694, True, True),
            ('airUnduck', 894, 907, False, True)]:
        samples = []
        for tick in range(start, end + 1):
            row = records[tick]
            samples.append({'tick': tick, 'amount': float(row[prefix + 'm_flDuckAmount']),
                'speed': float(row[prefix + 'm_flDuckSpeed']),
                'viewOffset': float(row[prefix + 'm_flDuckViewOffset']),
                'rootOffset': float(row[prefix + 'm_flDuckRootOffset'])})
        phases.append({'name': name, 'held': held, 'air': air, 'samples': samples})
    origin = []
    for tick in [681, 882, 894]:
        z = [float(records[t]['Z']) for t in [tick - 2, tick - 1, tick]]
        origin.append({'tick': tick, 'previous2': z[0], 'previous1': z[1], 'actual': z[2],
            'ballisticResidual': z[2] - (2 * z[1] - z[0] - 800 / 64 ** 2),
            'beforeAmount': float(records[tick - 1][prefix + 'm_flDuckAmount']),
            'afterAmount': float(records[tick][prefix + 'm_flDuckAmount'])})
    fixture = {'source': demo.name, 'sha256': summary['sha256'], 'sampleInterval': 1 / 64,
        'units': 'Source units and seconds', 'limits': [
            'Server movement state; not rendered camera frames.',
            'Origin residual uses two earlier samples and gravity, with network position quantization.',
            'Jump timestamp fields use 128 intervals per second; demo samples are 64 Hz.'],
        'launch': [{'tick': tick, 'duckAmount': float(records[tick][prefix + 'm_flDuckAmount']),
            'velocity': float(records[tick][prefix + 'm_flLastJumpVelocityZ'])} for tick in [282, 476, 670, 873]],
        'originChanges': origin, 'phases': phases}
    fixture_path = root / 'cs2spraylab/src/range/native-movement-reaudit-fixture.json'
    fixture_path.write_text(json.dumps(fixture, indent=2) + '\n')
print(json.dumps({k: v for k, v in summary.items() if k != 'fields'}, indent=2))
