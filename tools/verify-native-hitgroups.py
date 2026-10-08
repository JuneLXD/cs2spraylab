"""Verify native neck/chest grouping and bounded armor checks without running CS2."""
import argparse,hashlib,json,struct
from pathlib import Path
from elftools.elf.elffile import ELFFile
from unicorn import Uc,UC_ARCH_X86,UC_MODE_64
from unicorn.x86_const import UC_X86_REG_RSP,UC_X86_REG_RDI,UC_X86_REG_ESI,UC_X86_REG_RAX,UC_X86_REG_RIP
p=argparse.ArgumentParser(description=__doc__);p.add_argument('server',type=Path);p.add_argument('--write',action='store_true');args=p.parse_args()
raw=args.server.read_bytes();sha=hashlib.sha256(raw).hexdigest()
assert sha=='0109636a2dfc2a2ec3dee2ead2fd45322b179a111013dbfb14d5cd91855a19d0','Revalidate changed server'
fixture=Path(__file__).resolve().parents[1]/'docs/native-hitgroup-evidence.json'
u=Uc(UC_ARCH_X86,UC_MODE_64);u.mem_map(0,0x4000000);u.mem_map(0x5000000,0x20000)
with args.server.open('rb') as f:
 for segment in ELFFile(f).iter_segments():
  if segment['p_type']=='PT_LOAD':u.mem_write(segment['p_vaddr'],segment.data())
actor=0x5000000;item=actor+0x4000;stack=actor+0x10000;end=actor+0x18000
u.mem_write(actor+0xdf8,struct.pack('<Q',item));u.mem_write(stack,struct.pack('<Q',end))
rows=[]
for group in range(9):
 for armor in [0,100]:
  for helmet in [False,True]:
   u.mem_write(actor+0x17ec,struct.pack('<I',armor));u.mem_write(item+0x49,bytes([helmet]));
   u.reg_write(UC_X86_REG_RSP,stack);u.reg_write(UC_X86_REG_RDI,actor);u.reg_write(UC_X86_REG_ESI,group)
   u.emu_start(0x1596040,end,count=100)
   assert u.reg_read(UC_X86_REG_RIP)==end
   rows.append(dict(group=group,armor=armor,helmet=helmet,protected=bool(u.reg_read(UC_X86_REG_RAX)&255)))
branches=struct.unpack('<9i',u.mem_read(0x823be4,36));assert branches[2]==branches[8]
report=dict(build=2000927,serverSha256=sha,armorFunction='0x1596040',damageFunction='0x15464f0',damageJumpTable='0x823be4',
 method='Offline Unicorn 2.1.4 emulation of the complete armor-group predicate with supplied armor/helmet fields; no imports or OS calls. Native damage dispatch maps groups 2 and 8 to the identical chest damage/flinch block at 0x1546f30.',
 damageBranches=[hex(0x823be4+x) for x in branches],armorCases=rows)
if args.write:fixture.write_text(json.dumps(report,indent=2)+'\n')
else:assert report==json.loads(fixture.read_text())
print('Verified',len(rows),'native armor cases and shared chest/neck damage branch')
