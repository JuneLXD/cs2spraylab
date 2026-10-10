from pathlib import Path
import argparse,hashlib,json,sys
parser=argparse.ArgumentParser()
parser.add_argument('--audit-root',type=Path,default=Path(__file__).resolve().parents[2]/'native-audit')
args=parser.parse_args()
root=args.audit_root.resolve().parent
repo=root/'cs2spraylab'
sys.path.insert(0,str(repo/'.local-tools'))
import datamodel
out=root/'native-audit/reports/deagle-reload-next'
paths={'import-era':repo/'research/reload_deagle.dmx','fresh':out/'fresh/animation/anims/viewmodel/pistol/pistol_deagle/reload_deagle.dmx'}
def digest(p): return hashlib.sha256(p.read_bytes()).hexdigest()
def decode(p):
 model=datamodel.load(str(p))
 indexes={id(e):i for i,e in enumerate(model.elements)}
 def value(v):
  if isinstance(v,datamodel.Element): return {'element':indexes[id(v)]}
  if v is None or isinstance(v,(str,bool,int,float)): return v
  if isinstance(v,bytes): return {'bytes':v.hex()}
  try: return [value(x) for x in v]
  except TypeError: raise TypeError((type(v).__name__,repr(v)))
 canonical=[{'name':e.name,'type':e.type,'attributes':{k:value(v) for k,v in e.items()}} for e in model.elements]
 clip=next(e for e in model.elements if e.type=='DmeChannelsClip')
 channels=[e for e in model.elements if e.type=='DmeChannel']
 return {'path':str(p),'sha256':digest(p),'elements':len(model.elements),'channels':len(channels),'keys':sum(len(e['log']['layers'][0]['times']) for e in channels),'frameRate':float(clip['frameRate']),'duration':float(clip['timeFrame']['duration']),'canonical':canonical}
rows={k:decode(p) for k,p in paths.items()}
a,b=rows['import-era']['canonical'],rows['fresh']['canonical']
assert len(a)==len(b)
diffs=[]
def compare(a,b,path=''):
 if type(a)!=type(b): diffs.append({'path':path,'before':a,'current':b}); return
 if isinstance(a,dict):
  if set(a)!=set(b): diffs.append({'path':path,'beforeKeys':list(a),'currentKeys':list(b)}); return
  for k in a: compare(a[k],b[k],path+'/'+k)
 elif isinstance(a,list):
  if len(a)!=len(b): diffs.append({'path':path,'beforeLength':len(a),'currentLength':len(b)}); return
  for i,(x,y) in enumerate(zip(a,b)): compare(x,y,path+'/'+str(i))
 elif a!=b: diffs.append({'path':path,'before':a,'current':b})
compare(a,b)
for row in rows.values():
 row['semanticSha256']=hashlib.sha256(json.dumps(row.pop('canonical'),sort_keys=True,separators=(',',':')).encode()).hexdigest()
result={'schema':1,'probeSha256':digest(Path(__file__)),'parserSha256':digest(repo/'.local-tools/datamodel.py'),'rows':rows,'differences':diffs,'method':'Compare every decoded element name, type, attribute and reference by element ordinal; ignore exporter-generated element UUIDs only. No native runtime or trainer skeleton equivalence inferred.'}
(out/'motion-comparison.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps(result,indent=2))
