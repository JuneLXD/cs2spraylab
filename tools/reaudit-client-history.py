"""Reproduce the bounded client -> engine -> presented-frame history evidence.

Static reads only. Two installed ELF hashes are required. Each inspected range
is at most 8 KiB; no target execution, game, service, Node or Ghidra is started.
Raw locations are retained only in this probe and local artifacts.
An optional portable report omits addresses, layout, and absolute paths.
"""
import argparse, hashlib, json, mmap, struct, sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--audit-root', type=Path, default=REPO.parent/'native-audit',
                    help='Retained audit directory, including its python dependencies')
parser.add_argument('--game-root', type=Path, default=REPO.parent/'cs2-game',
                    help='Installed game directory containing game/')
parser.add_argument('--out', type=Path,
                    help='Raw local output directory (default: AUDIT_ROOT/reports/reaudit-client-history)')
parser.add_argument('--portable-out', type=Path,
                    help='Optional sanitized JSON destination; explicit paths are relative to the caller')
args = parser.parse_args()
ROOT = args.audit_root.expanduser().resolve()
GAME = args.game_root.expanduser().resolve()
OUT = (args.out or ROOT/'reports/reaudit-client-history').expanduser().resolve()
sys.path.insert(0, str(ROOT/'python'))
from capstone import Cs,CS_ARCH_X86,CS_MODE_64
from elftools.elf.elffile import ELFFile
from google.protobuf.descriptor_pb2 import FileDescriptorProto
OUT.mkdir(parents=True, exist_ok=True)
CS=Cs(CS_ARCH_X86,CS_MODE_64);CS.detail=True

class Binary:
 def __init__(self,side,path,digest):
  self.side=side;self.path=path;self.handle=path.open('rb');self.elf=ELFFile(self.handle)
  self.data=mmap.mmap(self.handle.fileno(),0,access=mmap.ACCESS_READ)
  self.sha=hashlib.sha256(self.data).hexdigest()
  assert self.sha==digest, f'{side} hash changed; re-establish native locations before reuse'
  self.segments=[(s['p_vaddr'],s['p_offset'],s['p_filesz'])for s in self.elf.iter_segments()if s['p_type']=='PT_LOAD']
 def read(self,a,n):
  assert 0<n<=8192
  p=next(b+a-x for x,b,c in self.segments if x<=a and a+n<=x+c)
  return self.data[p:p+n]
 def u64(self,a):return struct.unpack('<Q',self.read(a,8))[0]
 def instruction(self,a,mnemonic,operands):
  i=next(CS.disasm(self.read(a,15),a));assert(i.mnemonic,i.op_str)==(mnemonic,operands),(hex(a),i.mnemonic,i.op_str)
  return dict(address=hex(a),instruction=f'{i.mnemonic} {i.op_str}')
 def range(self,name,a,n):
  data=self.read(a,n);lines=[]
  for i in CS.disasm(data,a):
   extra=[]
   for op in i.operands:
    if op.type==3 and CS.reg_name(op.mem.base)=='rip':
     ref=i.address+i.size+op.mem.disp
     try:
      literal=self.read(ref,160).split(b'\0')[0]
      if literal and all(32<=c<127 or c in (9,10)for c in literal):extra.append(repr(literal.decode()))
     except StopIteration:pass
   lines.append(f'{i.address:x}: {i.mnemonic} {i.op_str}'+(' ; '+'; '.join(extra)if extra else''))
  path=OUT/f'{self.side}-{name}.txt';path.write_text('\n'.join(lines)+'\n')
  return dict(side=self.side,name=name,address=hex(a),bytes=n,sha256=hashlib.sha256(data).hexdigest(),file=path.name)

