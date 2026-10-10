from pathlib import Path
import argparse,hashlib,json
parser=argparse.ArgumentParser()
parser.add_argument('--audit-root',type=Path,default=Path(__file__).resolve().parents[2]/'native-audit')
args=parser.parse_args()
out=args.audit_root/'reports/deagle-reload-next'
before=json.loads((out/'trainer-before.json').read_text());after=json.loads((out/'trainer-after.json').read_text())
assert before['probeSha256']==after['probeSha256']
changed_sources=[k for k,v in before['sourceHashes'].items() if after['sourceHashes'].get(k)!=v]
assert set(changed_sources)=={'src/range/native-reload-timing.json','src/range/sound-events-data.json'}
assert len(before['cases'])==len(after['cases'])==84
unchanged=[];changed=[]
for a,b in zip(before['cases'],after['cases']):
 key=[a[k] for k in ['weapon','empty','mode','source']]
 assert key==[b[k] for k in ['weapon','empty','mode','source']]
 (unchanged if a==b else changed).append(key)
 if a['weapon']!='deagle' or a['empty']:assert a==b,key
for data in [before,after]:
 for a,b in zip(data['cases'][::2],data['cases'][1::2]):
  assert {k:v for k,v in a.items() if k!='source'}=={k:v for k,v in b.items() if k!='source'}
assert len(unchanged)==78 and len(changed)==6
result={'schema':1,'probeSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'cases':84,'unchangedControls':78,'changed':changed,'sourceChanges':changed_sources,'hearingBrowserPairsAgree':42,'hashes':{n:hashlib.sha256((out/n).read_bytes()).hexdigest() for n in ['trainer-before.json','trainer-after.json','source-proof.json','motion-comparison.json']},'changes':{'clipoutSeconds':[4/30,10/30],'silentWorkEnd':[49/30,50/30],'heldSilenceEnd':[.2+(49/30-.2)*2,.2+(50/30-.2)*2]},'heldCompletion':{}}
for key,data in [('before',before),('after',after)]:
 row=next(c for c in data['cases'] if c['weapon']=='deagle' and not c['empty'] and c['mode']=='held' and c['source']=='browser')
 result['heldCompletion'][key]=row['events'][-1]['at']
(out/'comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({'cases':84,'unchangedControls':78,'consumerPairsAgree':42,'heldCompletion':result['heldCompletion']}))
