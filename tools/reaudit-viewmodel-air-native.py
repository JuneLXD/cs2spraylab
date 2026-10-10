"""Execute native airborne model motion, recoil addition and angle conversion.

The ordinary movement-bob block runs with zero velocity to isolate its separate
air state. Game capture corroborates that state's actual invocation cadence.
No live process or renderer is opened. Raw locations stay in tools/local reports.
"""
import hashlib,json,runpy,struct
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
ns=runpy.run_path(str(ROOT/'tools/reaudit-viewmodel-bob-native.py'))
u,state,angles,frame=map(ns.get,['u','state','angles','frame'])
pack,bits,F=map(ns.get,['pack','bits','F'])
ns['ranges'].append((0x23bb110,0x23bb1fb))
X0,X1,RBP,R12,RSP,RDI,RIP=map(ns.get,['UC_X86_REG_XMM0','UC_X86_REG_XMM1','UC_X86_REG_RBP','UC_X86_REG_R12','UC_X86_REG_RSP','UC_X86_REG_RDI','UC_X86_REG_RIP'])
def model_recoil(base,punch):
 u.mem_write(angles,pack(base));u.reg_write(RBP,frame);u.reg_write(R12,angles)
 u.reg_write(X0,bits(punch[:2]));u.reg_write(X1,bits(punch[2:]));u.emu_start(0x1fa715e,0x1fa719e,count=40)
 assert u.reg_read(RIP)==0x1fa719e
 return list(struct.unpack('<3f',u.mem_read(angles,12)))
def quat(angle):
 stop=frame+0x800;sp=frame-0x200;u.mem_write(angles,pack(angle));u.mem_write(sp,struct.pack('<Q',stop))
 u.reg_write(RSP,sp);u.reg_write(RDI,angles);u.emu_start(0x23bb110,stop,count=140)
 assert u.reg_read(RIP)==stop
 return list(struct.unpack('<4f',u.reg_read(X0).to_bytes(16,'little')))
sequences=[]
for name,dt,camera,punch,air_frames,ground_frames in [
 ('level60',1/60,[0,0,0],[0,0,0],24,24),
 ('level120',1/120,[0,0,0],[0,0,0],24,24),
 ('steep_recoil',1/60,[-60,135,-2],[-12,3,5],24,24),
 ('opposite_recoil',1/30,[60,-130,3],[6,-2,-4],24,24),
 ('pitch_limit',1/60,[-89.9,90,0],[0,0,0],24,24),
 ('zero_delta',0,[0,0,0],[0,0,0],24,24),
 ('short_jump',.05,[35,-90,5],[0,0,0],7,15),
 ('range_wiring',1/60,[-60,135,0],[-12,3,0],24,24),
 ('duel_wiring',1/60,[-60,135,2.25],[-12,3,5],24,24),
]:
 u.mem_write(state+0x12d4,b'\0'*0x50);rows=[]
 for i in range(air_frames+ground_frames):
  grounded=i>=air_frames;out=ns['step'](dt,[0,0,0],camera,grounded,0,(i+1)*dt)
  model=model_recoil(out['angles'],punch)
  rows.append(dict(frame=i+1,grounded=grounded,air=out['air'],origin=out['origin'],model=model,
    modelQuaternion=quat(model)))
 sequences.append(dict(name=name,dt=dt,camera=camera,punch=punch,cameraQuaternion=quat(camera),rows=rows))
report=dict(method=__doc__,clientSha256=ns['sha'],scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 sequences=sequences,limits=['Supplied camera, physical punch, grounded flag and frame delta; no native renderer or prediction loop.',
 'Velocity is zero to isolate AIR; lateral bob, look sway, lifecycle resets, zoom/hand transitions and graph layers remain separate.',
 'Native sin/cos entry points use host math shims rounded to float32.'])
out=ROOT/'docs/evidence/reaudit-viewmodel-air-native.json';out.write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(sequences=len(sequences),frames=sum(len(s['rows'])for s in sequences),out=str(out))))
