"""Launch the approved offline CS2 target and read only its motion/frame state.

The sampler is the target's ancestor for Linux read permission. It never writes
game memory or opens any other process memory, and records numeric motion state
only. Native locations are current-hash-bound and remain in local artifacts.
"""
import hashlib,json,os,struct,subprocess,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'native-audit'
binary=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
digest=hashlib.sha256()
with binary.open('rb') as source:
 for chunk in iter(lambda:source.read(1048576),b''):digest.update(chunk)
assert digest.hexdigest()=='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
out=ROOT/'reports/reaudit-motion-runtime';out.mkdir(exist_ok=True)
assert not (out/'samples.jsonl').exists(), 'Retain previous capture; use a fresh output path'
child=subprocess.Popen(['bash',str(ROOT/'cs2-portable.sh'),'+exec','native_audit_bob_boot','+map','de_dust2'],start_new_session=True,stdout=(out/'game.log').open('w'),stderr=subprocess.STDOUT)
(out/'launch.json').write_text(json.dumps({'launcherPid':child.pid,'startedAt':time.time(),'clientSha256':digest.hexdigest(),'method':__doc__},indent=2)+'\n')
def descendants(pid):
 try:children=[int(v)for v in Path(f'/proc/{pid}/task/{pid}/children').read_text().split()]
 except (FileNotFoundError,PermissionError):return []
 return children+[q for c in children for q in descendants(c)]
def findgame():
 for pid in [child.pid]+descendants(child.pid):
  try:
   if Path(f'/proc/{pid}/comm').read_text().strip()!='cs2':continue
   for line in Path(f'/proc/{pid}/maps').read_text().splitlines():
    parts=line.split()
    if len(parts)>=6 and parts[-1].endswith('/game/csgo/bin/linuxsteamrt64/libclient.so') and int(parts[2],16)==0:
     return pid,int(parts[0].split('-')[0],16)
  except (FileNotFoundError,PermissionError):pass
 return None
mem=None;pid=base=0;arms=player=0;lastscan=lastframe=-1;lastkey=None;samples=errors=0
start=time.monotonic();laststatus=start
with (out/'samples.jsonl').open('w',buffering=1) as stream:
 while child.poll() is None and not (out/'stop-sampling').exists():
  try:
   if mem is None:
    found=findgame()
    if not found:time.sleep(.2);continue
    pid,base=found;mem=os.open(f'/proc/{pid}/mem',os.O_RDONLY);print('Bound game-only sampler',pid,flush=True)
   def read(a,n):
    assert 0<a<2**63 and 0<n<=65536
    raw=os.pread(mem,n,a)
    if len(raw)!=n:raise OSError('short read')
    return raw
   def u64(a):return struct.unpack('<Q',read(a,8))[0]
   def u32(a):return struct.unpack('<I',read(a,4))[0]
   def floats(a,n):return list(struct.unpack('<'+str(n)+'f',read(a,n*4)))
   now=time.monotonic()
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
     if len(matches)==1:arms,player=matches[0]
     else:arms=player=0
   if not arms:time.sleep(.01);continue
   gp=u64(base+0x467be58);frame=u32(gp+4)
   a0=read(arms+0x12d4,0x50)
   if (frame,a0)==lastkey:time.sleep(.002);continue
   global_time,delta=floats(gp+0x30,2)
   node=u64(player+0x4a0);modelnode=u64(arms+0x4a0)
   row={'monotonic':now,'unix':time.time(),'frame':frame,'currentTime':global_time,'frameDelta':delta,'tick':u32(gp+0x44),
    'sourceAngles':floats(player+0x44a0,3),'historyTimes':floats(player+0x4538,4),'historyAngles':floats(player+0x4548,12),'pawnSwayRate':floats(player+0x4578,3),'predictionInterpolation':bool(read(player+0x4518,1)[0]),
    'flags':u32(player+0x564),'storedVelocity':floats(player+0x5a0,3),'pawnTransform':floats(node+0x10,8),'modelTransform':floats(modelnode+0x10,8),
    'cycle':struct.unpack_from('<f',a0,0)[0],'smoothVelocity':list(struct.unpack_from('<4f',a0,4)),
    'bob':list(struct.unpack_from('<3f',a0,0x14)),'animationBob':list(struct.unpack_from('<2f',a0,0x20)),
    'swayTarget':list(struct.unpack_from('<3f',a0,0x2c)),'swaySmooth':list(struct.unpack_from('<3f',a0,0x38)),
    'swayTime':struct.unpack_from('<f',a0,0x44)[0],'air':struct.unpack_from('<f',a0,0x48)[0]}
   if frame!=u32(gp+4) or a0!=read(arms+0x12d4,0x50):continue
   stream.write(json.dumps(row,allow_nan=False)+'\n');samples+=1;lastframe=frame;lastkey=(frame,a0)
   if now-laststatus>5:
    laststatus=now;(out/'status.json').write_text(json.dumps({'pid':pid,'elapsed':now-start,'samples':samples,'errors':errors,'lastFrame':frame,'lastTime':global_time})+'\n')
  except (OSError,ValueError,struct.error) as err:
   errors+=1
   if errors<=5:print(type(err).__name__,str(err),flush=True)
   time.sleep(.1)
if mem is not None:os.close(mem)
(out/'sampler-finished.json').write_text(json.dumps({'pid':pid,'exitCode':child.poll(),'samples':samples,'errors':errors,'stoppedByFile':(out/'stop-sampling').exists()})+'\n')
print('Sampler finished',samples,'samples',errors,'read errors',flush=True)
if child.poll() is None:child.wait()
