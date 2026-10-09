"""Fresh native accuracy/index extraction with flags, weapon modes and clocks.

Preserves raw decoded tick/ratio carriers. Reconstruction of a shot command
fraction is performed by the JS bench, where native vdata cycle/mode is known.
Player identities are removed before retained output.
"""
import argparse,hashlib,json,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];AUDIT=ROOT.parent/'native-audit'
sys.path.insert(0,str(AUDIT/'python'))
from demoparser2 import DemoParser
p=argparse.ArgumentParser(description=__doc__);p.add_argument('demos',nargs='*',type=Path);args=p.parse_args()
props=['active_weapon_name','active_weapon_ammo','accuracy_penalty','fl_recoil_idx','last_shot_time','weapon_mode',
 'next_primary_attack_tick','next_primary_attack_tick_ratio','is_in_reload','zoom_lvl','game_time','duck_amount','is_airborne',
 'velocity_X','velocity_Y','velocity_Z','CCSPlayerPawn.CCSPlayer_MovementServices.m_flFallVelocity','CCSPlayerPawn.m_fFlags','Weapon.m_weaponMode','Weapon.m_iRecoilIndex',
 'CCSPlayerPawn.CCSPlayer_MovementServices.m_bDucked','CCSPlayerPawn.CCSPlayer_MovementServices.m_bDucking',
 'CCSPlayerPawn.CCSPlayer_AimPunchServices.m_predictableBaseTick',
 'CCSPlayerPawn.CCSPlayer_AimPunchServices.m_predictableBaseTickInterpAmount']
rows=[]
for path in args.demos or sorted((ROOT.parent/'cs2-game/game/csgo').glob('native_*.dem')):
 parser=DemoParser(str(path));ticks=parser.parse_ticks(props).drop(columns=['steamid','name'],errors='ignore');events={}
 for name in ['weapon_fire','weapon_reload','weapon_zoom','player_jump']:
  if name in parser.list_game_events():
   data=parser.parse_event(name);data=data.drop(columns=[k for k in data if 'steamid'in k or k.endswith('_name')],errors='ignore');events[name]=json.loads(data.to_json(orient='records',double_precision=15))
 rows.append(dict(demo=path.name,sha256=hashlib.sha256(path.read_bytes()).hexdigest(),rows=json.loads(ticks.to_json(orient='records',double_precision=15)),events=events))
 print(path.name,len(ticks),flush=True)
out=AUDIT/'reports/reaudit-accuracy-demos.json';out.write_text(json.dumps(dict(method=__doc__,recordings=rows),separators=(',',':'))+'\n')
print('Wrote',out)
