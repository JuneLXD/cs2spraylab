"""Launch the approved offline CS2 target and read only its motion/frame state.

The sampler is the target's ancestor for Linux read permission. It never writes
game memory or opens any other process memory, and records numeric motion state
only. Native locations are current-hash-bound and remain in local artifacts.
"""
import argparse,hashlib,json,os,struct,subprocess,time,runpy
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'native-audit'
binary=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
digest=hashlib.sha256()
with binary.open('rb') as source:
 for chunk in iter(lambda:source.read(1048576),b''):digest.update(chunk)
assert digest.hexdigest()=='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output',required=True,help='New directory name under native-audit/reports; never overwrites a capture')
parser.add_argument('--velocity-history',action='store_true',help='Include bounded native velocity ring entries and metadata')
parser.add_argument('--scene-writer',action='store_true',help='Include native body state, prepared inputs and command clocks')
parser.add_argument('--body-clock',action='store_true',help='Include controller tick base and active movement-clock markers')
parser.add_argument('--transform-history',action='store_true',help='Include separately bound TransformHistory records and guards')
parser.add_argument('--velocity-offset',action='store_true',help='Include bound interpolation-group offset producer fields')
parser.add_argument('--frame-history',action='store_true',help='Include engine presented frames, input records and camera punch anchors')
args=parser.parse_args()
engine_digest=None
if args.frame_history:
 engine_digest=hashlib.sha256()
 with (ROOT.parent/'cs2-game/game/bin/linuxsteamrt64/libengine2.so').open('rb') as source:
  for chunk in iter(lambda:source.read(1048576),b''):engine_digest.update(chunk)
 assert engine_digest.hexdigest()=='f5745c46cb38b1d120c3c7c5f0f19590f46c3d1bd136ee527b276cce8bfaba14'
assert Path(args.output).name==args.output
out=ROOT/'reports'/args.output;out.mkdir(exist_ok=True)
assert not (out/'samples.jsonl').exists(), 'Retain previous capture; use a fresh output path'
extra_readers=[]
reader_specs=[('reaudit-sway-capture-fields.py','read_sway_fields'),('reaudit-body-capture-fields.py','read_body_fields')]
if args.velocity_history:reader_specs.append(('reaudit-velocity-capture-fields.py','read_velocity_fields'))
if args.scene_writer:reader_specs.append(('reaudit-scene-writer-capture-fields.py','read_scene_writer_fields'))
if args.body_clock:reader_specs.append(('reaudit-body-clock-capture-fields.py','read_body_clock_fields'))
if args.transform_history:reader_specs.append(('reaudit-transform-history-capture-fields.py','read_transform_history_fields'))
if args.velocity_offset:reader_specs.append(('reaudit-velocity-offset-capture-fields.py','read_velocity_offset_fields'))
if args.frame_history:reader_specs.append(('reaudit-frame-history-capture-fields.py','read_frame_history_fields'))
reader_wrappers={'reaudit-body-clock-capture-fields.py':'bodyClock','reaudit-transform-history-capture-fields.py':'transformHistory','reaudit-velocity-offset-capture-fields.py':'velocityOffset'}
for name,function in reader_specs:
 path=Path(__file__).resolve().parent/name
 assert path.exists(), str(path)
 reader=runpy.run_path(str(path))[function]
 # Keep this helper's named fields/guards separate from other readers. Its
 # guards are included in the complete second read and equality check below.
 if name in reader_wrappers:
  def wrapped_reader(read,base,player,node,reader=reader,key=reader_wrappers[name]):return {key:reader(read,base,player,node)}
  extra_readers.append(wrapped_reader)
 elif name=='reaudit-frame-history-capture-fields.py':
  def frame_reader(read,base,player,node,reader=reader):return {'frameHistory':reader(read,base,engine_base,player)}
  extra_readers.append(frame_reader)
 else:extra_readers.append(reader)
