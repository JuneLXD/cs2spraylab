#!/usr/bin/env python3
"""Validate packaged current-hash caller/dispatch evidence without binary access."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
SOURCES = {
    'read-caller.py': '8470448849d11d0bea09f9b519c2cad0e5b0584ad4dc78e7b70d486c2f0201ff',
    'pawn-caller-location.json': 'eb103b04b97338e15e09ea96ff9122b4debf293ebfaa1a7daf2804cee04bbbd1',
    'pawn-caller-rea.json': '31d826ac9da61c8ac089c5fa9bda6b72ab21c7b09536d8cf34e1ff485a21c48d',
    'caller-proof.json': '15bb73c8a63534f68b24fe5e38b816906cc111c4db1981b1ddd48f22ecd5ecfb',
    'pawn-command-caller.txt': 'f255edbf96ef277ffde39d6b1825973aef4352b7d81cf8c0bd27450c7af55889',
    'retained/movement-ownership.json': 'e243934f73f5bd970205b6ee3b2f945ec73c3da4df1450116e4bff17f8dd6c59',
    'retained/movement-wrapper.txt': '0e0e46bbc3b2ac6269776e0661add43435eddf50631c41c40a48ebd9782c3387',
    'retained/movement-loop.txt': '63a3d7661224f5088fb74c07b33fa8cf8cd33f1bfbab1f8f82e4b16bb4dacfa8',
    'retained/prepare-segments.txt': 'e40343bf8c4cfa9d24f991659ec1acc7cda9e17d7271689b0e677e45d1a95cb3',
    'retained/held-clock-report.json': '563ccae5468a3f2e554d8859d6962bf96892ce8f18222f67f2eb0c534bc95334',
    'retained/remaining-clock.txt': '93d77170857df7c06e046e15c5a7af5d7fd815480999c308934123ad3a212e80',
    'retained/remaining-callback.txt': 'cdf7f270c361310a39500f8683febd7218ed1a88aeff1c326e03a8c8be5e9328',
    'retained/remaining-weapon.txt': '188ffe987b8f466955f6455693a7a670cdbcb9c9cd410d0d3d4f21deba5ffd45',
    'retained/awp-current.json': '78bc6b31b20fd4461905f8f5f21c6fa166c31e474ccd17f06d58b3a5ed20595d',
    'retained/awp-postframe.txt': '95b62bd98c996fdda68e8bf6f98e508998ed251b06f542280015ce50a9b88f45',
    'retained/awp-input.txt': 'ca07840cf94ef9bc5c7d4f56733e90f122ea7c08fd145ea3c67faeaf2bd77f94',
    'retained/awp-secondary.txt': '03d60e21ee51ec602a1a75925fe750b7ed56fecf7962da269947eb42b487cbe0',
    'retained/secondary-wrapper-report.json': '6a4efd9b6317901279fe1517534937c05bf2fb30639071287f2056db6322d1ba',
    'retained/secondary-wrapper.txt': 'ac5eac2990dfe250e472962be955086af3d9e4e5fbe1859353c9697a5e878f92',
    'retained/secondary-thunk-report.json': 'd48c876b1de89f3de8988afbd28df62413a20ec4f456826537fb3dd7c6df5f42',
    'retained/secondary-thunk.txt': 'f5b2f6e66bf95bc053bed975f7ef8e11fa7b6eb2f87afb91f4c4c14c4d1a58cf',
}
CHECKS = {
    'pawn-command-caller.txt': [
        '17c3291: call qword ptr [rax + 0x118]',
        '17c32e3: mov rsi, r12', '17c32e6: mov rdx, r14', '17c32e9: mov rdi, r15',
        '17c32f0: call 0x17ba890', '17c32fb: mov rax, qword ptr [r15]',
        '17c32fe: mov rsi, r12', '17c3301: mov rdx, r14', '17c3304: mov rdi, r15',
        '17c3307: call qword ptr [rax + 0x138]', '17c3310: mov rdx, r14',
        '17c3313: mov rsi, r12', '17c3316: mov rdi, r15', '17c3319: call 0x17bad90',
    ],
    'retained/movement-wrapper.txt': [
        '15d8407: call 0x1592070', '15d840c: movss dword ptr [r13 + 0x11c], xmm0',
        '15d845f: call 0x15d7e60', '15d85a6: call 0x15d7e60',
    ],
    'retained/movement-loop.txt': [
        '17baaf1: mov rcx, qword ptr [rax + 0x120]',
        '17bab01: mov rcx, qword ptr [rax + 0xe8]',
        '17bab18: mov rax, qword ptr [rax + 0x140]',
    ],
    'retained/prepare-segments.txt': [
        '17c601a: test eax, 0x801', '17c601f: je 0x17c5fa8',
        '17c6021: movsxd r9, dword ptr [r13 + 0x78]',
        '17c603c: mov rsi, qword ptr [r13 + 0x80]',
        '17c604b: movss dword ptr [rsi], xmm0', '17c604f: mov qword ptr [rsi + 8], rax',
        '17c6053: mov byte ptr [rsi + 0x10], r8b',
        '17c6057: mov qword ptr [rbx + 8], 0', '17c605f: mov qword ptr [rbx + 0x10], 0',
    ],
    'retained/remaining-clock.txt': [
        '17bae40: movlps qword ptr [r15 + 0x30], xmm0',
        '17bae49: mov dword ptr [r15 + 0x44], edx',
        '17bae5b: movss dword ptr [r15 + 0x50], xmm1',
        '17bae7f: movss xmm0, dword ptr [rdx + r13 + 0x18]',
        '17bae86: ucomiss xmm0, dword ptr [rbx]', '17bae8b: je 0x17baeab',
        '17bae9b: mov rdx, qword ptr [rdx + 0x150]',
        '17baf75: call 0x17ba790', '17bafa4: call rdx',
        '17baeab: mov qword ptr [r15 + 0x30], r10',
        '17baeb3: mov dword ptr [r15 + 0x44], r9d',
        '17baeb7: movss dword ptr [r15 + 0x50], xmm2',
    ],
    'retained/remaining-callback.txt': [
        '157f2c0: mov rax, qword ptr [rdi + 0x38]',
        '157f2c9: mov rdi, qword ptr [rax + 0xdf0]', '157f2d0: jmp 0x15e1420',
    ],
    'retained/remaining-weapon.txt': [
        '15e1424: call 0x17d84c0', '15e1435: mov rax, qword ptr [rax + 0xd40]', '15e143c: jmp rax',
    ],
    'retained/awp-postframe.txt': [
        '14b4534: call 0x1641710', '14b453b: jne 0x14b4560',
        '14b4560: cmp byte ptr [r12 + 0x179d], 0',
        '14b456b: mov edx, dword ptr [rbx + 0x1548]', '14b4573: jle 0x14b453d',
        '14b45d4: mov dword ptr [rbx + 0x1248], 1',
        '14b462b: call 0x1543eb0', '14b4652: mov byte ptr [r12 + 0x179c], 1',
        '14b46aa: mov byte ptr [r12 + 0x179d], 0', '14b46b3: jmp 0x14b453d',
        '14b4558: jmp 0x14b3fd0',
    ],
    'retained/awp-input.txt': [
        '14b402c: mov esi, 0x800', '14b4034: call 0x16412f0',
        '14b4040: call 0x16417a0', '14b4047: jne 0x14b4188',
        '14b418e: call 0x14a9b70',
    ],
    'retained/secondary-wrapper.txt': ['14a9cf8: jmp 0x14957f0'],
    'retained/secondary-thunk.txt': ['1495930: call qword ptr [rdx + 0xd38]'],
    'retained/awp-secondary.txt': [
        '14bfd01: lea ebx, [rax + 1]', '14bfd0c: mov dword ptr [r15 + 0x1548], ebx',
        '14bfd92: call 0x14bf050',
    ],
}


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing output overwrite'
    for name, expected in SOURCES.items():
        assert (ROOT / name).stat().st_size < 100000, name
        assert digest(ROOT / name) == expected, name
    facts = 0
    for name, lines in CHECKS.items():
        listing = (ROOT / name).read_text()
        for line in lines:
            assert line in listing, (name, line)
            facts += 1
    read_json = lambda name: json.loads((ROOT / name).read_text())
    proof = read_json('caller-proof.json')
    assert proof['status'] == 'passed' and proof['wholeArtifactHashVerified']
    assert proof['selectedBytes'] == 1350 and proof['serverSha256'] == SERVER_SHA
    own = read_json('retained/movement-ownership.json')
    assert own['serverSha256'] == SERVER_SHA and own['fullServerHashVerified']
    assert own['slots']['0xe8'] == '0x15d82e0' and own['slots']['0x120'] == '0x15d3580'
    assert own['slots']['0x140'] == '0x15b04d0'
    held = read_json('retained/held-clock-report.json')
    assert held['serverSha256'] == SERVER_SHA
    binding = held['currentMovementClassBinding']
    assert binding['name'] == '26CCSPlayer_MovementServices' and binding['slots']['0x150'] == '0x157f2c0'
    awp = read_json('retained/awp-current.json')
    assert awp['serverSha256'] == SERVER_SHA and awp['wholeArtifactHashVerified']
    assert awp['class'] == 'CWeaponAWP'
    assert awp['slots']['0xd40'] == '0x14b4510' and awp['slots']['0xd38'] == '0x14bfa70'
    for name in ('secondary-wrapper-report', 'secondary-thunk-report'):
        row = read_json('retained/' + name + '.json')
        assert row['serverSha256'] == SERVER_SHA and row['wholeArtifactHashVerified']
    result = {
        'schema': 'cs2.awp-movement-phase-native-evidence.v1', 'status': 'passed',
        'serverSha256': SERVER_SHA, 'checkerSha256': digest(Path(__file__)),
        'sources': SOURCES, 'instructionFacts': facts,
        'nativeExecution': False, 'newBinaryReads': 0,
        'freshCallerProof': {
            'selectedBytes': proof['selectedBytes'], 'selectedByteCeiling': proof['selectedByteCeiling'],
            'wholeArtifactHashVerified': proof['wholeArtifactHashVerified'],
            'readerSha256': proof['readerSha256'], 'decodedInstructions': proof['decodedInstructions'],
            'ranges': [{'bytes': row['bytes'], 'sha256': row['sha256']} for row in proof['reads']],
            'straightLineMovementThenPostMovementThenRemainingEvents': True,
            'sameReceiverAndMoveDataAtAllThreeCalls': True,
        },
        'ordering': ['Command preparation', 'Complete movement-segment loop',
                     'Typed post-movement preparation', 'Remaining-event weapon postframes', 'Input finalization'],
        'lowerJoins': [
            'The actual movement class segment callback samples maximum speed and stores it before the ground dispatcher.',
            'The demonstrated subtick preprocessing branch separates primary and secondary button payloads from movement records into remaining-event records.',
            'Remaining-event processing installs normalized event tick/fraction and applies edges before its one callback per distinct fraction.',
            'The actual movement remaining callback obtains the active weapon and invokes its postframe slot.',
            'The actual AWP postframe runs eligible automatic rescope before common input processing.',
            'Eligible secondary input reaches the common secondary wrapper and thunk, then the actual AWP secondary implementation.',
        ],
        'limits': ['The top caller was reread from the matching server; lower bindings are checked retained evidence.',
                   'The held-clock read ledger records that its own pass did not recompute the full binary hash.',
                   'Secondary edges are moved only on the demonstrated input preprocessing branch.',
                   'Automatic rescope and manual secondary remain subject to weapon eligibility/readiness gates.',
                   'Per-event normalized time and one callback per distinct fraction do not imply a 128Hz trainer-step rule.',
                   'No native/trainer command association, live invocation or phase correction is established.'],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, allow_nan=False) + '\n')
    print(json.dumps({'output': str(args.out), 'sha256': digest(args.out),
                      'sources': len(SOURCES), 'instructionFacts': facts, 'status': 'passed'}))


if __name__ == '__main__':
    main()
