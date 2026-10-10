"""Read-only bounded Capstone inspection; no engine or disassembler service launch.

Use --all to refresh the retained resolver/helper/parser evidence. An optional
name, hexadecimal entry and hexadecimal byte count select one custom range.
"""
import hashlib,json,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'native-audit';sys.path.insert(0,str(ROOT/'python'))
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
TARGET=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
digest=hashlib.sha256()
with TARGET.open('rb')as f:
 for chunk in iter(lambda:f.read(1024*1024),b''):digest.update(chunk)
sha=digest.hexdigest()
assert sha=='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
cs=Cs(CS_ARCH_X86,CS_MODE_64);cs.detail=True
with TARGET.open('rb')as f:
 elf=ELFFile(f);segments=[(s['p_vaddr'],s['p_offset'],s['p_filesz'])for s in elf.iter_segments()if s['p_type']=='PT_LOAD']
 def read(address,size):
  for va,off,length in segments:
   if va<=address and address+size<=va+length:f.seek(off+address-va);return f.read(size)
  return b''
 targets=[('resolver',0x14ac0a0,0x490)]
 if len(sys.argv)>1 and sys.argv[1]=='--all':
  targets += [('select',0x1496e60,0x1560),('pair-compare',0x1487b20,0x30),
   ('pair-arithmetic',0x22b3c90,0x90),('pair-subtract',0x22b4310,0xa0),
   ('pair-increment',0x22b7270,0x10),('pair-constructor',0x22b49a0,0x100),
   ('pair-from-ticks',0x22b3080,0x2c0),('current-time-pair',0x17fd290,0x110),
   ('tick-domains',0x134e820,0x170),('entry-parser',0x143d000,0x6b0),
   ('usercmd-parser',0x143d6b0,0x550),('next-attacks',0x16416b0,0x70)]
 elif len(sys.argv)>1:
  assert len(sys.argv)==4, 'Expected --all or NAME HEX_ENTRY HEX_BYTES'
  targets=[(sys.argv[1],int(sys.argv[2],16),min(int(sys.argv[3],16),0x3000))]
 output=[];metadata=[]
 for name,entry,size in targets:
  code=read(entry,size);lines=[];calls=[]
  for i in cs.disasm(code,entry):
   extra=[]
   for op in i.operands:
    if op.type==3 and op.mem.base==41:
     address=i.address+i.size+op.mem.disp;data=read(address,128)
     value=struct.unpack('<f',data[:4])[0]if len(data)>=4 else None
     if value is not None:extra.append(f'ref={address:x} f32={value}')
     literal=data.split(b'\0')[0]
     if literal and all(32<=v<127 for v in literal):extra.append(repr(literal.decode()))
   if i.mnemonic=='call':calls.append({'at':hex(i.address),'target':i.op_str})
   lines.append(f'{i.address:x}: {i.mnemonic} {i.op_str}'+(' ; '+'; '.join(extra)if extra else ''))
  path=ROOT/'reports'/f'reaudit-attack-history-{name}.txt';path.write_text('\n'.join(lines)+'\n');output.append(str(path));metadata.append(dict(name=name,address=hex(entry),bytes=len(code),sha256=hashlib.sha256(code).hexdigest(),calls=calls))
  item=dict(serverSha256=sha,method=__doc__,ranges=[metadata[-1]],outputs=[str(path)])
  (ROOT/'reports'/f'reaudit-attack-history-{name}.json').write_text(json.dumps(item,indent=2)+'\n')
 report=dict(serverSha256=sha,method=__doc__,ranges=metadata,outputs=output)
 if len(targets)>1:(ROOT/'reports/reaudit-attack-history-inspection.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps(report,indent=2))
