"""Current-client viewmodel recoil: bounded static call-chain proof and execution.

Runs only camera/model angle-add instructions and native AngleQuaternion in
private Unicorn memory. sincosf is a host shim. No game process is opened.
Other procedural motion, animation graphs and prediction clocks are excluded.
"""
import argparse,hashlib,json,math,mmap,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];AUDIT=ROOT.parent/'native-audit'
sys.path.insert(0,str(AUDIT/'python'))
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64,UC_HOOK_CODE
from unicorn.x86_const import *
F=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
pack=lambda v:struct.pack('<'+str(len(v))+'f',*v)
bits=lambda v:int.from_bytes(pack(v),'little')
cs=Cs(CS_ARCH_X86,CS_MODE_64);cs.detail=True
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--portable-out',type=Path);args=p.parse_args()
path=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
stream=path.open('rb');elf=ELFFile(stream);data=mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ)
sha=hashlib.sha256(data).hexdigest();assert sha=='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
segments=[s for s in elf.iter_segments()if s['p_type']=='PT_LOAD']
def read(a,n):
 assert 0<n<=8192
 s=next(s for s in segments if s['p_vaddr']<=a and a+n<=s['p_vaddr']+s['p_filesz']);offset=s['p_offset']+a-s['p_vaddr'];return data[offset:offset+n]
def u64(a):return struct.unpack('<Q',read(a,8))[0]
checks=[]
for a,m,o in [
 (0x19cb808,'lea','rsi, [rbx + 0x10]'),(0x19cb812,'call','qword ptr [rax + 0x80]'),
 (0x1932388,'mov','r14, rsi'),(0x19327b1,'mov','r15, qword ptr [rbx + 0x12b0]'),
 (0x19327cd,'lea','rdx, [r14 + 0x4b8]'),(0x19327e1,'call','qword ptr [rax + 0x110]'),
 (0x156a082,'jmp','0x1794c10'),(0x1794c6a,'mov','rax, qword ptr [rax + 0x118]'),
 (0x152b36b,'call','0x1512160'),(0x19cb87b,'mov','rax, qword ptr [rbx + 0x4c8]'),
 (0x19cb882,'mov','qword ptr [rip + 0x2f703e7], rax'),
 (0x19d96e0,'lea','rax, [rip + 0x2f62589]'),(0x1f9b847,'call','0x19d96e0'),
 (0x1f9b84f,'mov','qword ptr [rbp - 0x40], rdx'),(0x1f9b980,'lea','rdx, [rbp - 0x40]'),
 (0x1f9b98d,'call','0x1a30930'),(0x1a3098c,'jmp','0x1fa7ac0'),
 (0x1fa7dd8,'call','0x1fa7960'),(0x1fa799c,'call','0x1fa6770'),
 (0x1fa7159,'call','0x1512160'),(0x1fa7170,'mulps','xmm0, xmmword ptr [rip - 0x14ac037]'),
 (0x1fa7f8f,'call','0xd8dd70'),(0x1fa7fa3,'call','0xd8dd70'),
 (0x1fa809b,'call','0x23bb110'),
]:
 i=next(cs.disasm(read(a,15),a));assert(i.mnemonic,i.op_str)==(m,o),(hex(a),i.mnemonic,i.op_str);checks.append(dict(at=hex(a),instruction=m+' '+o))
assert u64(0x4514430)==0x45126c8 and u64(0x45126c8+0x80)==0x1932380
assert u64(0x44bcb30+0x110)==0x1569f50 and u64(0x44bcb30+0x118)==0x152b190
assert u64(0x44f8d18+0xa0)==0x19cb7d0
assert struct.unpack('<f',read(0xafb140,4))[0]==F(.325)
assert struct.unpack('<f',read(0xafb100,4))[0]==F(.45)
ranges=[('view-publisher',0x19cb7d0,0xca),('clientmode-constructor',0x1ae2eb0,0x65),
 ('view-setup',0x1932380,0x1030),('camera-dispatch',0x1569f50,0x165),('base-camera-dispatch',0x1794c10,0xbf),
 ('camera-composition',0x152b190,0x6f0),('combined-aim-punch',0x1512160,0x390),
 ('view-angle-getter',0x19d96e0,8),('hud-update-local-path',0x1f9b7d4,0x1c3),
 ('player-hud-forwarder',0x1a30930,0x61),('hud-setup',0x1fa7ac0,0x7eb),
 ('hud-adjust',0x1fa7960,0x15c),('hud-procedural',0x1fa6770,0x11f0),
 ('native-angle-quaternion',0x23bb110,0xeb)]