child=subprocess.Popen(['bash',str(ROOT/'cs2-portable.sh'),'+exec','native_audit_bob_002_boot','+map','de_dust2'],start_new_session=True,stdout=(out/'game.log').open('w'),stderr=subprocess.STDOUT)
(out/'launch.json').write_text(json.dumps({'launcherPid':child.pid,'startedAt':time.time(),'clientSha256':digest.hexdigest(),'method':__doc__,'velocityHistory':args.velocity_history,'sceneWriter':args.scene_writer,'bodyClock':args.body_clock,'samplerSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),'helperHashes':{name:hashlib.sha256((Path(__file__).resolve().parent/name).read_bytes()).hexdigest()for name in [x[0]for x in reader_specs]+['reaudit-sway-clock-inputs.py']}},indent=2)+'\n')
(out/'extensions.json').write_text(json.dumps({'transformHistory':args.transform_history,'velocityOffset':args.velocity_offset,'frameHistory':args.frame_history,'engineSha256':engine_digest.hexdigest() if engine_digest else None},indent=2)+'\n')
def descendants(pid):
 try:children=[int(v)for v in Path(f'/proc/{pid}/task/{pid}/children').read_text().split()]
 except (FileNotFoundError,PermissionError):return []
 return children+[q for c in children for q in descendants(c)]
def findgame():
 for pid in [child.pid]+descendants(child.pid):
  try:
   if Path(f'/proc/{pid}/comm').read_text().strip()!='cs2':continue
   bases={}
   for line in Path(f'/proc/{pid}/maps').read_text().splitlines():
    parts=line.split()
    if len(parts)>=6 and parts[-1].endswith('/game/csgo/bin/linuxsteamrt64/libclient.so') and int(parts[2],16)==0:
     bases['client']=int(parts[0].split('-')[0],16)
    if len(parts)>=6 and parts[-1].endswith('/game/bin/linuxsteamrt64/libengine2.so') and int(parts[2],16)==0:
     bases['engine']=int(parts[0].split('-')[0],16)
   if 'client' in bases and (not args.frame_history or 'engine' in bases):return pid,bases['client'],bases.get('engine',0)
  except (FileNotFoundError,PermissionError):pass
 return None
mem=None;pid=base=engine_base=0;arms=player=0;lastscan=lastframe=-1;lastkey=None;samples=errors=0
read_error_counts={}
start=time.monotonic();laststatus=start;rejectedClock=rejectedFields=0
with (out/'samples.jsonl').open('w',buffering=1) as stream:
 while child.poll() is None and not (out/'stop-sampling').exists():
  try:
   if mem is None:
    found=findgame()
    if not found:time.sleep(.2);continue
    pid,base,engine_base=found;mem=os.open(f'/proc/{pid}/mem',os.O_RDONLY);print('Bound game-only sampler',pid,flush=True)
   def read(a,n):
    if not 0<a<2**63:raise OSError('Target address unavailable during lifecycle transition')
    assert 0<n<=65536
    raw=os.pread(mem,n,a)
    if len(raw)!=n:raise OSError('short read')
    return raw
   def u64(a):return struct.unpack('<Q',read(a,8))[0]
   def u32(a):return struct.unpack('<I',read(a,4))[0]
   def floats(a,n):return list(struct.unpack('<'+str(n)+'f',read(a,n*4)))
   now=time.monotonic()
   if now-laststatus>5:
    laststatus=now;(out/'status.json').write_text(json.dumps({'pid':pid,'elapsed':now-start,'samples':samples,'errors':errors,'readErrorCounts':read_error_counts,'arms':arms,'player':player,'rejectedClock':rejectedClock,'rejectedFields':rejectedFields})+'\n')
   if now-lastscan>1:
    lastscan=now;system=u64(base+0x46b7100);foundarms=[];foundplayers=[]
    if system:
     for chunk in struct.unpack('<64Q',read(system,512)):
      if not chunk:continue
      records=read(chunk,512*0x70)
      for index in range(512):
       entity=struct.unpack_from('<Q',records,index*0x70)[0]
       if not entity:continue
       vtable=u64(entity)
       if vtable==base+0x4548788:foundarms.append((entity,u32(entity+0x698)))
       if vtable==base+0x4500730:foundplayers.append((entity,struct.unpack_from('<I',records,index*0x70+0x10)[0]))
     matches=[(a,p)for a,h in foundarms for p,ph in foundplayers if h==ph]
     (out/'identity.json').write_text(json.dumps({'pid':pid,'base':base,'arms':foundarms,'players':foundplayers,'matches':matches,'time':now})+'\n')
     if len(matches)==1:arms,player=matches[0]
     else:
      selected=json.loads((out/'selected-arm.json').read_text())if(out/'selected-arm.json').exists()else None
      arms,player=next(((a,p)for a,p in matches if a==selected),(0,0))
   if not arms:time.sleep(.01);continue
   gp=u64(base+0x467be58);frame=u32(gp+4)
   a0=read(arms+0x12d4,0x50)
   global_time,delta=floats(gp+0x30,2)
   node=u64(player+0x4a0);modelnode=u64(arms+0x4a0)
   velocity_block=read(player+0x5a0,0xd0);context=read(base+0x46b8180,17)
   extras={}
   for extra_reader in extra_readers:extras.update(extra_reader(read,base,player,node))
   extra_key=json.dumps(extras,sort_keys=True)
   row={'armsEntity':arms,'pawnEntity':player,'monotonic':now,'unix':time.time(),'frame':frame,'currentTime':global_time,'frameDelta':delta,'tick':u32(gp+0x44),
    'sourceAngles':floats(player+0x44a0,3),'historyTimes':floats(player+0x4538,4),'historyAngles':floats(player+0x4548,12),'pawnSwayRate':floats(player+0x4578,3),'predictionInterpolation':bool(read(player+0x4518,1)[0]),
    'flags':u32(player+0x564),'storedVelocity':floats(player+0x5a0,3),'pawnTransform':floats(node+0x10,8),'modelTransform':floats(modelnode+0x10,8),
    'velocityInterpolationEnabled':bool(read(player+0x668,1)[0]),'moveType':read(player+0x69e,1)[0],
    'velocityCache0':floats(player+0x5d0,3),'velocityCache1':floats(player+0x5f8,3),'velocityCacheTimes':floats(player+0x620,2),
    'velocityValueFlags':read(player+0x630,1)[0],'velocityHistoryFlags':list(read(player+0x638,4)),
    'interpolationContext':dict(selector=struct.unpack_from('<i',context,0)[0],stage=struct.unpack_from('<i',context,4)[0],times=list(struct.unpack_from('<2f',context,8)),bracketMode=context[16]),
    'extra':extras,
    'cycle':struct.unpack_from('<f',a0,0)[0],'smoothVelocity':list(struct.unpack_from('<4f',a0,4)),
    'bob':list(struct.unpack_from('<3f',a0,0x14)),'animationBob':list(struct.unpack_from('<2f',a0,0x20)),
    'swayTarget':list(struct.unpack_from('<3f',a0,0x2c)),'swaySmooth':list(struct.unpack_from('<3f',a0,0x38)),
    'swayTime':struct.unpack_from('<f',a0,0x44)[0],'air':struct.unpack_from('<f',a0,0x48)[0]}
   guard_extras={}
   for extra_reader in extra_readers:guard_extras.update(extra_reader(read,base,player,node))
   if frame!=u32(gp+4) or a0!=read(arms+0x12d4,0x50) or [global_time,delta]!=floats(gp+0x30,2):rejectedClock+=1;continue
   if velocity_block!=read(player+0x5a0,0xd0) or context!=read(base+0x46b8180,17) or extra_key!=json.dumps(guard_extras,sort_keys=True):rejectedFields+=1;continue
   key=(frame,a0,velocity_block,context,extra_key,tuple(row['historyTimes']),tuple(row['pawnSwayRate']))
   if key==lastkey:time.sleep(.002);continue
   stream.write(json.dumps(row,allow_nan=False)+'\n');samples+=1;lastframe=frame;lastkey=key
   if now-laststatus>5:
    laststatus=now;(out/'status.json').write_text(json.dumps({'pid':pid,'elapsed':now-start,'samples':samples,'errors':errors,'readErrorCounts':read_error_counts,'lastFrame':frame,'lastTime':global_time})+'\n')
  except (OSError,ValueError,struct.error) as err:
   errors+=1
   reason=type(err).__name__+': '+str(err)
   read_error_counts[reason]=read_error_counts.get(reason,0)+1
   if errors<=5:print(type(err).__name__,str(err),flush=True)
   # A rejected concurrent history update is normal snapshot contention. The
   # old 100 ms lifecycle backoff also hid several subsequent stable ticks.
   time.sleep(.002 if isinstance(err,ValueError) and 'changed during read' in str(err) else .1)
if mem is not None:os.close(mem)
(out/'sampler-finished.json').write_text(json.dumps({'pid':pid,'exitCode':child.poll(),'samples':samples,'errors':errors,'readErrorCounts':read_error_counts,'stoppedByFile':(out/'stop-sampling').exists()})+'\n')
print('Sampler finished',samples,'samples',errors,'read errors',flush=True)
if child.poll() is None:child.wait()
