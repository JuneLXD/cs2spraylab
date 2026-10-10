"""Verify the current-client scene-yaw writer with bounded static evidence.

Run under the project memory/CPU cap. This hashes the client with a streaming
read, then checks only listed ranges, instructions, literals, schema and tables.
It performs no full code scan, emulation, process access or game control.
Raw native locations stay in this tool and local artifacts; shared evidence is
sanitized. The proof does not establish call cadence or lifecycle reset rules.
"""
import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

PROJECT = Path(__file__).resolve().parents[1]
AUDIT = PROJECT.parent / 'native-audit'
sys.path.insert(0, str(AUDIT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from capstone.x86_const import X86_REG_RIP
from elftools.elf.elffile import ELFFile

EXPECTED = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
RANGES = [
    ('yaw-wrapper-complete', 0x1528090, 0x130, 'b1b0202bbd73224344ae024d420672f1759e43efb3ecc68a70e68d1d7f427c54'),
    ('yaw-producer-step', 0x15267c0, 0x1150, '47da1e9c83f098c06b29b6ec13eb69d3d485438987d8899d9e78a5a0666c5c22'),
    ('yaw-prepare', 0x1525f70, 0x6a0, '757e04997ae0a20db2d35c7950726f84e87a8413187bdbc78b2355135583a7f2'),
    ('yaw-state-handler-a', 0x15273c0, 0x160, '6080c363c35d9c2e76577520670f179492b60e314824fd954663bcade35f7130'),
    ('yaw-state-handler-b', 0x1527520, 0x1e0, '83f1d5a9f4ed73b4b48a6a1f6b205fc8cc564719caeacff6d2a968fffa29b06b'),
    ('yaw-state-handler-c', 0x1527270, 0x150, '431442e7ad04a5364f1b14f755ee9a9ff19e6aa798a2e7073422d17b3e6556f7'),
    ('yaw-state-handler-d', 0x1527700, 0x260, 'c7265d6bc1c76c198e1b594b7d63dfbbc9401f5e2fece24dfaa980c8c3601da9'),
    ('yaw-state-handler-e', 0x1527960, 0x440, 'e797f154b5b7d7a10a4816dc0de6d0f099f91d1f4212089874461cd12e5ed817'),
    ('yaw-state-handler-f', 0x1527da0, 0x190, '5afdcb6bbc77ed41076e7a31bbd120b9b88f60bd4eee513e255e9b970e301b70'),
    ('yaw-dispatch', 0x1527f30, 0x160, '2a4845e34dfd81b21b8293a3f455cdd9949098c93981dae1e61bfecfc8547361'),
    ('yaw-angle-diff', 0x23b83e0, 0x170, '6c8942127713dc797744499ac93bd27bef93a8e4831c799d460ca86dd75a5d7c'),
    ('yaw-tick-provider', 0x17f35c0, 0xc0, 'fd8f3b3bef56d916715f2c08076d17d91d91cbe410a9d13e4becc9290eee7a94'),
    ('yaw-context-tick', 0x1389c40, 0x90, 'cb73524306111e4c278c68b26fb31a4eaf547bc27c06c31db4cf26114c0ff739'),
    ('yaw-added-angle', 0x15892c0, 0x230, '4828e492c7ddfb507210b97af8165664acecc43fcd24ff3f3f6ed2c5442f903e'),
    ('movement-post-base', 0x17ac0b0, 0x300, '2f78fd083db62749a3cdcf6be16700eb38cf6ddfc9590158c9e4e39c22c78aa7'),
    ('scene-transform-getter', 0x16f4040, 0x2c0, 'dbbea75f5fff20bf4f4f9e62c57d1793f610e3bcdf86659bd36976245965052e'),
    ('scene-registration-complete', 0x16d4980, 0x760, '83d4e792971770e74ec47952343eb5ed36468decc319af52430b8c2f7da9bd63'),
    ('skeleton-registration', 0x18262a0, 0xc0, '0f2c8934c1258056c2221fa5072a18ffba1cbcff7596b29a27a286a0235789f6'),
    ('scene-angle-callback-registration', 0x10aa6e0, 0x200, 'b590f65b09983eb72cb0d2c1457fde40208918a8feb13eb89e6401f3e31f984c'),
    ('pawn-abs-transform-accessor', 0xd8de20, 0x50, 'd086bcb62a941ad61a9c72b8e5d7dfa34515825ed84d289c32490f2e7cc6c1c2'),
    ('scene-abs-transform-update', 0x16f3ee0, 0x310, '445eaf4bf805d60f68335abe63850979b10b5673f9191ab93157220febc2adba'),
    ('scene-local-angles-setter', 0x16f4d00, 0x1c0, '8b4545ea302955592febfb1b3e36fb34d08b869df71fae0f1fc05096b5a6832b'),
    ('scene-abs-angles-setter', 0x16f50f0, 0x3c2, '4261ef066414aed91e74e93ecefcf8d425573c2a4cc63a690dcf4bf60bab56dd'),
    ('scene-local-angle-copy', 0x16f5710, 0x22, 'ba2e05ed3703c07b0f4015c5c207b72e9e624cc014987375f7d7ab247f010e07'),
    ('scene-evaluated-transform-write', 0x16f4300, 0x6ca, 'fefc3af5758ed05266ca4e621bb61978708ee24ae52c46f84120ce54425cb1fb'),
    ('pawn-explicit-transform-override', 0x15b1cf0, 0xf6, 'd4cfe52577b61582dd71294acdacb21119f6f882da6f5af91255eb180a0e4c33'),
    ('base-explicit-transform-angle-argument', 0xdce8c4, 0x30, '7c19fa2f976004025a1fbfe5ceaa99958b10aab7dec291346fe25a96a2f4c367'),
    ('pawn-owned-entity-array-angle-update', 0x1a9958c, 0x29, '1eb76cc804b92323db24bbf6e97c0b377d3b5844aca434b4f14b51215a79ada8'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', type=Path, default=PROJECT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so')
    parser.add_argument('--out', type=Path, default=AUDIT / 'reports/reaudit-scene-writer-portable')
    parser.add_argument('--evidence', type=Path, default=PROJECT / 'docs/evidence/reaudit-scene-writer.json')
    args = parser.parse_args()
    digest = hashlib.sha256()
    with args.binary.open('rb') as source:
        while chunk := source.read(1024*1024):
            digest.update(chunk)
    assert digest.hexdigest() == EXPECTED, 'Unsupported client hash'
    args.out.mkdir(parents=True, exist_ok=True)
    with args.binary.open('rb') as source:
        elf = ELFFile(source)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                    for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']

        def read(address, size):
            assert 0 < size <= 8192
            v, offset, _ = next(s for s in segments if s[0] <= address and address+size <= s[0]+s[2])
            source.seek(offset+address-v)
            data = source.read(size)
            assert len(data) == size
            return data

        def q(address):
            return struct.unpack('<Q', read(address, 8))[0]

        def string(address):
            return read(address, 128).split(b'\0', 1)[0].decode('ascii')

        cs = Cs(CS_ARCH_X86, CS_MODE_64)
        cs.detail = True
        raw_ranges = []
        for name, address, size, expected in RANGES:
            data = read(address, size)
            actual = hashlib.sha256(data).hexdigest()
            assert actual == expected, name
            instructions = [f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(data, address)]
            (args.out / (name+'.txt')).write_text('\n'.join(instructions)+'\n')
            raw_ranges.append(dict(name=name, address=hex(address), bytes=size, sha256=actual))

        instructions = {
            0x15c22cd: 'call 0x17ac0b0',
            0x15c2300: 'lea rdi, [rbx + 0x310]',
            0x15c2307: 'call 0x1528090',
            0x152809e: 'mov r12, qword ptr [rdi + 8]',
            0x15280a2: 'mov rdi, qword ptr [r12 + 0x38]',
            0x15280b0: 'mov qword ptr [rbx + 0x40], rdi',
            0x15280b4: 'call 0xd8dc20',
            0x1528118: 'movss dword ptr [rbx + 0xd8], xmm0',
            0x1528123: 'call 0x1525f70',
            0x152812b: 'call 0x15267c0',
            0x1528133: 'call 0x1526610',
            0x152813b: 'call 0x1527f30',
            0x1528140: 'mov rdi, qword ptr [rbx + 0x40]',
            0x1528148: 'movss xmm0, dword ptr [rbx + 0xd8]',
            0x1528155: 'call 0xd8dd70',
            0x1528162: 'movss dword ptr [rbx + 0x28], xmm0',
            0x15267d3: 'call qword ptr [rax + 0x568]',
            0x15267dd: 'mov esi, 1',
            0x15267e7: 'call 0x15892c0',
            0x15892c0: 'mov rdi, qword ptr [rdi + 0x1520]',
            0x15892cb: 'jmp 0x1511f90',
            0x15268b7: 'subss xmm1, dword ptr [rbx + 0x28]',
            0x15268d7: 'movss dword ptr [rbx + 0xd4], xmm1',
            0x152741d: 'call 0x23b83e0',
            0x152742e: 'divss xmm1, dword ptr [rbx + 0xa0]',
            0x1527487: 'movss dword ptr [rbx + 0xd8], xmm0',
            0x1527754: 'cmp eax, 0xb',
            0x1527780: 'minss xmm0, xmm2',
            0x15277a5: 'movss dword ptr [rbx + 0xd8], xmm2',
            0x1527a22: 'cmp eax, 0x5f',
            0x1527f4f: 'call 0xd8b3c0',
            0x1527f54: 'and r12d, 1',
            0x1527fd1: 'movss dword ptr [rbx + 0xd8], xmm0',
            0x1527fea: 'mov byte ptr [rbx + 0x14], r13b',
            0x1527fee: 'mov byte ptr [rbx + 0x50], 0',
            0x17f35dc: 'call 0x1389c40',
            0x17f3602: 'add eax, dword ptr [rbp - 8]',
            0x16d498a: 'lea rax, [rip + 0x1f96f]',
            0x16d49b2: 'lea rax, [rip + 0x1f687]',
            0x16d4a78: 'call 0x18835a0',
            0x18262bf: 'call 0x16d4980',
            0x16f4097: 'lea rdi, [rbx + 0xf0]',
            0x16f40bd: 'call 0x23bb110',
            0x10aa7d3: 'lea rdx, [rip + 0x64af36]',
            0x10aa80a: 'mov qword ptr [rbp - 0xb8], rdx',
        }
        for address, expected in instructions.items():
            i = next(cs.disasm(read(address, 15), address))
            assert i.mnemonic+' '+i.op_str == expected, (hex(address), i.mnemonic+' '+i.op_str, expected)

        classes = [
            ('26CCSPlayer_MovementServices', 0x44bf148, [(0x160, 0x15c22c0)]),
            ('23CCSPlayerAnimationState', 0x44bc490, []),
            ('14C_CSPlayerPawn', 0x4500730, [(0x568, 0x1a59580)]),
            ('14CGameSceneNode', 0x44d2198, [(0x58, 0x16d4980)]),
            ('17CSkeletonInstance', 0x44dcf80, [(0x58, 0x18262a0)]),
        ]
        for name, table, slots in classes:
            assert string(q(q(table-8)+8)) == name
            for slot, expected in slots:
                assert q(table+slot) == expected

        fields = [
            (0x46415e0, 'm_pMovementServices', 0x12b8),
            (0x4671480, 'm_AnimationState', 0x310),
            (0x467ef60, 'm_pAimPunchServices', 0x1520),
            (0x4671540, 'm_flDuckAmount', 0x40c),
            (0x4678000, 'm_nLastCommandNumberProcessed', 0x188),
            (0x46780e0, 'm_flForwardMove', 0x1c0),
            (0x4678100, 'm_flLeftMove', 0x1c4),
            (0x4678120, 'm_flUpMove', 0x1c8),
        ]
        state_names = ['m_currentMoveType', 'm_groundMoveState', 'm_groundActionDirection', 'm_airAction',
                       'm_bWasOnGroundLastUpdate', 'm_bWasStationaryLastUpdate', 'm_actionStartTick',
                       'm_staticAimTimerStartTick', 'm_plantAndTurnStartTick', 'm_flTurnOnSpotAngle',
                       'm_flPreviousAimYaw', 'm_flPreviousHorizontalSpeed']
        state_offsets = [0x10,0x11,0x12,0x13,0x14,0x15,0x18,0x1c,0x20,0x24,0x28,0x2c]
        fields += [(0x46705c0+i*32, name, offset) for i,(name,offset) in enumerate(zip(state_names,state_offsets))]
        for descriptor, name, offset in fields:
            assert string(q(descriptor)) == name
            assert struct.unpack('<I', read(descriptor+16, 4))[0] == offset
        assert string(q(0x4670548)) == 'CCSPlayerAnimationState'
        assert struct.unpack('<I', read(0x4670560, 4))[0] == 0xe0
        assert string(q(0x442b4c0)) == 'gameSceneNodeLocalAnglesChanged'

        states = ['None', 'Idle', 'Start', 'Move', 'TurnOnSpot', 'TurnOnSpotLoop', 'PlantAndTurn']
        expected_branches = [0x1527fdf,0x1528080,0x1528070,0x1528060,0x1528050,0x1528040,0x1528030]
        for value, (name, branch) in enumerate(zip(states, expected_branches)):
            assert string(q(0x44bdd00+32*value)) == name
            assert q(0x44bdd08+32*value) == value
            assert 0x9901d0+struct.unpack('<i', read(0x9901d0+4*value,4))[0] == branch

        literals = {
            0x15268cc:64, 0x15268fd:70, 0x1526924:70, 0x152692c:1,
            0x15273ce:10, 0x1527439:80, 0x1527441:55, 0x1527449:1/64,
            0x1527457:45, 0x15274f8:-45,
            0x1527739:0.5, 0x1527744:16, 0x1527764:12,
            0x1527778:1/64, 0x152779d:64,
            0x1527974:10, 0x1527981:15, 0x15279b0:5, 0x15279d0:30,
            0x15279e9:45, 0x1527a0a:5,
        }
        literal_rows = []
        for address, expected in literals.items():
            i = next(cs.disasm(read(address,15),address))
            mem = next(o.mem for o in i.operands if o.type == 3 and o.mem.base == X86_REG_RIP)
            target = address+i.size+mem.disp
            actual = struct.unpack('<f',read(target,4))[0]
            assert actual == expected, (hex(address),actual,expected)
            literal_rows.append(dict(instruction=hex(address), target=hex(target), value=actual))

    counts = dict(byteRanges=len(raw_ranges), boundedRangeBytes=sum(x['bytes'] for x in raw_ranges),
                  instructionAssertions=len(instructions), classAssertions=len(classes),
                  virtualTargetAssertions=sum(len(x[2]) for x in classes), schemaFieldAssertions=len(fields),
                  groundStateAssertions=len(states), literalAssertions=len(literals))
    local = dict(clientSha256=EXPECTED, ranges=raw_ranges, instructions={hex(k):v for k,v in instructions.items()},
                 literals=literal_rows, proof=counts)
    (args.out/'proof.json').write_text(json.dumps(local,indent=2)+'\n')
    findings = dict(
        clientSha256=EXPECTED,
        provenance='Static matching-client byte, instruction, literal, RTTI, vtable and schema assertions. No native execution or live capture in this probe.',
        proof=counts,
        nativeRangeSha256={x['name']:x['sha256'] for x in raw_ranges},
        ownership=['CCSPlayer_MovementServices post-processing calls its named embedded CCSPlayerAnimationState.',
                   'The animation-state wrapper reads its owner pawn absolute angles, updates working yaw, then writes the same pawn absolute angles.',
                   'Working yaw starts from current scene absolute yaw on each call. Original absolute pitch and roll are preserved.'],
        inputs=['Aim yaw combines the pawn source-angle getter and the AimPunchServices result, then normalizes the result.',
                'Movement preparation uses command direction, transformed entity velocity, horizontal speed, pawn max-speed helper and duck amount.',
                'Named action timers use a context-selected tick plus normalized fraction. The context-zero tick path can consult prediction state.'],
        groundStates=states,
        decodedRules=[
            dict(name='pre-dispatch yaw limit', rule='If wrapped absolute aim/body difference exceeds70 degrees, adjust body to leave69 degrees.'),
            dict(name='Move', rule='When speed>10 and no PlantAndTurn transition: d=clamp(AngleDiff(body,aim),-45,45); step=(80*speed/maxSpeed+55)/64; body=aim+sign(d)*max(abs(d)-step,0).'),
            dict(name='Idle', rule='At speed<=10, absolute aim/body error<=5 preserves body yaw. Speed between10 and15 enters Move; speed>=15 enters Start.'),
            dict(name='stationary turn trigger', rule='Idle error>30 degrees or aim-change rate>=45 enters TurnOnSpotLoop. Rate is abs((normalized aimYaw-previousAimYaw)*64), without another wrap.'),
            dict(name='TurnOnSpotLoop', rule='For nonnegative elapsed ticks: signed step magnitude=min(absError,absError*0.5*16/64*min((elapsed+1)/12,1)). Return to Idle when abs(step*64)<16; moving above10 enters Move.'),
            dict(name='moderate stationary error', rule='A separate static-aim timer and weapon/angle gates select TurnOnSpot or TurnOnSpotLoop after more than95 elapsed ticks. TurnOnSpot has its own trigonometric progression.'),
            dict(name='air and ladder paths', rule='These dispatch branches assign working body yaw directly from aim yaw. A transient override also bypasses ground dispatch and is cleared at dispatch exit.'),
        ],
        sceneEvaluation='Skeleton scene registration delegates to the base scene node, binding transform getter/setter callbacks to a node-owned interpolation value. Local-angle-change callback copies declared local angles into the evaluated local cache. Transform rebuild consumes that cache.',
        captureHelper='tools/reaudit-scene-writer-capture-fields.py; optional parent-owned sampler extension, not a live attachment or capture.',
        nextCaptureFields=['Movement service identity and embedded state identity',
                           'Move/ground/air states, action timers, previous aim and produced yaw',
                           'Aim yaw/pitch, signed and absolute body error, aim-change rate',
                           'Horizontal speed, max speed, duck amount and command direction',
                           'Last processed command number, context selector, raw global tick and fraction',
                           'Existing source/local/evaluated/absolute angles and quaternion in the same coherent snapshot'],
        limits=['The fixed1/64 literals do not establish call frequency or render-versus-command phase.',
                'Caller cadence and prediction/subtick ordering remain unverified.',
                'Construction, spawn, death, equip, teleport and rewind reset rules remain unverified.',
                'Full state-machine replay, PlantAndTurn eligibility and transient-override setters remain unverified.',
                'Max-speed and aim-punch evaluation contexts are not reduced to a trainer formula.',
                'Transform history time/bracket selection and interpolation phase remain unverified.',
                'Schema dispatch/getter code is not constructor or reset proof.',
                'No production body-yaw correction follows from this static-only proof.'])
    sanitized = json.dumps(findings, indent=2)+'\n'
    assert not re.search(r'\b0x[0-9a-f]+\b', sanitized), 'Raw native location in shared evidence'
    args.evidence.parent.mkdir(parents=True,exist_ok=True)
    args.evidence.write_text(sanitized)
    print(json.dumps(dict(status='passed', proof=counts, evidence=str(args.evidence))))


if __name__ == '__main__':
    main()
