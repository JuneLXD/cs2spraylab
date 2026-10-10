"""Bounded private-memory scene-yaw wrapper/state oracle (no live process).

The native yaw wrapper, aim/error preparation and ground/air state dispatch run
unchanged. Entity interfaces, movement preparation, current tick, aim punch,
weapon-drop preparation, foot IK and air auxiliary work are explicit shims.
This isolates yaw/state behavior with supplied inputs; it does not construct
those inputs, establish command cadence, or verify lifecycle resets.
"""
import argparse
import hashlib
import json
import math
import runpy
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
sys.path.insert(0, str(ROOT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86_const import X86_REG_RIP
from elftools.elf.elffile import ELFFile
from unicorn import Uc, UC_ARCH_X86, UC_MODE_64, UC_HOOK_CODE
from unicorn.x86_const import *

EXPECTED = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
BINARY = ROOT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
OUT = ROOT / 'reports/reaudit-scene-writer-oracle'
F = lambda x: struct.unpack('<f', struct.pack('<f', x))[0]
STATE, SERVICE, PAWN, IDENTITY, WEAPON = 0x6000000, 0x6001000, 0x6002000, 0x6003000, 0x6004000
VTABLE, ANGLES, STACK, STOP = 0x6008000, 0x6009000, 0x601f000, 0x601ff00
NATIVE = [(0x15267c0, 0x1526980), (0x1527080, 0x15281a0), (0x23b83e0, 0x23b8440)]
SHIMS = {
    0xd8dc20: 'read-supplied-absolute-angles',
    0xd8dd70: 'retain-produced-absolute-angles',
    0x1525f70: 'supply-prepared-movement-inputs',
    0x1526610: 'skip-weapon-drop-preparation',
    0x1526980: 'skip-foot-IK-after-yaw',
    0x1583ea0: 'skip-air-auxiliary-before-yaw',
    0x1a59580: 'supply-source-angles',
    0x15892c0: 'supply-aim-punch-result',
    0xd8b3c0: 'supply-move-type',
    0x17f35c0: 'supply-context-selected-normalized-tick',
    0xc793d0: 'float-fmod',
    0xc7a170: 'float-atan2',
    0xc7b2f0: 'float-acos',
    0xc7b170: 'float-cos',
}


class Oracle:
    def __init__(self):
        digest = hashlib.sha256()
        with BINARY.open('rb') as source:
            while b := source.read(1024*1024):
                digest.update(b)
        assert digest.hexdigest() == EXPECTED
        self.source = BINARY.open('rb')
        elf = ELFFile(self.source)
        self.segments = [(s['p_vaddr'],s['p_offset'],s['p_filesz'])
                         for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
        self.cs = Cs(CS_ARCH_X86, CS_MODE_64)
        self.cs.detail = True
        # No imported proof main, no repo output, no whole-code scan.
        proof = runpy.run_path(str(ROOT.parent / 'cs2spraylab/tools/reaudit-scene-writer-proof.py'))
        self.proof_ranges = []
        for name, address, size, expected in proof['RANGES']:
            if name.startswith('yaw-') and any(lo <= address < hi for lo,hi in NATIVE):
                actual = hashlib.sha256(self.read(address,size)).hexdigest()
                assert actual == expected
                self.proof_ranges.append(dict(name=name,sha256=actual,bytes=size))
        self.u = Uc(UC_ARCH_X86, UC_MODE_64)
        self.pages = set()
        for lo,hi in NATIVE:
            for at in range(lo & ~4095, (hi+4095) & ~4095,4096):
                self.map_binary_page(at)
            for ins in self.cs.disasm(self.read(lo,hi-lo),lo):
                for operand in ins.operands:
                    if operand.type == 3 and operand.mem.base == X86_REG_RIP:
                        target = ins.address+ins.size+operand.mem.disp
                        self.map_binary_page(target & ~4095)
                        self.map_binary_page((target+31) & ~4095)
        # Jump-table contents, not executable destinations, are loaded above.
        for address in SHIMS:
            self.map_binary_page(address & ~4095)
        self.u.mem_map(STATE,0x20000)
        self.imports = self.bind_imports(elf)
        self.u.hook_add(UC_HOOK_CODE,self.hook)
        self.active = {}

    def read(self,address,size):
        assert 0 < size <= 8192
        v,offset,_ = next(s for s in self.segments if s[0] <= address and address+size <= s[0]+s[2])
        self.source.seek(offset+address-v)
        data=self.source.read(size)
        assert len(data)==size
        return data

    def map_binary_page(self,address):
        if address in self.pages:
            return
        data=self.read(address,4096)
        self.u.mem_map(address,4096)
        self.u.mem_write(address,data)
        self.pages.add(address)

    def bind_imports(self,elf):
        relocations={}
        for section in elf.iter_sections():
            if section['sh_type'] not in ['SHT_RELA','SHT_REL']:
                continue
            names=elf.get_section(section['sh_link'])
            for relocation in section.iter_relocations():
                if relocation['r_info_sym']:
                    relocations[relocation['r_offset']]=names.get_symbol(relocation['r_info_sym']).name
        result={}
        for address,suffix in [(0xc793d0,'fmodf'),(0xc7a170,'atan2f'),(0xc7b2f0,'acosf'),(0xc7b170,'cosf')]:
            ins=next(i for i in self.cs.disasm(self.read(address,16),address) if i.mnemonic=='jmp')
            mem=ins.operands[0].mem
            assert mem.base==X86_REG_RIP
            symbol=relocations[ins.address+ins.size+mem.disp]
            assert symbol in [suffix,'V_'+suffix],(hex(address),symbol,suffix)
            result[hex(address)]=symbol
        return result

    def put(self,address,fmt,*values):
        self.u.mem_write(address,struct.pack('<'+fmt,*values))

    def get_float(self,reg):
        return struct.unpack('<f',self.u.reg_read(reg).to_bytes(16,'little')[:4])[0]

    def set_float(self,reg,value):
        self.u.reg_write(reg,int.from_bytes(struct.pack('<f',F(value)),'little'))

    def return_angles(self,angles):
        self.u.reg_write(UC_X86_REG_XMM0,int.from_bytes(struct.pack('<2f',*angles[:2]),'little'))
        self.set_float(UC_X86_REG_XMM1,angles[2])

    def return_shim(self):
        sp=self.u.reg_read(UC_X86_REG_RSP)
        target=struct.unpack('<Q',self.u.mem_read(sp,8))[0]
        self.u.reg_write(UC_X86_REG_RSP,sp+8)
        self.u.reg_write(UC_X86_REG_RIP,target)

    def hook(self,uc,address,size,_):
        self.active['instructions']+=1
        assert self.active['instructions']<6000
        if address not in SHIMS:
            assert any(lo<=address<hi for lo,hi in NATIVE),f'Unexpected native call {address:x}'
            return
        case=self.active['case']
        kind=SHIMS[address]
        self.active['shims'].append(kind)
        if kind=='read-supplied-absolute-angles':
            assert uc.reg_read(UC_X86_REG_RDI)==PAWN
            uc.reg_write(UC_X86_REG_RAX,ANGLES)
        elif kind=='retain-produced-absolute-angles':
            assert uc.reg_read(UC_X86_REG_RDI)==PAWN
            raw=bytes(uc.mem_read(uc.reg_read(UC_X86_REG_RSI),12))
            self.active['outputAngles']=list(struct.unpack('<3f',raw))
        elif kind=='supply-prepared-movement-inputs':
            self.put(STATE+0x48,'Q',WEAPON)
            self.put(STATE+0x54,'3f',*case.get('commandDirection',[0,0,0]))
            self.put(STATE+0x90,'4f',*case.get('movementDirection',[0,0,0]),0)
            self.put(STATE+0xa0,'f',case.get('maxSpeed',250))
            self.put(STATE+0xa4,'f',case.get('speed',0))
            self.put(STATE+0xb0,'f',case.get('duckAmount',0))
        elif kind=='supply-source-angles':
            self.return_angles(case.get('sourceAngles',[0,case.get('aimYaw',0),0]))
        elif kind=='supply-aim-punch-result':
            self.return_angles(case.get('aimPunch',[0,0,0]))
        elif kind=='supply-move-type':
            uc.reg_write(UC_X86_REG_RAX,case.get('moveType',2))
        elif kind=='supply-context-selected-normalized-tick':
            uc.reg_write(UC_X86_REG_RAX,case.get('tick',100)&0xffffffff)
        elif kind.startswith('float-'):
            x=self.get_float(UC_X86_REG_XMM0)
            y=self.get_float(UC_X86_REG_XMM1)
            result={'float-fmod':lambda:math.fmod(x,y),
                    'float-atan2':lambda:math.atan2(x,y),
                    'float-acos':lambda:math.acos(x),
                    'float-cos':lambda:math.cos(x)}[kind]()
            self.set_float(UC_X86_REG_XMM0,result)
        else:
            assert kind.startswith('skip-')
        self.return_shim()

    def invoke(self,case,dispatch_only=False):
        self.u.mem_write(STATE,bytes(0x20000))
        self.put(STATE+8,'Q',SERVICE)
        self.put(SERVICE+0x38,'Q',PAWN)
        self.put(PAWN,'Q',VTABLE)
        self.put(PAWN+0x10,'Q',IDENTITY)
        self.put(PAWN+0x564,'I',1 if case.get('grounded',True) else 0)
        self.put(VTABLE+0x568,'Q',0x1a59580)
        self.put(WEAPON+0x2838,'H',case.get('itemDefinition',7))
        self.put(ANGLES,'3f',0,case.get('bodyYaw',0),0)
        for offset,key,default in [(0x10,'currentMoveType',1),(0x11,'state',1),
                (0x12,'actionDirection',0),(0x14,'wasOnGround',1),(0x15,'wasStationary',1),
                (0x50,'airOverride',0),(0x51,'commandDirectionCode',0)]:
            self.put(STATE+offset,'B',case.get(key,default))
        for offset,key,default in [(0x18,'actionStart',90),(0x1c,'staticAimStart',0),(0x20,'plantStart',0)]:
            self.put(STATE+offset,'i',case.get(key,default))
        for offset,key,default in [(0x24,'turnOnSpotAngle',0),(0x28,'previousAimYaw',case.get('aimYaw',0)),
                                   (0x2c,'previousSpeed',case.get('speed',0))]:
            self.put(STATE+offset,'f',case.get(key,default))
        # SysV function-entry alignment: the saved return address is at rsp%16=8.
        self.put(STACK+8,'Q',STOP)
        for reg in [UC_X86_REG_RAX,UC_X86_REG_RBX,UC_X86_REG_RCX,UC_X86_REG_RDX,
                    UC_X86_REG_RSI,UC_X86_REG_RBP,UC_X86_REG_R8,UC_X86_REG_R9,
                    UC_X86_REG_R10,UC_X86_REG_R11,UC_X86_REG_R12,UC_X86_REG_R13,
                    UC_X86_REG_R14,UC_X86_REG_R15]:
            self.u.reg_write(reg,0)
        self.u.reg_write(UC_X86_REG_RDI,STATE)
        for reg in [UC_X86_REG_XMM0,UC_X86_REG_XMM1,UC_X86_REG_XMM2,UC_X86_REG_XMM3,
                    UC_X86_REG_XMM4,UC_X86_REG_XMM5,UC_X86_REG_XMM6,UC_X86_REG_XMM7,
                    UC_X86_REG_XMM8,UC_X86_REG_XMM9,UC_X86_REG_XMM10,UC_X86_REG_XMM11,
                    UC_X86_REG_XMM12,UC_X86_REG_XMM13,UC_X86_REG_XMM14,UC_X86_REG_XMM15]:
            self.u.reg_write(reg,0)
        self.u.reg_write(UC_X86_REG_MXCSR,0x1f80)
        self.u.reg_write(UC_X86_REG_RSP,STACK+8)
        self.active=dict(case=case,shims=[],instructions=0)
        if dispatch_only:
            self.put(STATE+0x40,'Q',PAWN)
            self.put(STATE+0x48,'Q',WEAPON)
            self.put(STATE+0x54,'3f',*case.get('commandDirection',[0,0,0]))
            self.put(STATE+0x90,'4f',*case.get('movementDirection',[0,0,0]),0)
            for offset,key,default in [(0xa0,'maxSpeed',250),(0xa4,'speed',0),(0xb0,'duckAmount',0),
                    (0xb8,'turnRate',0),(0xc4,'aimYaw',0),(0xc8,'aimPitch',0),(0xcc,'signedError',0),
                    (0xd0,'absoluteError',0),(0xd4,'aimChangeRate',0),(0xd8,'bodyYaw',0)]:
                self.put(STATE+offset,'f',case.get(key,default))
        self.u.emu_start(0x1527f30 if dispatch_only else 0x1528090,STOP,count=6000)
        assert self.u.reg_read(UC_X86_REG_RIP)==STOP
        b=bytes(self.u.mem_read(STATE,0xe0))
        scalar=lambda offset:struct.unpack_from('<f',b,offset)[0]
        integer=lambda offset:struct.unpack_from('<i',b,offset)[0]
        return dict(name=case['name'],input=case,angles=self.active.get('outputAngles'),
                    state=b[0x11],currentMoveType=b[0x10],actionDirection=b[0x12],airAction=b[0x13],
                    wasOnGround=b[0x14],wasStationary=b[0x15],airOverride=b[0x50],
                    actionStart=integer(0x18),staticAimStart=integer(0x1c),plantStart=integer(0x20),
                    aimYaw=scalar(0xc4),aimPitch=scalar(0xc8),previousAimYaw=scalar(0x28),
                    bodyYaw=scalar(0xd8),signedError=scalar(0xcc),absoluteError=scalar(0xd0),
                    aimChangeRate=scalar(0xd4),turnRate=scalar(0xb8),
                    instructions=self.active['instructions'],shims=self.active['shims'])


def synthetic_cases():
    cases=[]
    for gap in [-71,-70,-45,-31,-30,-5.001,-5,0,5,5.001,30,31,45,70,71]:
        cases.append(dict(name=f'idle-gap-{gap}',aimYaw=gap))
    for speed in [0,10,10.01,14.99,15,83.85,215,250]:
        for gap in [-50,-30,0,30,50]:
            cases.append(dict(name=f'move-speed-{speed}-gap-{gap}',state=3,speed=speed,aimYaw=gap))
    for elapsed in [0,1,5,6,11,12,30]:
        cases.append(dict(name=f'turn-loop-tick-{elapsed}',state=5,aimYaw=30,actionStart=100-elapsed))
        cases.append(dict(name=f'start-tick-{elapsed}',state=2,speed=200,aimYaw=30,actionStart=100-elapsed))
    for elapsed in [0,94,95,96,120]:
        cases.append(dict(name=f'idle-hold-{elapsed}',aimYaw=20,staticAimStart=1000-elapsed,tick=1000))
    for grounded,move,override in [(False,2,0),(True,9,0),(True,2,1)]:
        cases.append(dict(name=f'air-{grounded}-{move}-{override}',grounded=grounded,moveType=move,airOverride=override,
                          aimYaw=80,bodyYaw=-80))
    cases += [dict(name='aim-punch-addition',sourceAngles=[4,10,0],aimPunch=[2,3,0]),
              dict(name='yaw-wrap',sourceAngles=[0,-179,0],bodyYaw=179,previousAimYaw=179),
              dict(name='moving-minimum-plant-input',state=3,speed=150,aimYaw=30,commandDirection=[1,0,0],
                   movementDirection=[1,0,0],commandDirectionCode=1)]
    return cases


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=OUT)
    args=parser.parse_args()
    oracle=Oracle()
    rows=[oracle.invoke(case) for case in synthetic_cases()]
    index={row['name']:row for row in rows}
    assertions=[]
    def check(name,condition):
        assert condition,name
        assertions.append(name)
    for gap in [-5,0,5]:
        row=index[f'idle-gap-{gap}']
        check(f'idle dead zone {gap}',row['bodyYaw']==0 and row['state']==1)
    check('exact moving step at full speed',index['move-speed-250-gap-30']['bodyYaw']==2.109375)
    check('moving step sign',index['move-speed-250-gap--30']['bodyYaw']==-2.109375)
    check('moving step stops at zero error',index['move-speed-250-gap-0']['bodyYaw']==0)
    check('Move threshold includes ten',index['move-speed-10-gap-0']['state']==1)
    check('Move threshold excludes larger speed',index['move-speed-10.01-gap-0']['state']==3)
    check('Start retains state through elapsed six',index['start-tick-6']['state']==2)
    check('Start enters Move after elapsed six',index['start-tick-11']['state']==3)
    check('turn ramp reaches full rate at elapsed eleven',index['turn-loop-tick-11']['bodyYaw']==3.75)
    check('turn ramp stays at full rate',index['turn-loop-tick-12']['bodyYaw']==3.75)
    check('aim punch participates in aim',index['aim-punch-addition']['aimYaw']==13 and index['aim-punch-addition']['aimPitch']==6)
    check('angle wrap preserves small body gap',index['yaw-wrap']['bodyYaw']==179)
    check('aim change rate is not wrapped again',index['yaw-wrap']['aimChangeRate']==22912)
    for row in rows:
        if row['name'].startswith('air-'):
            check(row['name']+' directly assigns aim',row['bodyYaw']==80 and row['airOverride']==0)
        check(row['name']+' wrapper writes produced yaw',row['angles'][1]==row['bodyYaw'])
        check(row['name']+' wrapper updates previous aim',row['previousAimYaw']==row['aimYaw'])
    args.out.mkdir(parents=True,exist_ok=True)
    result=dict(clientSha256=EXPECTED,method=__doc__,pagesMapped=len(oracle.pages),
                proofRanges=oracle.proof_ranges,imports=oracle.imports,cases=rows,assertions=assertions,
                limits=['Prepared movement, absolute input angle, current tick and aim-punch result are supplied interfaces.',
                        'Weapon-drop, foot IK and air auxiliary routines are skipped; only yaw and related dispatch state are asserted.',
                        'Float libm shims round host mathematical results to float32; they do not establish exact native transcendental-library parity.',
                        'These cases do not establish live call cadence, prediction context, state initialization or lifecycle resets.',
                        'No live runtime comparison is performed by this synthetic bench.',
                        'Ordinary AK item definition is supplied; special-weapon stationary gates are not tested.'])
    (args.out/'oracle.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps(dict(cases=len(rows),pagesMapped=len(oracle.pages),output=str(args.out/'oracle.json'))))


if __name__=='__main__':
    main()
