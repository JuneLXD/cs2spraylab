"""Portable original demo snapshots and bounded native invocations (no fitted outputs)."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];OUT=ROOT.parent/'native-audit/reports'
demos={d['demo']:d for d in json.loads((OUT/'reaudit-accuracy-demos.json').read_text())['recordings']}
grid=json.loads((OUT/'reaudit-accuracy-native.json').read_text());old=json.loads((OUT/'reaudit-accuracy-results.json').read_text())
shots={d['demo']:{r['tick']:r['exactShot'] for r in d['rows'] if r['shot']} for d in old['demos']}
def rows(demo,start,end):
 return [dict(tick=r['tick'],time=r['game_time'],penalty=r['accuracy_penalty'],index=r['fl_recoil_idx'],lastShot=r['last_shot_time'],mode=r.get('weapon_mode',r.get('Weapon.m_weaponMode',0)) or 0,shot=shots.get(demo,{}).get(r['tick'])) for r in demos[demo]['rows'] if start<=r['tick']<=end]
episodes=[]
for demo,weapon,start,end in [('native_reaudit_recovery_001.dem','ak47',460,620),('native_reaudit_shooting_001.dem','ak47',953,1020),('native_audit_scope_slow_001.dem','awp',0,146)]:
 episodes.append(dict(demo=demo,sha256=demos[demo]['sha256'],weapon=weapon,rows=rows(demo,start,end)))
reloads=[]
for demo,weapon,tick,automatic in [('native_reaudit_shooting_001.dem','ak47',398,False),('native_reaudit_shooting_001.dem','ak47',638,False),('native_phase3_m4a4_002.dem','m4a4',4103,True)]:
 reloads.append(dict(demo=demo,sha256=demos[demo]['sha256'],weapon=weapon,automatic=automatic,rows=rows(demo,tick-1,tick)))
keep={'ak47','famas','glock','revolver','awp','negev','nova'}
samples=[r for r in grid['samples'] if r['weapon'] in keep and r['gate'] in ['equal','after'] and r['index'] in [.05,.1001,3] and r['penalty']>.15]
fixture=dict(serverSha256=grid['serverSha256'],method=__doc__+' Retained recordings are not retrospectively bound to the current ELF hash.',episodes=episodes,reloads=reloads,nativeUpdates=samples)
(ROOT/'src/range/native-accuracy-fixture.json').write_text(json.dumps(fixture,indent=2)+'\n')
print('Saved',len(samples),'native invocations,',sum(len(e['rows']) for e in episodes),'snapshot rows and',len(reloads),'reload boundaries')