client=Binary('client',GAME/'game/csgo/bin/linuxsteamrt64/libclient.so',
 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1')
engine=Binary('engine',GAME/'game/bin/linuxsteamrt64/libengine2.so',
 'f5745c46cb38b1d120c3c7c5f0f19590f46c3d1bd136ee527b276cce8bfaba14')

# These are current-byte bindings, independently checked across module boundaries.
binding_checks = [
 ('engine-client-presented-getter', engine.u64(0x9ccc58+0x568)==0x4f70b0),
 ('present-callback-publisher', engine.u64(0x9bb820)==0x3842d0),
 ('network-render-fraction', engine.u64(0x9cc008+0x208)==0x4dfcc0),
 ('network-player-pair', engine.u64(0x9cc008+0x210)==0x4e0000),
 ('client-interface-name', engine.read(engine.u64(0x9d6300),17).startswith(b'Source2Client002\0')),
 ('client-interface-storage', engine.u64(0x9d6308)==0xc90ba8),
 ('client-player-pair', client.u64(0x44ecdc0+0x548)==0x18ed090),
 ('client-interface-table', client.u64(0x44edd48)==0x44ecdc0),
 ('prediction-interface-storage', client.u64(0x467cb20)==0x4934440),
 ('history-entry-parser', client.u64(0x4482708+10*8)==0x1428cd0),
 ('command-parser', client.u64(0x44827a8+10*8)==0x1429380),
]
for name, passed in binding_checks:
 assert passed, f'Native binding changed: {name}'

checks=[]
for a,m,o in [
 (0x14290e0,'cmp','sil, 0x3d'),(0x14290f7,'mov','dword ptr [rbx + 0x6c], eax'),
 (0x1429100,'cmp','sil, 0x30'),(0x1429136,'mov','dword ptr [rbx + 0x68], esi'),
 (0x1429140,'cmp','sil, 0x2d'),(0x1429157,'mov','dword ptr [rbx + 0x64], eax'),
 (0x1429160,'cmp','sil, 0x20'),(0x1429196,'mov','dword ptr [rbx + 0x60], esi'),
 (0x14294d0,'cmp','sil, 0x38'),(0x1429503,'mov','dword ptr [r12 + 0x40], esi'),
 (0x1429510,'cmp','sil, 0x30'),(0x1429543,'mov','dword ptr [r12 + 0x3c], esi'),
 (0x1b08bd4,'cmp','rsi, 1'),(0x1b08bde,'cmp','rsi, 0x800'),
 (0x1b08d65,'cmp','dword ptr [rbx + r12*4 + 0xbc0], -1'),
 (0x1b08e25,'mov','dword ptr [rbx + r12*4 + 0xbc0], r9d'),
 (0x1ae622b,'mov','dword ptr [rbx + 0x60], eax'),
 (0x1ae6241,'movss','dword ptr [rbx + 0x64], xmm0'),
 (0x1ae625f,'mov','dword ptr [rbx + 0x68], eax'),
 (0x1ae626e,'movss','dword ptr [rbx + 0x6c], xmm0'),
 (0x198eb48,'mov','edi, dword ptr [rdi + 0x10c]'),
 (0x198eb65,'ucomiss','xmm0, dword ptr [rax + 0x34]'),
 (0x198ebc8,'movss','xmm0, dword ptr [rax + 0x3c]'),
 (0x198eba2,'mov','esi, dword ptr [rax + 0x44]'),
]:checks.append(client.instruction(a,m,o))

def descriptor(binary):
 data=binary.data;name=b'cs_usercmd.proto';start=data.find(b'\n'+bytes([len(name)])+name);assert start>=0
 def vint(p):
  value=shift=0
  while True:
   byte=data[p];p+=1;value|=(byte&127)<<shift
   if byte<128:return value,p
   shift+=7;assert shift<64
 p=start
 while True:
  tag,q=vint(p)
  if not tag:break
  if tag&7==2:n,q=vint(q);q+=n
  elif tag&7==0:_,q=vint(q)
  elif tag&7==5:q+=4
  elif tag&7==1:q+=8
  else:break
  p=q;assert p-start<8192
 message=FileDescriptorProto();message.ParseFromString(data[start:p]);assert message.name==name.decode()
 return dict(sha256=hashlib.sha256(data[start:p]).hexdigest(),bytes=p-start,
  messages={m.name:[dict(name=f.name,tag=f.number,type=f.type,label=f.label)for f in m.field]for m in message.message_type})

ranges=[]
for name,a,n in [
 ('entry-parser',0x1428cd0,0x6b0),('command-parser',0x1429380,0x550),
 ('engine-binding',0x18f1340,0xc0),('read-frame-input',0x1b08b40,0x850),
 ('frame-serialization',0x1ae61f0,0x760),('create-move',0x1b1f6f0,0x1400),
 ('interface-registration',0x191a330,0x68),('interface-instance',0x18ea0c0,8),
 ('interface-constructor',0x1900880,0x7e),('player-frame-clock',0x18ed090,0x14),
 ('prediction-frame-clock',0x198eb40,0x90),('prediction-seconds',0x198ea60,0xa0),
 ('pair-normalization',0x2f01f80,0x400),('pair-seconds',0x1763aa0,0x1e),
 ('prediction-registration',0x19ab106,0x3c),
 ('prediction-update-prefix',0x19bf340,0x300),('prediction-update-cache',0x19bfea8,0x74),
]:ranges.append(client.range(name,a,n))
for name,a,n in [
 ('interface-registration',0x4f8e8c,0xaa),('interface-instance',0x4f6660,8),
 ('presented-getter',0x4f70b0,0x1a),('presented-copy',0x388280,0x50),
 ('snapshot-publish',0x3842d0,0x9e),('snapshot-construction',0x3a02d0,0x95),
 ('present-handoff',0x39fe90,0xac),('render-fraction',0x4dfcc0,9),
 ('render-pair-normalization',0x871470,0x400),('player-pair-forwarder',0x4e0000,0x13),
]:ranges.append(engine.range(name,a,n))

observations=[
 {'id':'CH01','rule':'Current generated protobuf parsers identify the player and render tick/fraction fields and both attack-start index fields.','evidence':['client-entry-parser','client-command-parser']},
 {'id':'CH02','rule':'ReadFrameInput processes newly received primary/secondary button transitions. A down transition sets its attack-start index only while that index is unset.','evidence':['client-read-frame-input']},
 {'id':'CH03','rule':'ReadFrameInput requests the presented-frame snapshot. It avoids adding a new record for the same last frame and associates the press with the reused/appended record. Stored frame records carry separate render and player clock pairs.','evidence':['client-read-frame-input']},
 {'id':'CH04','rule':'The source of that snapshot is the factory-bound Source2EngineToClient001 method. RTTI and registration connect it to CEngineClient.','evidence':['client-engine-binding','engine-interface-registration','engine-interface-instance','engine-presented-getter']},
 {'id':'CH05','rule':'The engine getter copies the latest successfully published snapshot from a ten-slot ring. CRenderDevicePresentCallbackClientServer publishes a frame payload and a callback-time stamp; a contended publisher can skip publication.','evidence':['engine-presented-copy','engine-snapshot-publish']},
 {'id':'CH06','rule':'Snapshot construction stores a frame identifier, normalized network-client render tick/fraction, and a distinct player pair. The callback is passed to the render-device Present path.','evidence':['engine-snapshot-construction','engine-present-handoff','engine-render-fraction','engine-render-pair-normalization']},
 {'id':'CH07','rule':'The player pair is supplied through Source2Client002 by Source2ClientPrediction001. With a positive cached predicted tick, it uses that tick plus the global fractional clock if the global frame-time scalar is nonzero; otherwise fraction zero. With a nonpositive cached predicted tick, it uses the global integer tick and zero fraction.','evidence':['engine-player-pair-forwarder','client-interface-registration','client-interface-instance','client-interface-constructor','client-player-frame-clock','client-prediction-frame-clock','client-prediction-registration']},
 {'id':'CH08','rule':'CreateMove serializes the frame pairs. The render pair is copied unconditionally in this helper; a prediction-state flag gates copying the player pair. Optional history reduction for more than four records remaps attack indices. Invalid indices are replaced by minus one.','evidence':['client-frame-serialization','client-create-move']},
 {'id':'CH09','rule':'The paired time converts to seconds as float32(tick)*1/64 + float32(fraction)*1/64. Its fractional value is normalized as a tick fraction.','evidence':['client-pair-seconds','client-pair-normalization']},
]
report={
 'method':__doc__,'scriptSha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
 'artifacts':{'client':{'path':str(client.path),'sha256':client.sha},'engine':{'path':str(engine.path),'sha256':engine.sha}},
 'descriptor':descriptor(client),'instructionChecks':checks,
 'bindingChecks':[{'name':name,'passed':passed}for name,passed in binding_checks],
 'ranges':ranges,'observations':observations,
 'concreteMapping':[
  'The first primary down transition handled for a command selects the latest presented-frame record, reusing it if already collected.',
  'That record stores the player clock captured in the frame payload, not a time recomputed from the input transition timestamp or weapon schedule.',
  'CreateMove copies or remaps the selected record into command input_history. Server exact-history resolution then converts/clamps its player pair; subsequent calculated shots may preserve the resulting schedule difference through the already-proved timing cache.',
 ],
 'conditionalInference':[
  'A trainer analogue would need the simulation/prediction clock of its last presented frame at the input edge, separately from its shot schedule and current camera sampling time.',
  'A DOM event timestamp alone cannot identify native presented-frame identity or player clock. These static paths do not prove that a particular retained demo shot used the exact-history branch.',
 ],
 'remainingRuntimeMetadata':[
  'For each relevant present: frame identifier, render pair, player pair, callback publication stamp/order and whether publication succeeded.',
  'At each input read: newly consumed button-down transitions, last processed input index, selected presented frame and first-press history index.',
  'At frame construction: cached predicted tick, global integer/fractional clocks, frame-time scalar, prediction enabled flag and prediction phase.',
  'At CreateMove: history list before/after optional reduction, history-reduction setting, and final attack1 index.',
  'At shot resolution: exact/fallback status, tick-domain conversion, clamp result, cached timing difference and sampler current clock.',
  'For a trainer implementation: a validated relation between native frame construction/presentation and trainer renderSnapshot/presentation. Browser rAF delivery is not proof of scanout or native present completion.',
 ],
 'limits':[
  'Static inspection observes no runtime values or branch selection. Current default settings are not inferred from registration or file names.',
  'The core ordinary first-press mapping is resolved. Prediction scheduling, render-backend completion/scanout, history reduction details and special malformed/nonfinite inputs are not exhaustively modeled.',
  'The probe reads only installed client and engine artifacts. It performs no target execution or behavioral/emulation test; reviewed semantic observations are supported by the retained disassembly ranges.',
  'Related server resolver findings are prior evidence, not a server inspection performed by this probe.',
 ],
 'decision':'Preserve production behavior. Do not fit a constant millisecond offset. A presented-frame history model now has a native structural basis, but retained recordings lack the runtime metadata needed to validate its phase in the trainer.',
}
path=OUT/'report.json';path.write_text(json.dumps(report,indent=2)+'\n')
verification = {
 'instructionAssertions':len(checks), 'bindingAssertions':len(binding_checks),
 'boundedRanges':len(ranges), 'bytesDisassembled':sum(r['bytes']for r in ranges),
 'largestRangeBytes':max(r['bytes']for r in ranges), 'maximumAllowedRangeBytes':8192,
 'embeddedDescriptorBytes':report['descriptor']['bytes'], 'passed':True,
}
portable = {
 'schemaVersion':1,
 'reviewedBaseline':'9391437687f5939e9ea9844323daca21ee603506',
 'productionChange':False,
 'scope':'Ordinary client input history construction and presented-frame player clock; bounded static evidence only.',
 'method':'Read-only ELF hashing, bounded Capstone inspection, embedded protobuf parsing, and interface/vtable binding checks. No runtime call or captured branch state.',
 'probe':'tools/reaudit-client-history.py',
 'probeSha256':report['scriptSha256'],
 'binarySha256':{'client':client.sha,'engine2':engine.sha},
 'descriptor':{
  'name':'cs_usercmd.proto','sha256':report['descriptor']['sha256'],
  'bytes':report['descriptor']['bytes'],
  'relevantFields':{
   'CSGOInputHistoryEntryPB':['render_tick_count','render_tick_fraction','player_tick_count','player_tick_fraction'],
   'CSGOUserCmdPB':['input_history','attack1_start_history_index','attack2_start_history_index'],
  },
 },
 'verification':verification,
 'rangeDigests':[{key:r[key]for key in ('side','name','bytes','sha256')}for r in ranges],
 'observations':observations,
 'concreteMapping':report['concreteMapping'],
 'playerClock':{
  'symbols':{'P':'Cached predicted integer tick','G':'Global integer tick',
             'F':'Global fractional clock','D':'Global frame-time scalar'},
  'positivePrediction':'P > 0: normalize(P, F) if D != 0; otherwise normalize(P, 0)',
  'fallback':'P <= 0: (G, 0)',
  'fractionEnabled':'The presented-frame getter requests fractional time.',
  'seconds':'float32(float32(float32(tick) * (1/64)) + float32(float32(fraction) * (1/64)))',
  'ordinaryFraction':'A fraction in [0,1) remains unchanged by normalization.',
 },
 'relatedServerEvidence':{
  'report':'docs/reaudit-camera-clocks.md',
  'probe':'tools/reaudit-attack-history-fields.py',
  'serverSha256':'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a',
  'verifiedByThisProbe':False,
  'rule':'For a valid attack index, the server uses the selected player pair, converts tick domain, and clamps it to current time minus three ticks through current time plus one tick. Fallback/cache paths are separate.',
 },
 'conditionalInference':report['conditionalInference'],
 'remainingRuntimeMetadata':report['remainingRuntimeMetadata'],
 'limits':report['limits'],
 'decision':report['decision'],
}
if args.portable_out:
 portable_path = args.portable_out.expanduser().resolve()
 portable_path.parent.mkdir(parents=True, exist_ok=True)
 portable_path.write_text(json.dumps(portable, indent=2)+'\n')
print(json.dumps({**verification,'observations':len(observations),'report':str(path),
                  'portableReport':str(portable_path) if args.portable_out else None}))
