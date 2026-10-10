"""Current-client TransformHistory registration, layout and consumer inputs.

Static evidence only. This does not execute native code, open a live process,
identify an interpolation invocation, or establish respawn/teleport ownership.
Use --bounded-only when the coordinated slot permits only small static reads.
"""
import argparse
import hashlib
import json
import runpy
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent/'native-audit'
EXPECTED = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
RANGES = [
    ('registration', 0x16d4980, 0x760, '83d4e792971770e74ec47952343eb5ed36468decc319af52430b8c2f7da9bd63'),
    ('scene-getter', 0x16f4040, 0x2c0, 'dbbea75f5fff20bf4f4f9e62c57d1793f610e3bcdf86659bd36976245965052e'),
    ('scene-consumer', 0x16f4300, 0x6ca, 'fefc3af5758ed05266ca4e621bb61978708ee24ae52c46f84120ce54425cb1fb'),
    ('bracket', 0x1701fe0, 1440, '1c5bc21907899702979d33eb89d662f1c085b05431105eeb20a5df6fb0a8b4d6'),
    ('evaluate-and-derivative-prefix', 0x17031a0, 1920, 'dc341764b1c3df84080a8ecb200187ab42fc028ae0c8aeb6b8c695df37d93514'),
    ('two-point', 0x16f2e10, 592, 'f45440efe11564d8efbca568c1f3cc646b24fc6f8667c336c6d2955fe2a2fb34'),
    ('three-point-prefix', 0x16f3060, 320, '9bc89739cab344b779eda10859029ac0a5f77f48f6a8561176711222750e22de'),
    ('three-point-tail-and-adjacent', 0x16f31a0, 2240, '7ae71c49eedea112d1eb66ffbba82215041a0baa69bc9e191511ff35d0498138'),
    ('quaternion-blend-world', 0x23c07a0, 320, 'c691befa8ec66e8bf6d5d4c80a784afa9f8a00638fc6d13f5ee4695c9526601c'),
    ('quaternion-blend-local', 0x23c08e0, 352, 'a02e166d1bb9d980692f8db6e02e455d5c179844fdd78dd38e3a266c709e25a0'),
    ('record-current', 0x174c940, 144, '6aa9b2008a0bbdfadbf5423ad6a0abe0457f544838d05c7ad2ca5369d6dc4e7c'),
    ('ring-writer-prefix', 0x174b8c0, 1152, '326a0f7f3379a902a05061e538272b899159c3f0f083543eb933931c78de987d'),
    ('get-fallback', 0x16c4740, 384, '91c9d1105e16871a9ad20ec56ca31aeb314fcfc05ed5a6bd76f8b3275be75264'),
    ('setup-prefix', 0x16bebc0, 192, '34bd5a264e200f2ba1414f41a907858eca5fbf8e849c2ac24efdbcf7e0181cb8'),
    ('callback-descriptors', 0x16bdb00, 112, '565eb76cbbe056770d8dba969e75f8834c377f8ed12f64dcdf2626ecd61fe7f1'),
    ('clear-history', 0x16c1f50, 128, '5a5ba096533b0bb5c6008dbad35fe5796c190e9a46bd793ff23124052c44ef4b'),
    ('clear-both', 0x16c6720, 384, '82b0f82bcbc73c7917d77f5368839a2b7efb44face7ea0d47961397ea4198d64'),
    ('evaluate-apply', 0x1706840, 384, 'b40f7a2fec0feac5177c4c1c5db02dd4af7b1b2f838cef6922a70656f563fb3c'),
    ('evaluate-apply-tail', 0x17069a0, 560, '7d584363aa315a5eacad68717d7690c72958f0ac2beefe9bb5b8fd1d0d7329ac'),
    ('registry', 0x18835a0, 800, '58e85fd5b5f12686e263c2a0ddcb699cdc6bf345ce2ec54bee8f1e01baf36a06'),
    ('observed-node-destructors', 0xd115f0, 128, '4c0011326f12183b7e5eab71a402db5b535ee351a81ca58ea0bc3639bcfe2257'),
    ('observed-node-helper', 0xd15fe0, 128, 'e71d32af69aa3c55c0573dd815d18b8c7cde35db53cdf4f59d01dd054968b827'),
    ('skeleton-registration-prefix', 0x18262a0, 128, '8128452d03c18407c325c0ca508380fb6627cabe04f28b56be2b753a23b6ad65'),
]


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--bounded-only', action='store_true')
    ap.add_argument('--out', type=Path, default=ROOT/'reports/reaudit-transform-history/static-proof.json')
    args = ap.parse_args()
    sys.path.insert(0, str(ROOT/'python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from capstone.x86_const import X86_REG_RIP
    from elftools.elf.elffile import ELFFile
    binary = ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
    if not args.bounded_only:
        digest = hashlib.sha256()
        with binary.open('rb') as source:
            while block := source.read(1024*1024): digest.update(block)
        assert digest.hexdigest() == EXPECTED
    with binary.open('rb') as source:
        elf = ELFFile(source)
        segments = [(s['p_vaddr'],s['p_offset'],s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
        def read(a,n):
            assert 0 < n <= 4096
            v,o,z = next(s for s in segments if s[0] <= a and a+n <= s[0]+s[2])
            source.seek(o+a-v)
            raw = source.read(n)
            assert len(raw)==n
            return raw
        def q(a): return struct.unpack('<Q',read(a,8))[0]
        def string(a): return read(a,128).split(b'\0')[0].decode('ascii')
        cs = Cs(CS_ARCH_X86,CS_MODE_64)
        instructions = {}
        for name,a,n,digest in RANGES:
            raw = read(a,n)
            assert hashlib.sha256(raw).hexdigest()==digest, name
            instructions.update({i.address:i.mnemonic+' '+i.op_str for i in cs.disasm(raw,a)})
        # Small exact tails bind the final current-pointer store and scalar
        # three-point helper without rerunning a broad instruction scan.
        tails = [(0x16bec7e, bytes.fromhex('4989442418')),
                 (0x16c41fa, bytes.fromhex('f30f58c3c3'))]
        for a,raw in tails: assert read(a,len(raw))==raw
        checks = {
            0x16d4e9d:'mov edi, 0x60',
            0x16d4fb9:'mov qword ptr [r12 + 0x18], rax',
            0x16d50bb:'mov qword ptr [rbx + 0x68], r12',
            0x16bebd6:'mov rdi, qword ptr [rdi + 0x18]',
            0x16bebdf:'call 0xc6daa0',
            0x16bebee:'lea rcx, [r13 + r13*2]',
            0x16bebf6:'shl rbx, 5',
            0x16bebfd:'call 0xc6da80',
            0x16f4097:'lea rdi, [rbx + 0xf0]',
            0x16f40bd:'call 0x23bb110',
            0x16f40c8:'movaps xmmword ptr [r12 + 0x10], xmm0',
            0x16f413e:'movaps xmmword ptr [r12 + 0x30], xmm0',
            0x174c978:'mov rsi, qword ptr [rbx + 0x18]',
            0x174c995:'call r8',
            0x174c998:'mov rdx, qword ptr [rbx + 0x18]',
            0x174c9af:'jmp 0x174b8c0',
            0x174b9de:'cmp sil, 0x20',
            0x174ba32:'lea rsi, [rax + rax*2]',
            0x174ba39:'shl rsi, 5',
            0x174ba3d:'add rsi, 8',
            0x170685e:'mov r15, qword ptr [rdi + 0x18]',
            0x1706867:'mov rdx, r15',
            0x170686a:'call 0x17031a0',
            0x1706872:'test r12b, 1',
            0x17068b8:'mov rsi, r15',
            0x17068c1:'call r10',
            0x1703208:'call 0x1701fe0',
            0x170321a:'call qword ptr [rax + 0xa0]',
            0x17033be:'call 0x16f2e10',
            0x170341a:'call 0x16f3060',
            0x1702018:'test byte ptr [rdi + 0x10], 0x20',
            0x170207c:'subss xmm0, dword ptr [rdx + 0x18]',
            0x1702084:'shr ecx, 0xd',
            0x1702120:'movsx ecx, word ptr [rdi + rsi + 4]',
            0x1702129:'shr si, 6',
            0x1702130:'imul ecx, esi',
            0x1702136:'lea rsi, [rcx + rcx*2]',
            0x1702145:'lea rcx, [rcx + rsi*4]',
            0x1702149:'lea rcx, [rdi + rcx*8]',
            0x17022cf:'divss xmm2, xmm4',
            0x17022d3:'movss dword ptr [rax + 0x34], xmm2',
            0x17022fd:'movss dword ptr [rax + 0x30], xmm0',
            0x1702308:'test byte ptr [rdi + 0x10], 1',
            0x1702354:'mov dword ptr [rax + 0x30], 0x3f800000',
            0x16f2e39:'mov rax, qword ptr [rdi + 0x78]',
            0x16f2e4a:'cmp qword ptr [r12 + 0x48], rdx',
            0x16f2eb5:'or sil, byte ptr [r12 + 0x54]',
            0x16f2ec5:'cmp ecx, r8d',
            0x16f2eed:'call 0x23c08e0',
            0x16f2f53:'call 0x23c07a0',
            0x16f2e96:'mov word ptr [rbx + 0x54], ax',
            0x16f320f:'call 0x23c08e0',
            0x16f3253:'call 0x16c4180',
            0x16f3280:'call 0x23c07a0',
            0x16f32c0:'call 0x16c4180',
            0x23c07b9:'dpps xmm7, xmm5, 0xff',
            0x23c0864:'addss xmm1, xmm2',
            0x23c0899:'blendvps xmm1, xmm10, xmm0',
            0x23c08bb:'dpps xmm5, xmm1, 0xff',
            0x23c08c1:'sqrtps xmm5, xmm5',
            0x23c08c4:'divps xmm1, xmm5',
            0x16c1f61:'mov dword ptr [rax + 0x10], 0',
            0x16c1f68:'movabs rcx, 0xffffffff00000000',
            0x16c1f72:'and edx, 0xfff81fc0',
            0x16c1f7b:'mov qword ptr [rax + 8], rdx',
            0x16f431e:'movzx edx, byte ptr [rbx + 0x54]',
            0x16f48f9:'cmp qword ptr [rbx + 0x48], rax',
            0x16f4878:'mov qword ptr [r15 + 0xf0], rax',
            0x16f487f:'movss dword ptr [r15 + 0xf8], xmm4',
            0xd11607:'jmp 0x17e8aa0',
            0xd11633:'call 0x17e8aa0',
            0x18262bf:'call 0x16d4980',
        }
        for a,text in checks.items(): assert instructions[a]==text,(hex(a),instructions.get(a),text)
        table = 0x44d23f8
        classes = [(table,'40CInterpolatedVarProceduralUsingOwnerLerpI18TransformHistory_t14CGameSceneNodeE'),
                   (0x44d2198,'14CGameSceneNode'),(0x44dcf80,'17CSkeletonInstance'),
                   (0x43df2b0,'N30CBodyComponentSkeletonInstance29NetworkVar_m_skeletonInstanceE')]
        for t,name in classes: assert string(q(q(t-8)+8))==name
        # Runtime008 exposed the exact embedded subclass. Pin its external
        # ABI typeinfo relocations directly; no relocation scan is repeated.
        relas=elf.get_section_by_name('.rela.dyn')
        symbols=elf.get_section(relas['sh_link'])
        inheritance_relocations=[
            (289464,0x43dece8,'_ZTVN10__cxxabiv120__si_class_type_infoE'),
            (297347,0x44cd888,'_ZTVN10__cxxabiv117__class_type_infoE'),
            (299166,0x44d86e8,'_ZTVN10__cxxabiv121__vmi_class_type_infoE')]
        for index,target,symbol in inheritance_relocations:
            relocation=relas.get_relocation(index)
            assert relocation['r_offset']==target and relocation['r_info_type']==1 and relocation['r_addend']==16
            assert symbols.get_symbol(relocation['r_info_sym']).name==symbol
        assert q(0x43df2b0-8)==0x43dece8 and q(0x43df2b0-16)==0
        assert q(0x43dece8+16)==0x44d86e8
        assert struct.unpack('<IIQq',read(0x44d86e8+16,24))==(0,2,0x44cd888,2)
        # Single inheritance plus the public nonvirtual zero-displacement
        # scene base preserves the read offsets. Four helper/destructor slots
        # differ; do not claim the full subclass behavior equals its base.
        matching_scene_virtuals=[slot for slot in range(0,0x110,8) if slot not in (0x30,0x38,0xf0,0x100)]
        for slot in matching_scene_virtuals: assert q(0x43df2b0+slot)==q(0x44dcf80+slot)
        assert q(0x43df2b0+0x58)==0x18262a0
        virtuals = [(0x10,0x16bebc0),(0x30,0x16c6720),(0x38,0x16c1f50),
                    (0x40,0x1706840),(0xa0,0x16c4740),(0xf0,0x174c940),
                    (0x108,0x16bdb00),(0x110,0x16bdb10),(0x118,0x16bdb20),(0x130,0x16bdb60)]
        for slot,target in virtuals: assert q(table+slot)==target
        rip_bindings = [(0x16d4ee0,table),(0x16d498a,0x16f4300),(0x16d49b2,0x16f4040),
                        (0x17020d4,0xaffdb8),(0x17022f1,0xaff5f0),
                        (0x170241d,0x468bce0),(0x1703267,0x46b81b4),
                        (0x1703291,0x46b81b0),(0x23c08cb,0x46b7120)]
        cs.detail = True
        for a,target in rip_bindings:
            i=next(cs.disasm(read(a,15),a))
            mem=next(o.mem for o in i.operands if o.type==3 and o.mem.base==X86_REG_RIP)
            assert i.address+i.size+mem.disp==target
        assert struct.unpack('<f',read(0xaffdb8,4))[0]==1/64
        assert struct.unpack('<f',read(0xaff5f0,4))[0]==2
        # Mask clears head/count, preserves components/capacity/copy flag.
        mask=0xfff81fc0
        assert mask&63==0 and mask&(63<<13)==0
        assert mask&(63<<6)==63<<6 and mask&(63<<19)==63<<19 and mask&0x1000
    helper = REPO/'tools/reaudit-transform-history-capture-fields.py'
    decoder = runpy.run_path(str(helper))
    assert set(decoder['SCENE_NODE_CLASSES'])=={0x44dcf80,0x44d2198,0x43df2b0}
    synthetic = decoder['self_test']()
    report = dict(clientSha256=EXPECTED,wholeArtifactHashVerified=not args.bounded_only,
        provenance='Static current-byte range hashes, exact instructions, RTTI and virtual callback bindings; synthetic decoder checks. No live process, native execution or captured invocation.',
        assertions=dict(ranges=len(RANGES),summedRangeBytes=sum(x[2] for x in RANGES),
            instructions=len(checks),exactTails=len(tails),classes=len(classes),virtualTargets=len(virtuals),ripBindings=len(rip_bindings),
            inheritanceRelocations=len(inheritance_relocations),matchingObservedSceneVirtuals=len(matching_scene_virtuals)),
        ranges=[dict(name=n,bytes=z,sha256=h) for n,a,z,h in RANGES],
        decoder=dict(sha256=hashlib.sha256(helper.read_bytes()).hexdigest(),
            maxIndividualReadBytes=256,maxTotalReadBytes=decoder['MAX_CAPTURE_BYTES'],
            maximumEntriesPerRing=32,maximumRings=2,componentsSupported=1,synthetic=synthetic),
        findings=[
            dict(id='TH01',status='static-bound',rule='The scene node registers a distinct procedural TransformHistory wrapper with scene getter/setter callbacks and an owner node. Its shared current storage and ring values use a 96-byte stride, independently bound in TransformHistory code rather than borrowed from velocity history.'),
            dict(id='TH02',status='static-bound',rule='The shared current record has multiple writers: the recording path calls the scene getter into it before recording history; interpolation evaluates into it and conditionally calls the consumer; failed bracket selection invokes the scene getter as fallback. A sampled current record cannot identify its last writer.'),
            dict(id='TH03',status='static-bound',rule='Records contain local/world origins and quaternions, two scales, parent identity, an attachment-like token and two flags. The getter can retain world fields in one flag branch. The consumer selects local/world data using parent state, identity and force-world flag; decoding both sets does not imply both were freshly evaluated.'),
            dict(id='TH04',status='static-bound',rule='One or two ring headers are selected by wrapper flags; history entries store integer ticks and separate value indices. Selection uses explicit context and mode arguments. Normal bracket mode subtracts the selected time offset, converts ticks at 64 Hz, computes a fraction, clamps past-newest to one, and optionally selects a third point. The ordinary clamp upper literal is two, not one.'),
            dict(id='TH05',status='static-bound',rule='The two-point kernel requires compatible parent identities, attachment-like tokens and force-world flags for its local branch. Origins use linear interpolation; quaternion blending uses a dot-dependent polynomial adjustment, hemisphere choice and normalization, with a zero-norm fallback. It is not established as an exact generic SLERP implementation.'),
            dict(id='TH06',status='static-bound',rule='The three-point branch still uses the two-point origin/quaternion helpers for its newer pair; scales have a three-point cubic rule. A three-point selection does not make every transform field cubic.'),
            dict(id='TH07',status='static-bound',rule='The bound clear-history leaf clears head/count, validity tick and free-value mask while preserving allocated storage and the shared current record. The wrapper dispatches it over enabled contexts. No reviewed caller establishes existing-instance body reset ownership for respawn or teleport.'),
            dict(id='TH08',status='static-bound',rule='Procedural setup replaces the shared current record allocation for the configured component count. This is distinct from the history-clear leaf and from movement/body object construction; none alone establishes a gameplay reset policy.'),
            dict(id='TH09',status='static-bound',rule='The scene node observed in runtime008 is CBodyComponentSkeletonInstance::NetworkVar_m_skeletonInstance. Exact ABI typeinfo relocation bindings establish single inheritance from CSkeletonInstance and its public zero-displacement CGameSceneNode base. Thirty reviewed virtual targets, including transform registration, match the skeleton base. Four helper/destructor slots differ. The prepared decoder admits this exact subclass; runtime008 used the earlier allowlist and its rejected TransformHistory readouts remain rejected.'),
        ],
        preparedCapture=['Exact wrapper class, registered callback and owner binding; one-component layout only.',
            'All enabled ring headers and entries without truncation; current local/world transform and flags; node declared/evaluated/absolute angles, origins and scales.',
            'Parent identity and attachment-like token, dirty fields, relevant interpolation option globals and quaternion fallback.',
            'Raw read guards for caller revalidation after the entire snapshot; rejection on read error, changed guard or unsupported shape.'],
        limits=['This bounded run does not re-hash the whole client unless wholeArtifactHashVerified is true. The reader requires the outer sampler to bind the full client hash and game-owned process.',
            'Synthetic decoder checks establish only decoding and resource bounds; no live acceptance/coherence rate has been measured.',
            'Actual requested time, context selector, bracket mode, apply options, selected endpoints and last writer are invocation arguments/state not identified by a poll. The reader does not guess them.',
            'Double-read guards reduce torn snapshots but do not make multi-field reads atomic or identify transient calls/ABA writes.',
            'Quaternion math classification is static; no bit-exact native oracle for these kernels has run in this pass.',
            'This proof retains some instruction ranges extending into adjacent functions; only the named, explicitly reviewed instructions support findings.',
            'Parented attachment resolution, interpolation scheduling, alternative overrides and lifecycle call ownership remain incomplete.',
            'No existing-instance respawn/teleport body reset has been proved or disproved.'],
        nextEvidence=['Coherent readouts of this exact TransformHistory wrapper beside the body writer and scene angles.',
            'Entry/exit-bound interpolation requested time, context, mode/options and bracket endpoints, with write order relative to body and render consumption.',
            'Identity-bound lifecycle observations and narrowly bound clear/setup callers across explicit transform changes and death/respawn.'])
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    report['probeSha256'] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    (REPO/'docs/evidence/reaudit-transform-history.json').write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps(dict(output=str(args.out),wholeArtifactHashVerified=not args.bounded_only,
        assertions=report['assertions'],synthetic=synthetic)))


if __name__=='__main__': main()
