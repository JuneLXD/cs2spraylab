"""Retain the approved capture's AIR transitions without raw native locations."""
import hashlib,json
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];AUDIT=ROOT.parent/'native-audit'
samples=AUDIT/'reports/reaudit-motion-runtime/samples.jsonl'
inputs=AUDIT/'reports/native_reaudit_bob_001-inputs.jsonl'
edges=[json.loads(line)for line in inputs.open()];rows=[];eligible=0
for line in samples.open():
 row=json.loads(line)
 if not edges[0]['monotonic']<=row['monotonic']<=edges[-1]['monotonic'] or row['swayTime']!=row['currentTime']:continue
 eligible+=1
 if rows and row['swayTime']==rows[-1]['swayTime']:rows[-1]=row
 else:rows.append(row)
source_hash=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report=dict(method=__doc__,sourceHashes={'samples':source_hash(samples),'inputEdges':source_hash(inputs),
 'sampler':source_hash(AUDIT/'reaudit-motion-runtime.py')},eligibleSamples=eligible,hudStates=len(rows),
 columns=['previousAir','grounded','observedAir'],pairs=[[a['air'],bool(b['flags']&1),b['air']]for a,b in zip(rows,rows[1:])],
 video=json.loads((AUDIT/'reports/native_reaudit_bob_001-pts.json').read_text()),
 limits=['Reads are guarded by unchanged frame/model state, not an atomic engine callback.',
 'One eligible state per changed HUD timestamp; observation gaps and equal-state repeated calls can be invisible.',
 'Decoded video timestamps establish sample availability, not unique game frames or physical display latency.',
 'No shot/publication anchors, evaluated velocity cache or pawn body-rotation writer was recorded.'])
report['video'].pop('timestamps');report['video'].pop('gapsOver50ms')
out=ROOT/'docs/evidence/reaudit-viewmodel-air-runtime.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(hudStates=len(rows),pairs=len(report['pairs']),out=str(out))))
