"""Bounded current-byte proof for scene-orientation evidence; no live process access."""
import hashlib,json,struct,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]/'native-audit'
sys.path.insert(0,str(ROOT/'python'))
from elftools.elf.elffile import ELFFile
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
OUT=ROOT/'reports/reaudit-scene-orientation'
binary=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
digest=hashlib.sha256()
with binary.open('rb') as source:
    for chunk in iter(lambda:source.read(1048576),b''):digest.update(chunk)
assert digest.hexdigest()=='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
f=binary.open('rb')
e=ELFFile(f)
segments=[(s['p_vaddr'],s['p_offset'],s['p_filesz'])for s in e.iter_segments()if s['p_type']=='PT_LOAD']
def read(a,n):
    v,o,z=next(t for t in segments if t[0]<=a and a+n<=t[0]+t[2])
    f.seek(o+a-v)
    return f.read(n)
cs=Cs(CS_ARCH_X86,CS_MODE_64)
ranges=[('pawn-abs-transform-accessor',0xd8de20,0x50),('scene-abs-transform-update',0x16f3ee0,0x310),('scene-local-angles-setter',0x16f4d00,0x1c0),('scene-abs-angles-setter',0x16f50f0,0x3c2),('scene-local-angle-copy',0x16f5710,0x22),('scene-evaluated-transform-write',0x16f4300,0x6ca),('pawn-explicit-transform-override',0x15b1cf0,0xf6),('base-explicit-transform-angle-argument',0xdce8c4,0x30),('pawn-owned-entity-array-angle-update',0x1a9958c,0x29)]
proof=[]
for name,a,n in ranges:
    b=read(a,n)
    proof.append(dict(name=name,address=hex(a),size=n,sha256=hashlib.sha256(b).hexdigest(),instructions=[f'{i.address:x}: {i.mnemonic} {i.op_str}'for i in cs.disasm(b,a)]))
bindings=[]
for t in json.loads((OUT/'pawn-class-vtables.json').read_text()):
    if t['name']not in ['16C_BasePlayerPawn','18C_CSPlayerPawnBase','14C_CSPlayerPawn']:continue
    table=int(t['table'],16)
    for slot in [0x280,0x488]:
        current=struct.unpack('<Q',read(table+slot,8))[0]
        expected=next(x for x in t['slots']if int(x['slot'],16)==slot)
        assert current==int(expected['address'],16),(t['name'],slot)
        bindings.append(dict(name=t['name'],table=t['table'],slot=hex(slot),address=hex(current)))
report=dict(binary='libclient.so',clientSha256=digest.hexdigest(),validation='Full binary hash checked before bounded current ELF range and vtable reads.',rangeBytesRead=sum(n for _,_,n in ranges),ranges=proof,vtableBindings=bindings)
(OUT/'proof-portable-current-ranges.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(dict(rangeCount=len(proof),rangeBytesRead=report['rangeBytesRead'],vtableWordsChecked=len(bindings))))