out=AUDIT/'reports/reaudit-viewmodel-native';out.mkdir(exist_ok=True);manifest=[]
for name,a,n in ranges:
 raw=read(a,n);(out/(name+'.txt')).write_text('\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}'for i in cs.disasm(raw,a))+'\n')
 manifest.append(dict(name=name,address=hex(a),bytes=n,sha256=hashlib.sha256(raw).hexdigest()))
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x5000000);u.mem_map(0x6000000,0x20000)
for s in segments:u.mem_write(s['p_vaddr'],s.data())
arg,frame,stop=0x6000000,0x601f000,0x601ff00
allowed=[(0x152b370,0x152b3ad),(0x1fa715e,0x1fa719e),(0x23bb110,0x23bb1fb)]
def hook(uc,a,n,_):
 if any(lo<=a<hi for lo,hi in allowed):return
 assert a==0xc78e50,hex(a)
 x=struct.unpack('<f',uc.reg_read(UC_X86_REG_XMM0).to_bytes(16,'little')[:4])[0]
 uc.mem_write(uc.reg_read(UC_X86_REG_RDI),pack([math.sin(x)]));uc.mem_write(uc.reg_read(UC_X86_REG_RSI),pack([math.cos(x)]))
 sp=uc.reg_read(UC_X86_REG_RSP);dest=struct.unpack('<Q',uc.mem_read(sp,8))[0];uc.reg_write(UC_X86_REG_RSP,sp+8);uc.reg_write(UC_X86_REG_RIP,dest)
u.hook_add(UC_HOOK_CODE,hook)
def add(base,aim,which):
 lo,hi=allowed[which];u.mem_write(arg,pack(base));u.reg_write(UC_X86_REG_RBP,frame);u.reg_write(UC_X86_REG_R12,arg)
 u.reg_write(UC_X86_REG_XMM0,bits(aim[:2]));u.reg_write(UC_X86_REG_XMM1,bits(aim[2:]));u.emu_start(lo,hi,count=40)
 assert u.reg_read(UC_X86_REG_RIP)==hi
 return list(struct.unpack('<3f',u.mem_read(arg,12)))
def quat(angle):
 u.mem_write(arg,pack(angle));sp=frame-0x200;u.mem_write(sp,struct.pack('<Q',stop));u.reg_write(UC_X86_REG_RSP,sp);u.reg_write(UC_X86_REG_RDI,arg)
 u.emu_start(0x23bb110,stop,count=140);assert u.reg_read(UC_X86_REG_RIP)==stop
 return list(struct.unpack('<4f',u.reg_read(UC_X86_REG_XMM0).to_bytes(16,'little')))
rows=[]
for base in [[0,0,0],[-60,0,0],[60,0,0],[0,135,0],[-45,-130,0],[45,90,-2]]:
 for aim in [[0,0,0],[-4,1,0],[-12,-3,0],[-24,6,0],[6,-2,-4],[-7,3,5]]:
  for kick in [[0,0,0],[-1.1,.57,0],[.75,0,0]]:
   prior=[F(F(a)+F(b))for a,b in zip(base,kick)];camera=add(prior,aim,0);model=add(camera,aim,1)
   assert camera==[F(a+F(F(b)*F(.45)))for a,b in zip(prior,aim)]
   assert model==[F(a+F(F(b)*F(.325)))for a,b in zip(camera,aim)]
   rows.append(dict(base=base,physical=aim,kick=kick,camera=camera,model=model,cameraQuaternion=quat(camera),modelQuaternion=quat(model)))
report=dict(method=__doc__,clientSha256=sha,scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 instructionChecks=checks,bindingChecks=5,ranges=manifest,rows=rows,
 rules=['Normal local HUD base angles come from the published main camera view, already including camera-only kick and 0.45 combined physical aim punch.',
 'The procedural model transform adds float32 0.325 times the same combined physical aim punch to its incoming world QAngles.',
 'Both arm and weapon entities receive the resulting world angles. Native AngleQuaternion supplies their stored render rotation.',
 'Motion outside the graph includes velocity/air state bob and smoothed angle sway; graph-node absence is not proof of no bob.'],
 limits=['Arithmetic execution uses supplied angles, not recorded frame clocks or full renderer execution.',
 'Movement bob, sway, scope/hand/state blends, imported clips, origin offsets and projection parity are outside this isolated recoil comparison.',
 'Camera sampling and command-history phase remain separate unresolved timing work.'])
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
if args.portable_out:
 portable={k:v for k,v in report.items()if k not in ('instructionChecks','ranges')};portable['instructionChecks']=len(checks)
 portable['ranges']=[{k:v for k,v in r.items()if k!='address'}for r in manifest]
 args.portable_out.write_text(json.dumps(portable,indent=2)+'\n')
print(json.dumps(dict(cases=len(rows),nativeExecutions=len(rows)*4,instructionChecks=len(checks),bindings=5,report=str(out/'report.json'))))
