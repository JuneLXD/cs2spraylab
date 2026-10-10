"""Bounded offline shell-reload evidence from current server bytes and exports.

No process/game/bridge is opened. Raw addresses stay in local reports.
Run with MemoryMax=512M, MemorySwapMax=0, CPUQuota=100%.
"""
import argparse
import hashlib
import json
import mmap
import re
import struct
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]/'native-audit' if HERE.name=='tools' else HERE
sys.path.insert(0,str(ROOT/'python'))
from elftools.elf.elffile import ELFFile
from capstone import Cs, CS_ARCH_X86, CS_MODE_64

parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--range',nargs=3,action='append',metavar=('NAME','ADDRESS','LENGTH'))
parser.add_argument('--classes',action='store_true')
parser.add_argument('--proof',action='store_true',help='Recheck the interruption chain in current bytes')
parser.add_argument('--refs',nargs='+',type=lambda s:int(s,0))
args=parser.parse_args()
out=ROOT/'reports/reaudit-shell-reload';out.mkdir(exist_ok=True)
binary=ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
expected='c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
digest=hashlib.sha256()
with binary.open('rb')as stream:
    for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
assert digest.hexdigest()==expected
cs=Cs(CS_ARCH_X86,CS_MODE_64)
with binary.open('rb')as stream:
    elf=ELFFile(stream)
    segments=[(s['p_vaddr'],s['p_offset'],s['p_filesz'],s['p_flags'])for s in elf.iter_segments()if s['p_type']=='PT_LOAD']
    data=mmap.mmap(stream.fileno(),0,access=mmap.ACCESS_READ)
    def va(offset):return next(a+offset-o for a,o,n,_ in segments if o<=offset<o+n)
    def read(address,length):
        assert 0<length<=65536
        offset=next(o+address-a for a,o,n,_ in segments if a<=address and address+length<=a+n)
        return data[offset:offset+length]
    def pointers_to(value):
        found=[];start=0;needle=struct.pack('<Q',value)
        while(start:=data.find(needle,start))>=0:found.append(va(start));start+=8
        return found
    def listing(address,length):
        lines=[]
        for ins in cs.disasm(read(address,length),address):
            note=[]
            m=re.search(r'\[rip ([+-]) (0x[0-9a-f]+)\]',ins.op_str)
            if m:
                target=ins.address+ins.size+int(m[2],16)*(1 if m[1]=='+'else-1)
                try:
                    raw=read(target,64);s=raw.split(b'\0')[0]
                    if len(s)>2 and all(32<=c<127 for c in s):note.append(repr(s.decode()))
                    if 'ss' in ins.mnemonic:note.append(str(struct.unpack('<f',raw[:4])[0]))
                except StopIteration:pass
            lines.append(f'{ins.address:x}: {ins.mnemonic} {ins.op_str}'+(' ; '+' '.join(note)if note else''))
        return '\n'.join(lines)+'\n'
    if args.proof:
        # Raw layout is deliberately confined to this probe and local evidence.
        ranges={
            'shell-post-frame':(0x14b3fd0,0x2a0),
            'primary-ready':(0x1641710,0x90),
            'primary-dispatch':(0x14b0360,0x590),
            'shell-primary-wrappers':(0x14b3950,0x55),
            'shell-fire-helper':(0x14b32f0,0x650),
            'action-change':(0x14ae420,0x750),
            'reload-start':(0x14ad030,0x200),
            'action-begin':(0x14ac820,0x700),
            'deadline-setter':(0x14ac530,0x2f0),
            'next-primary-setter':(0x1653800,0x350),
            'reload-vdata-binding':(0x14c95c9,0x2f),
            'shell-reload-wrapper':(0x14aac50,0x30),
            'primary-shell-policy':(0xa23f00,0x10),
        }
        checks={
            'shell-post-frame':['mov esi, 1','call 0x16412f0','call 0x1641710','jne 0x14b4128','call 0x14b0360'],
            'primary-ready':['[rdi + 0x1190]','[rdi + 0x1194]','call 0x22b49a0','call 0x17fd290','setle dl','mov edx, 1'],
            'primary-dispatch':['[rax + 0xd68]','jne 0x14b0710','[rax + 0xd30]'],
            'shell-primary-wrappers':['0.25','call 0x14b32f0','0.20000000298023224'],
            'shell-fire-helper':['jle 0x14b3750','mov esi, 0x64','call 0x14ae420','call 0x14ac0a0','call 0xbb79e0','call 0x1653800'],
            'action-change':['cmp ax, 0x320','cmp si, 0x321','mov esi, 0x1b','call 0x14ac530','mov word ptr [rbx + 0x11d4], r12w','mov byte ptr [rbx + 0x1280], 0'],
            'reload-start':['mov byte ptr [rbx + 0x1280], 1','mov edx, 0x13','mov esi, 0x320','call 0x14ac820'],
            'action-begin':['cmp r12w, 0x320','je 0x14ace28','[rax + 0x7c8]','jmp 0x14ac530'],
            'deadline-setter':['and r12d, 1','xor esi, esi','call 0x1653800'],
            'reload-vdata-binding':['[r12 + 0x7c8]','m_flDisallowAttackAfterReloadStartDuration'],
            'shell-reload-wrapper':['[rax + 0xd90]'],
            'primary-shell-policy':['xor eax, eax','ret'],
        }
        evidence=[]
        for name,(address,length)in ranges.items():
            text=listing(address,length)
            for fragment in checks.get(name,[]):assert fragment in text,(name,fragment)
            target=out/('proof-'+name+'.txt');target.write_text(text)
            evidence.append(dict(id='SHELL-'+name,address=hex(address),length=length,
                sha256=hashlib.sha256(read(address,length)).hexdigest(),assertions=checks.get(name,[]),artifact=target.name))
        bindings=[]
        for name,table,primary in [('CWeaponNOVA',0x2614178,0x14b3990),('CWeaponXM1014',0x2615f18,0x14b3950),
                ('CWeaponSawedoff',0x2615048,0x14b3970),('CWeaponMag7',0x2606258,0x14b2ef0)]:
            rtti=struct.unpack('<Q',read(table-8,8))[0]
            string=struct.unpack('<Q',read(rtti+8,8))[0]
            assert read(string,len(name)+3).split(b'\0')[0]==(str(len(name))+name).encode()
            shell=name!='CWeaponMag7'
            wanted={0xd30:primary,0xd40:0x14b3fd0 if shell else 0x14b4510,
                    0xd68:0xa23f00 if shell else 0x1483c20,0xd88:0x14aac50 if shell else 0x14aa280,
                    0xd90:0x14ad030,0xdc0:0x14b21b0,0xdc8:0x14b08f0}
            for slot,value in wanted.items():assert struct.unpack('<Q',read(table+slot,8))[0]==value
            bindings.append(dict(name=name,vtable=hex(table),slots={hex(k):hex(v)for k,v in wanted.items()}))
        report=dict(serverSha256=expected,classBindings=bindings,evidence=evidence,
            limitations=['Bounded current-byte and class binding assertions, not full function emulation or a live reload capture.',
                        'Authored insertion/outro clip timing is not established as an absolute gameplay deadline.'])
        (out/'interruption-chain.json').write_text(json.dumps(report,indent=2)+'\n')
        print(json.dumps(dict(classes=len(bindings),ranges=len(evidence),assertions=sum(map(len,checks.values())),serverSha256=expected)))
    elif args.refs:
        refs=[]
        for address,offset,length,flags in segments:
            if not flags&1:continue
            code=data[offset:offset+length]
            for match in re.finditer(rb'[\x48\x4c][\x8d\x8b\x3b\x39][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]....',code,re.S):
                at=address+match.start();dest=at+7+struct.unpack_from('<i',match[0],3)[0]
                if dest not in args.refs:continue
                start=code.rfind(b'\x55\x48\x89\xe5',max(0,match.start()-16384),match.start())
                refs.append(dict(address=hex(at),target=hex(dest),priorPrologue=hex(address+start)if start>=0 else None))
                (out/(f'ref-{at:x}.txt')).write_text(listing(at,200))
        (out/'latest-refs.json').write_text(json.dumps(refs,indent=2)+'\n')
        print(json.dumps({'refs':len(refs)}))
    elif args.classes:
        classes=[]
        for name in ['CWeaponNOVA','CWeaponXM1014','CWeaponSawedoff','CWeaponMag7']:
            full=(str(len(name))+name).encode()+b'\0';at=data.find(full);assert at>=0 and data.find(full,at+1)<0
            nameslot=[p for p in pointers_to(va(at))if struct.unpack('<Q',read(p-8,8))[0]==0x10]
            assert len(nameslot)==1
            rtti=nameslot[0]-8;tables=[]
            for p in pointers_to(rtti):
                if struct.unpack('<Q',read(p-8,8))[0]!=0:continue
                target=struct.unpack('<Q',read(p+8,8))[0]
                if not any(a<=target<a+n and flags&1 for a,o,n,flags in segments):continue
                entries=struct.unpack('<464Q',read(p+8,464*8))
                tables.append(dict(address=hex(p+8),entries={hex(i*8):hex(v)for i,v in enumerate(entries)}))
            classes.append(dict(name=name,rtti=hex(rtti),tables=tables))
        (out/'class-vtables.json').write_text(json.dumps(dict(serverSha256=expected,classes=classes),indent=2)+'\n')
        print(json.dumps([dict(name=c['name'],tables=len(c['tables']))for c in classes]))
    elif args.range:
        reports=[]
        for name,a,n in args.range:
            address,length=int(a,0),int(n,0)
            (out/(name+'.txt')).write_text(listing(address,length))
            reports.append(dict(name=name,address=hex(address),length=length,sha256=hashlib.sha256(read(address,length)).hexdigest()))
        (out/'latest-ranges.json').write_text(json.dumps(dict(serverSha256=expected,ranges=reports),indent=2)+'\n')
        print(json.dumps({'ranges':len(reports),'bytes':sum(r['length']for r in reports)}))
    else:
        names=['CWeaponNOVA','CWeaponXM1014','CWeaponSawedoff','CWeaponMag7','CWeaponCSBase',
               'WPN_RELOAD_ADD_AMMO','m_bReloadsSingleShells','m_flDisallowAttackAfterReloadStartDuration',
               'm_iReloadState','m_flNextReload','m_bInReload','m_flNextPrimaryAttack',
               'reload_stage','stage_intro','stage_loop','stage_outro','WPN_RELOAD_END','WPN_RELOAD_COMPLETE']
        rows=[];targets={}
        for name in names:
            offsets=[];start=0;needle=name.encode()
            while (start:=data.find(needle,start))>=0:offsets.append(start);start+=len(needle)
            addresses=[va(o)for o in offsets]
            rows.append(dict(name=name,addresses=[hex(a)for a in addresses],xrefs=[],pointers=[]))
            for address in addresses:targets[address]=rows[-1]
        for address,offset,length,flags in segments:
            if not flags&1:continue
            code=data[offset:offset+length]
            for match in re.finditer(rb'[\x48\x4c][\x8d\x8b][\x05\x0d\x15\x1d\x25\x2d\x35\x3d]....',code,re.S):
                at=address+match.start();dest=at+7+struct.unpack_from('<i',match[0],3)[0]
                if dest in targets:targets[dest]['xrefs'].append(hex(at))
        for target,row in targets.items():
            needle=struct.pack('<Q',target);start=0
            while(start:=data.find(needle,start))>=0:
                row['pointers'].append(hex(va(start)));start+=8
        for row in rows:
            text=[]
            for item in row['xrefs']:
                at=int(item,16);text.append(listing(at,160))
            (out/(row['name']+'-xrefs.txt')).write_text('\n'.join(text))
        (out/'discovery.json').write_text(json.dumps(dict(serverSha256=expected,rows=rows),indent=2)+'\n')
        print(json.dumps([dict(name=r['name'],strings=len(r['addresses']),xrefs=len(r['xrefs']),pointers=len(r['pointers']))for r in rows]))
