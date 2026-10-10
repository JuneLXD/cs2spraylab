"""Check current-byte common-weapon reload gates and preserve bounded findings.

Run reaudit-common-reload-native.py first, under the same 512 MiB / CPU100 cap.
This checker validates retained disassembly and data bindings; it executes no
native code. Raw locations are confined to this local script and raw reports.
Defaults resolve the sibling native-audit from this file. --portable-report
writes an allowlisted report without native addresses or machine paths.
"""
import argparse
import hashlib
import json
from pathlib import Path

DEFAULT_ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
CHECKS = {
    'common-input-dispatch': [
        '14b3ff9: call 0x16412f0', '14b4005: call 0x1641710',
        '14b400c: jne 0x14b4128', '14b412e: call 0x14b0360',
        '14b4136: jne 0x14b406f', '14b4149: jmp 0x14b406f',
        '14b4012: movabs rsi, 0x400000000', '14b40b3: call 0x16417a0',
        '14b40ba: je 0x14b402c', '14b4104: jne 0x14b406f',
        '14b411c: jmp 0x14b406f', '14b402c: mov esi, 0x800',
        '14b4040: call 0x16417a0', '14b4047: jne 0x14b4188',
        '14b418e: call 0x14a9b70', '14b4196: jne 0x14b406f',
        '14b41a9: jmp 0x14b406f', '14b404d: mov esi, 0x2000',
        '14b4055: call 0x16412f0', '14b4062: cmp byte ptr [rbx + 0x1280], 0',
        '14b4069: je 0x14b4150', '14b4153: call 0x14986a0',
        '14b415a: jne 0x14b416e', '14b4169: call 0x14ab770',
        '14b4171: call 0x1641710', '14b4178: je 0x14b406f',
        '14b417e: jmp 0x14b4220', '14b4226: call 0x14b3c90',
        '14b41e4: call 0x1641710', '14b41eb: je 0x14b4230',
    ],
    'ordinary-gun-postframe': [
        '14b4534: call 0x1641710', '14b4560: cmp byte ptr [r12 + 0x179d], 0',
        '14b462b: call 0x1543eb0', '14b46b3: jmp 0x14b453d',
        '14b453d: mov eax, dword ptr [rbx + 0x154c]',
        '14b4545: jg 0x14b46d0', '14b4558: jmp 0x14b3fd0',
        '14b46da: mov rax, qword ptr [rax + 0xd58]',
        '14b46ed: movzx eax, byte ptr [rax + 0x71d]',
        '14b46f6: je 0x14b454b', '14b46ff: call 0x1641710',
        '14b4706: je 0x14b454b', '14b470f: call 0x14a8c10',
        '14b4714: jmp 0x14b454b',
    ],
    'primary-dispatch': [
        '14b03eb: mov edx, dword ptr [r12 + 0x17b8]',
        '14b03f5: jg 0x14b0678', '14b03fb: cmp byte ptr [r12 + 0x17d0], 0',
        '14b0404: jne 0x14b06c0', '14b05f8: call qword ptr [rax + 0xd30]',
        '14b06c0: xor r12d, r12d',
    ],
    'primary-ready': [
        '164171e: mov esi, dword ptr [rdi + 0x1190]',
        '1641724: movss xmm0, dword ptr [rdi + 0x1194]',
        '1641730: call 0x22b49a0', '1641742: mov edi, dword ptr [rax + 0x38]',
        '164174a: call 0x17fd290', '1641752: setle dl',
        '164177a: je 0x1641798', '1641798: mov edx, 1',
    ],
    'secondary-ready': [
        '16417ae: mov esi, dword ptr [rdi + 0x1198]',
        '16417b4: movss xmm0, dword ptr [rdi + 0x119c]',
        '16417da: call 0x17fd290', '16417e2: setle dl',
        '164180a: je 0x1641828', '1641828: mov edx, 1',
    ],
    'current-time-pair': [
        '17fd2a2: movss xmm0, dword ptr [rax + 0x50]',
        '17fd2ac: call 0x134e880', '17fd2bc: call 0x22b49a0',
        '17fd2c1: mov rax, qword ptr [rbp - 8]',
    ],
    'input-active': [
        '1641374: and rdx, qword ptr [rdi + 0x58]',
        '1641378: mov eax, 1', '164137d: je 0x1641390',
        '1641398: jmp 0x17b85e0',
    ],
    'input-transition-wrapper': ['17b85e0: add rdi, 0x50', '17b85e4: jmp 0x1079c70'],
    'input-transition-predicate': [
        '1079c7c: and rdx, qword ptr [rdi + 0x10]',
        '1079c80: mov rax, qword ptr [rdi + 0x18]',
        '1079c84: je 0x1079c8a', '1079c86: or rax, qword ptr [rdi + 8]',
        '1079c8a: test rax, rsi', '1079c8d: setne al',
    ],
    'manual-reload-dispatch': [
        '14b3ca6: call qword ptr [rax + 0xd68]',
        '14b3cd8: call qword ptr [rax + 0xd88]',
        '14b3cde: test al, al', '14b3ce0: je 0x14b3d58',
    ],
    'magazine-reload': [
        '14aa292: call 0x14a6f10', '14aa29a: test al, al',
        '14aa29c: jne 0x14aa2b0', '14aa2ad: ret ',
    ],
    'base-reload-entry': ['14a6f2a: call qword ptr [rax + 0xd90]',
                          '14a6f33: test al, al', '14a6f35: je 0x14a6fe2'],
    'reload-start': ['14ad040: call 0x1641650', '14ad048: je 0x14ad1d0',
                     '14ad051: call 0x14986a0', '14ad05b: je 0x14ad1d0',
                     '14ad0ee: mov byte ptr [rbx + 0x1280], 1',
                     '14ad1bb: call 0x14ac820'],
    'burst-continuation': ['14a8c51: call qword ptr [rax + 0xd30]',
                           '14a8c94: lea r12d, [rax - 1]',
                           '14a8d8d: mov dword ptr [r14 + 0x154c], r12d',
                           '14a8d94: cmp eax, dword ptr [rbx + 0x17b8]',
                           '14a8e76: mov dword ptr [r14 + 0x154c], 0'],
}


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native-root', type=Path, default=DEFAULT_ROOT)
    p.add_argument('--input', type=Path, help='Directory produced by the bounded reader')
    p.add_argument('--reader', type=Path, default=Path(__file__).with_name('reaudit-common-reload-native.py'))
    p.add_argument('--out', type=Path, help='Local findings JSON')
    p.add_argument('--portable-report', type=Path)
    args = p.parse_args()
    root = args.native_root.resolve()
    source_dir = args.input or root / 'reports/reaudit-common-reload-portable'
    current_path = source_dir / 'current-read.json'
    current = json.loads(current_path.read_text())
    assert current['serverSha256'] == EXPECTED and current['wholeArtifactHashVerified']
    assert current['scriptSha256'] == sha(args.reader)
    assert not current['missing'] and len(current['classes']) == 7
    assert current['virtualSlotAssertions'] == 63
    records = {row['name']: row for row in current['codeRanges']}
    assertions = []
    for name, expected in CHECKS.items():
        path = source_dir / (name + '.txt')
        assert sha(path) == records[name]['listingSha256'], name
        lines = {line.split(' ; ')[0] for line in path.read_text().splitlines()}
        for line in expected:
            assert line in lines, (name, line)
        assertions.append(dict(id='COMMON-RELOAD-' + name, assertions=len(expected),
                               codeSha256=records[name]['codeSha256'], listingSha256=sha(path)))
    result = dict(
        serverSha256=EXPECTED, readerSha256=current['scriptSha256'], checkerSha256=sha(Path(__file__)),
        currentReadSha256=sha(current_path), wholeArtifactHashVerified=True, method=__doc__,
        codeBytes=current['codeBytes'], metadataWindowBytes=current['tableSearch']['bytes'],
        virtualSlotAssertions=63, instructionAssertions=sum(x['assertions'] for x in assertions),
        weapons=list(current['classes']), evidence=assertions,
        conclusions={
            'classOwnership': 'All seven concrete classes bind ordinary gun post-frame, shared primary and magazine reload. AWP has no class-specific post-frame bypass.',
            'reloadGate': 'Explicit reload input first requires no active reload, then current primary readiness before reaching manual reload dispatch. A zero refill-quantity path may run its distinct helper first; the positive-capacity/reserve candidate does not use it.',
            'comparison': 'For finite normalized values, ready iff current (tick,fraction) >= next-primary (tick,fraction), including equality. Both pairs use native tick normalization; the current pair combines the weapon identity time-domain tick accessor and current global fractional tick. This is a scoped simulation/command clock, not wall/video time.',
            'heldRetry': 'A held reload bit directly satisfies the input predicate on each update. An early failed readiness check stores no pending reload in this path and does not consume the button. While still held, a later eligible update can reach Reload without a new edge.',
            'tapLimit': 'With neither held bit nor current transition predicate present, no explicit reload branch is taken. Press/release inside one native command can still satisfy transition masks; the producer/reset lifetime of those masks is not established here.',
            'primaryPriority': 'Active primary plus primary readiness selects primary before reload. Both dispatcher success and failure leave through the common tail. A semiauto prior-shot rejection therefore still prevents reload during the same held-primary update.',
            'secondaryPriority': 'If primary did not win, each native secondary/alternate input is tested with its own secondary deadline. An eligible held or transition input takes priority over R regardless of dispatch result. A secondary input that is not ready falls through and does not independently bar R.',
            'awpRescope': 'The ordinary wrapper handles eligible automatic rescope before the shared dispatcher and then reaches that dispatcher. This is not an exemption from reload readiness.',
            'burstOrder': 'With a positive pending-burst count, enabled burst capability and primary readiness, the wrapper invokes the next primary burst shot before shared input dispatch. The continuation decrements the count, clearing remaining work if the shot counter did not advance. Shared reload readiness is sampled afterward.',
            'reloadSuccess': 'Magazine reload calls the base reload entry, which calls the bound reload-start virtual. Reload-start requires an owner and nonzero refill quantity before entering reload action. Admission alone does not guarantee success.',
        },
        implementationBoundary={
            'ready': 'The ordinary positive-ammo/reserve, same-weapon explicit reload-after-shot gate is justified for these seven common weapons. Retry only while the physical reload input remains active and only after higher-priority eligible attacks/burst continuation are accounted for.',
            'minimalPrioritySafety': 'Primary active at readiness blocks the retry even if it cannot emit a semiauto shot. Eligible secondary blocks retry; unready secondary does not. Pending burst must not be cancelled by admitting reload before its due continuation.',
            'playerDeploy': 'This proof binds the weapon next-primary gate, not all caller/player admission and not deploy deadline producers. Do not add or claim a new independent equip/player-next-attack rule from this result.',
            'preserve': 'Automatic reload, reload playback/silent clock, ammo insertion, invalid reserves/full magazine, and excluded weapons are outside this correction.',
        },
        unknown=[
            'Native transition-mask production/reset for released taps, especially press and release within one command.',
            'Complete upstream player/deploy admission and next-primary setters for every special state.',
            'Full pending-burst fire/deadline arithmetic and runtime burst/reload input capture; this proof establishes call order only.',
            'No new physical-input, command-latency or live gameplay capture was performed.',
        ],
        limits=['No native code emulation; instruction assertions check retained current-byte listings.',
                'The metadata search is restricted to one 192 KiB weapon neighborhood; no inference outside it.',
                'Seven concrete classes and their selected slots are bound, not all engine entry points or virtuals.'])
    target = args.out or source_dir / 'findings.json'
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, indent=2) + '\n')
    if args.portable_report:
        portable = {key: result[key] for key in (
            'serverSha256', 'readerSha256', 'checkerSha256', 'currentReadSha256',
            'wholeArtifactHashVerified', 'codeBytes', 'metadataWindowBytes',
            'virtualSlotAssertions', 'instructionAssertions', 'weapons', 'evidence',
            'conclusions', 'implementationBoundary', 'unknown', 'limits')}
        portable['method'] = 'Bounded current-server static instruction and concrete RTTI/virtual binding proof; no native execution.'
        portable['reproduction'] = [
            'systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-common-reload-native.py',
            'systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-common-reload-proof.py --portable-report docs/evidence/reaudit-common-reload-native.json',
        ]
        args.portable_report.parent.mkdir(parents=True, exist_ok=True)
        args.portable_report.write_text(json.dumps(portable, indent=2) + '\n')
    print(json.dumps(dict(output=str(target), instructionAssertions=result['instructionAssertions'],
                          virtualSlotAssertions=63, codeBytes=result['codeBytes'], weapons=result['weapons'])))


if __name__ == '__main__':
    main()
