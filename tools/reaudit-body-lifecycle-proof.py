"""Bounded current-client body construction, clock ordering and scene input proof.

This is static evidence only. It does not establish respawn/teleport resets,
runtime invocation identity, or the transform interpolation scheduler/kernel.
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
 ('movement-factory', 0x159a980, 512, 'c54619926ac6b911852464889b7dc56ccff19ab77f458b668f31926680a0ebd4'),
 ('movement-construction', 0x1577830, 1856, '13a8fe199ee9b5bcc9569f316440d5ea9ad290b4c96fe15aaeaf38a739431ae9'),
 ('explicit-transform-override', 0x15b1cf0, 256, '6e3f6224c2282d287feb9832b90784ae55a1b58932fdefe23e65c05df05d17a5'),
 ('angle-equivalence', 0x23b8440, 192, 'a1c9815821c964c90eb44a8a08609cfa24e3e70831808df1ee25cde6502b3034'),
 ('controller-tick-setter', 0x16210d0, 32, 'ac0d03c11c85d813e53964ad634ea2a40abb16bd9f8d4df13b379958017cd2ad'),
 ('cs-command-cleanup', 0x15c2350, 256, '3619599618258bd69b858b8247b077939038f5b4488ef647b3ed1310e8cf3dfb'),
 ('base-command-cleanup', 0x17933c0, 144, '3b4d3bda6e7d62db32e1ab6f7244d9c0ff6a12dff6f306419bd172d7b49cb530'),
 ('cs-body-postprocess', 0x15c22c0, 144, '195a0596644e68b2d437644bdaec13a222cb99bd7ccbeff260636bdbba555098'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bounded-only', action='store_true')
    parser.add_argument('--out', type=Path, default=ROOT/'reports/reaudit-body-clock/lifecycle-proof.json')
    parser.add_argument('--evidence', type=Path, default=REPO/'docs/evidence/reaudit-body-lifecycle.json')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT/'python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from elftools.elf.elffile import ELFFile
    previous_scene = runpy.run_path(str(REPO/'tools/reaudit-scene-writer-proof.py'))
    previous_clock = runpy.run_path(str(REPO/'tools/reaudit-body-clock-proof.py'))
    ranges = RANGES + [r for r in previous_scene['RANGES'] if r[0] in [
        'scene-registration-complete', 'scene-transform-getter', 'scene-abs-angles-setter',
        'scene-evaluated-transform-write', 'base-explicit-transform-angle-argument', 'yaw-wrapper-complete']]
    ranges += [r for r in previous_clock['RANGES'] if r[0] in [
        'movement-command-to-post', 'movement-command-clock-tail', 'processed-command-publish', 'cs-command-wrapper']]
    binary = ROOT.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
    if not args.bounded_only:
        digest = hashlib.sha256()
        with binary.open('rb') as source:
            while chunk := source.read(1024*1024): digest.update(chunk)
        assert digest.hexdigest() == EXPECTED
    with binary.open('rb') as source:
        elf = ELFFile(source)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type']=='PT_LOAD']
        def read(a, n):
            assert 0 < n <= 4096
            v, o, z = next(s for s in segments if s[0] <= a and a+n <= s[0]+s[2])
            source.seek(o+a-v)
            b = source.read(n)
            assert len(b) == n
            return b
        def q(a): return struct.unpack('<Q', read(a, 8))[0]
        def string(a): return read(a, 128).split(b'\0')[0].decode('ascii')
        cs = Cs(CS_ARCH_X86, CS_MODE_64)
        instructions = {}
        for name, a, n, expected in ranges:
            b = read(a, n)
            assert hashlib.sha256(b).hexdigest() == expected, name
            instructions.update({i.address: i.mnemonic+' '+i.op_str for i in cs.disasm(b, a)})
        checks = {
            0x159a9d0: 'mov esi, 0xfe0', 0x159a9de: 'mov edx, 0xfe0',
            0x159a9e3: 'xor esi, esi', 0x159a9eb: 'call 0xc7bea0',
            0x159a9f3: 'call 0x1577830', 0x157783c: 'call 0x17a34e0',
            0x1577841: 'mov edx, 0x101', 0x157785b: 'mov word ptr [rbx + 0x324], dx',
            0x1577862: 'mov qword ptr [rbx], rax', 0x15778a7: 'mov qword ptr [rbx + 0x310], rax',
            0x1577959: 'mov dword ptr [rbx + 0x320], 0x100',
            0x1577963: 'mov qword ptr [rbx + 0x328], 0', 0x157796e: 'mov dword ptr [rbx + 0x330], 0',
            0x157788e: 'movups xmmword ptr [rbx + 0x334], xmm0',
            0x157798d: 'mov byte ptr [rbx + 0x360], 0', 0x1577a1b: 'mov dword ptr [rbx + 0x3e8], 0',
            0x1577c97: 'mov qword ptr [rbx + 0x318], rbx',
            0x16210d0: 'cmp dword ptr [rdi + 0x838], esi', 0x16210d8: 'mov dword ptr [rdi + 0x838], esi',
            0x17a2bb9: 'mov qword ptr [rax], r15', 0x17a2bbc: 'cmp dword ptr [r13 + 0x94], 3',
            0x17a2be6: 'ucomiss xmm0, dword ptr [rax + 0x34]', 0x17a2bea: 'jp 0x17a2fc8',
            0x17a2bf0: 'jne 0x17a2fc8', 0x17a2fcb: 'call 0x16210e0',
            0x17a2fd3: 'lea esi, [rax + 1]', 0x17a2fd6: 'call 0x16210d0',
            0x17a2fde: 'je 0x17a2bf6', 0x17a2c25: 'call 0x16210e0',
            0x17a2c45: 'mulss xmm0, xmm1', 0x17a2c63: 'mov dword ptr [r14 + 0x50], 0',
            0x17a2c93: 'mov dword ptr [r14 + 0x44], ecx', 0x17a2d50: 'call 0x17a2460',
            0x17a270c: 'call qword ptr [rax + 0x160]', 0x17a27e4: 'call qword ptr [rax + 0xf8]',
            0x1796b90: 'mov eax, dword ptr [r13 + 8]', 0x1796b98: 'mov dword ptr [r15 + 0x188], eax',
            0x17a288e: 'mov qword ptr [rax], 0', 0x17a2906: 'mov qword ptr [rbx + 0x30], rax',
            0x17a2d80: 'mov qword ptr [rax], 0', 0x17a2d8a: 'mov qword ptr [r14 + 0x30], r15',
            0x15c19b0: 'jmp 0x17969d0', 0x15c2300: 'lea rdi, [rbx + 0x310]',
            0x15c2307: 'call 0x1528090', 0x15c235c: 'call 0x17933c0',
            0x17933d5: 'mov qword ptr [rax], 0', 0x17a303b: 'call rax',
            0x17a303d: 'jmp 0x17a2d87', 0x15280b4: 'call 0xd8dc20',
            0x1528155: 'call 0xd8dd70',
            0x16f5157: 'mov qword ptr [rbx + 0xd4], rax', 0x16f5172: 'movaps xmmword ptr [rbx + 0x20], xmm0',
            0x16f5179: 'je 0x16f5480', 0x16f548d: 'jmp 0x16f533b',
            0x16f53b0: 'movlps qword ptr [rbx + 0xb8], xmm0', 0x16f53ca: 'mov qword ptr [rbx + 0xf0], rax',
            0x16f5387: 'mov esi, 0x102',
            0x16d4e9d: 'mov edi, 0x60', 0x16d4ee7: 'mov qword ptr [r12], rax',
            0x16d4fb9: 'mov qword ptr [r12 + 0x18], rax', 0x16d50bb: 'mov qword ptr [rbx + 0x68], r12',
            0x16f4097: 'lea rdi, [rbx + 0xf0]', 0x16f40bd: 'call 0x23bb110',
            0x16f40c8: 'movaps xmmword ptr [r12 + 0x10], xmm0', 0x16f413e: 'movaps xmmword ptr [r12 + 0x30], xmm0',
            0x16f431e: 'movzx edx, byte ptr [rbx + 0x54]', 0x16f48f9: 'cmp qword ptr [rbx + 0x48], rax',
            0x16f47f4: 'lea rdi, [rbx + 0x10]', 0x16f4914: 'lea rdi, [rbx + 0x30]',
            0x16f4698: 'call 0x23b8440', 0x16f46ec: 'call 0x23b8440', 0x16f4740: 'call 0x23b8440',
            0x23b8495: 'comiss xmm2, xmm0', 0x23b8498: 'seta al',
            0x16f4878: 'mov qword ptr [r15 + 0xf0], rax', 0x16f487f: 'movss dword ptr [r15 + 0xf8], xmm4',
        }
        for a, text in checks.items(): assert instructions[a] == text, (hex(a), instructions.get(a), text)
        # PLT jump and exact relocation index; no symbol-table/full-code scan.
        assert read(0xc7bea0, 6) == b'\x41\xbb\x4d\x0e\x00\x00'
        assert read(0xc7bea6, 2) == b'\xff\x25'
        got = 0xc7beac+struct.unpack('<i', read(0xc7bea8, 4))[0]
        relocation = elf.get_section_by_name('.rela.plt').get_relocation(3661)
        assert got == relocation['r_offset'] == 0x4621b38
        symbols = elf.get_section(elf.get_section_by_name('.rela.plt')['sh_link'])
        assert symbols.get_symbol(relocation['r_info_sym']).name == 'memset'
        classes = [('26CCSPlayer_MovementServices', 0x44bf148), ('23CCSPlayerAnimationState', 0x44bc490),
                   ('14C_CSPlayerPawn', 0x4500730),
                   ('40CInterpolatedVarProceduralUsingOwnerLerpI18TransformHistory_t14CGameSceneNodeE', 0x44d23f8)]
        for name, table in classes: assert string(q(q(table-8)+8)) == name
        virtuals = [(0x44bf148, 0x40, 0x159a980), (0x44bf148, 0x160, 0x15c22c0),
                    (0x44bf148, 0xf8, 0x15c19b0), (0x4500730, 0x280, 0x15b1cf0),
                    (0x44bf148, 0x180, 0x17933e0), (0x44bf148, 0x188, 0x15c2350)]
        for table, slot, target in virtuals: assert q(table+slot) == target
        fields = [(0x4671480, 'm_AnimationState', 0x310), (0x46739c0, 'm_nTickBase', 0x838),
                  (0x4678000, 'm_nLastCommandNumberProcessed', 0x188)]
        names = ['m_currentMoveType','m_groundMoveState','m_groundActionDirection','m_airAction',
                 'm_bWasOnGroundLastUpdate','m_bWasStationaryLastUpdate','m_actionStartTick',
                 'm_staticAimTimerStartTick','m_plantAndTurnStartTick','m_flTurnOnSpotAngle',
                 'm_flPreviousAimYaw','m_flPreviousHorizontalSpeed']
        offsets = [0x10,0x11,0x12,0x13,0x14,0x15,0x18,0x1c,0x20,0x24,0x28,0x2c]
        fields += [(0x46705c0+i*32, n, o) for i,(n,o) in enumerate(zip(names, offsets))]
        for descriptor, name, offset in fields:
            assert string(q(descriptor)) == name
            assert struct.unpack('<I', read(descriptor+16, 4))[0] == offset
        assert string(q(0x44bdd20)) == 'Idle' and q(0x44bdd28) == 1
        epsilon = struct.unpack('<f', read(0xaff650, 4))[0]
        assert epsilon == struct.unpack('<f', struct.pack('<f', .001))[0]
        rip_bindings = [(0x157784c, 0x44bf148), (0x1577872, 0x44bc480),
                        (0x16d4ee0, 0x44d23f8), (0x16d498a, 0x16f4300),
                        (0x16d49b2, 0x16f4040), (0x16f4680, 0xaff650),
                        (0x16f46cc, 0xaff650), (0x16f4720, 0xaff650),
                        (0x17933ce, 0x46d1180), (0x17a2bb2, 0x46d1180)]
        from capstone.x86_const import X86_REG_RIP
        cs.detail = True
        for address, target in rip_bindings:
            instruction = next(cs.disasm(read(address, 15), address))
            mem = next(o.mem for o in instruction.operands if o.type == 3 and o.mem.base == X86_REG_RIP)
            assert instruction.address+instruction.size+mem.disp == target
    report = dict(clientSha256=EXPECTED, wholeArtifactHashVerified=not args.bounded_only,
        provenance='Static matching current-client bytes, schema, RTTI, virtual targets and an exact import relocation. No live process or native execution.',
        assertions=dict(ranges=len(ranges), summedRangeBytes=sum(r[2] for r in ranges), instructions=len(checks),
            classes=len(classes), virtualTargets=len(virtuals), schemaFields=len(fields), imports=1, ripBindings=len(rip_bindings)),
        ranges=[dict(name=n, bytes=z, sha256=h) for n,a,z,h in ranges],
        findings=[
            dict(id='BL01', status='static-bound', rule='The movement-service factory clears a fresh allocation before its actual constructor. The embedded body state starts Idle, with wasOnGround and wasStationary true; named action timers, turn angle, previous aim/speed and produced yaw start zero. Its owner is attached before return. This is construction only.'),
            dict(id='BL02', status='static-bound', rule='In the visible controller-present normal command branch, the controller activity marker is set before the clock seed. Nonzero incoming frame delta increments and stores controller tick base before reading it to seed scoped currentTime, integer tick and zero fraction. The inner wrapper postprocesses body before publishing the processed-command field, clears the pawn marker and restores globals; outer cleanup clears its controller marker then restores its globals. Zero incoming delta skips the increment. Mode3 and alternative virtual overrides are outside this ordinary path.'),
            dict(id='BL03', status='static-bound', rule='A changed SetAbsAngles on a parentless node copies supplied angles into absolute, declared-local and evaluated-local angles and updates absolute quaternion. Unchanged absolute angles return early. The body wrapper reads current absolute scene angles at each invocation, so a free-running isolated yaw accumulator is not established.'),
            dict(id='BL04', status='static-bound', rule='A separately registered TransformHistory procedural interpolation object has a 96-byte current record containing local/world origins and quaternions, scales, parent identity and two small flags. Its consumer selects local or world data for a parentless node using the force-world flag and parent identity, converts quaternion to Euler, and writes evaluated-local angles when any component is not equivalent within float32 0.001 degree. The comparison uses a wrapped difference and a strict less-than tolerance. This consumer does not write declared-local angles.'),
            dict(id='BL05', status='partial', rule='The current pawn explicit-transform virtual reaches the base supplied-angle scene setter. No existing-instance body-state reset has been bound on this path. This is not proof that teleport/respawn never resets: downstream callbacks and scheduling are incomplete.'),
        ],
        evaluatedTransformAngleToleranceDegrees=epsilon,
        nextEvidence=[
            'Before/after identity-bound body state and constructor/reset call ownership across spawn, death/respawn and explicit transform changes.',
            'Entry/exit association between command, incremented controller seed, body update and processed-command publication; inactive sampled markers alone cannot identify the retained invocation.',
            'Transform-history current record, selected history endpoints, evaluation clock/context, flags and dirty state beside produced/declared/evaluated/absolute angles, with write identity/order.',
        ],
        limits=[
            'New-object initial values are not an existing-instance respawn/equip/teleport reset policy.',
            'Unreviewed child-entity callbacks and downstream explicit-transform calls may modify related state.',
            'The transform interpolation kernel, history producer, caller cadence and reset rules remain unbound; velocity history layout must not be reused for this distinct record.',
            'The current transform getter can leave world fields retained in one flag branch. Reading a record does not prove its world fields were refreshed for the sampled call.',
            'Static control flow cannot associate a polled out-of-scope controller with retained body output or count repeated prediction invocations.',
        ])
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2)+'\n')
    args.evidence.parent.mkdir(parents=True, exist_ok=True)
    args.evidence.write_text(json.dumps(report, indent=2)+'\n')
    print(json.dumps(dict(output=str(args.out), wholeArtifactHashVerified=not args.bounded_only, assertions=report['assertions'])))


if __name__ == '__main__': main()
