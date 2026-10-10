"""Check retained byte-bound common-primary evidence and derive supplied-state cases.

No native binary is opened and no native code executes. The cases below are
static-derived implications of the checked branches, not observed gameplay or
an assertion that a physical mouse release cleared all native transition masks.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--root', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
ROOT = a.root.resolve()
HERE = a.output.resolve()
TOOLS = Path(__file__).resolve().parent
assert not (HERE / 'proof.json').exists(), 'Refusing to overwrite evidence'
EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


sources = [
    (ROOT / 'native-audit/reports/reaudit-common-reload-portable', 'current-read.json', 'codeRanges'),
    (HERE / 'current-reset', 'current-read.json', 'ranges'),
]
checks = {
    'common-input-dispatch': [
        '14b3ff9: call 0x16412f0', '14b4005: call 0x1641710',
        '14b400c: jne 0x14b4128', '14b412e: call 0x14b0360',
        '14b4136: jne 0x14b406f', '14b4149: jmp 0x14b406f',
        '14b4230: movabs rsi, 0x400000801', '14b423d: call 0x16412f0',
        '14b4244: jne 0x14b406f', '14b4250: call 0x14af980'],
    'primary-dispatch': [
        '14b03eb: mov edx, dword ptr [r12 + 0x17b8]',
        '14b03f5: jg 0x14b0678', '14b03fb: cmp byte ptr [r12 + 0x17d0], 0',
        '14b0404: jne 0x14b06c0', '14b05f8: call qword ptr [rax + 0xd30]',
        '14b06c0: xor r12d, r12d', '14b0682: mov rdx, qword ptr [rax + 0xbd8]',
        '14b0689: cmp rdx, rcx', '14b0692: mov rax, qword ptr [rax + 0xbd0]',
        '14b06b0: movzx eax, byte ptr [rax + 0x72d]',
        '14b06b7: test al, al', '14b06b9: jne 0x14b0750',
        '14b06bf: nop ', '14b076a: movzx eax, byte ptr [rbx + 0x1274]',
        '14b0771: test al, al', '14b0773: jne 0x14b06c0'],
    'primary-ready': [
        '1641730: call 0x22b49a0', '164174a: call 0x17fd290',
        '1641752: setle dl', '1641798: mov edx, 1'],
    'input-active': [
        '1641374: and rdx, qword ptr [rdi + 0x58]', '1641378: mov eax, 1',
        '164137d: je 0x1641390', '1641398: jmp 0x17b85e0'],
    'input-transition-wrapper': ['17b85e0: add rdi, 0x50', '17b85e4: jmp 0x1079c70'],
    'input-transition-predicate': [
        '1079c7c: and rdx, qword ptr [rdi + 0x10]',
        '1079c80: mov rax, qword ptr [rdi + 0x18]',
        '1079c84: je 0x1079c8a', '1079c86: or rax, qword ptr [rdi + 8]',
        '1079c8a: test rax, rsi', '1079c8d: setne al'],
    'idle-counter-reset': [
        '14af990: mov rbx, rsi', '14af9b5: mov edi, dword ptr [rbx + 0x17b8]',
        '14af9bd: jne 0x14afa60', '14afae2: mov dword ptr [rax], 0x17b8',
        '14afb86: mov dword ptr [rbx + 0x17b8], 0', '14afb90: jmp 0x14af9c3',
        '14af9c6: call 0x1641710', '14af9cd: je 0x14afa28',
        '14afcbe: mov byte ptr [rbx + 0x17d0], 0', '14afcc5: jmp 0x14af9b5'],
    'full-auto-accessor': ['1444267: movzx eax, byte ptr [rax + 0x72d]', '144426e: ret '],
    'full-auto-wrapper': [
        '1446d85: movzx eax, byte ptr [rax + 0x72d]', '1446d8e: je 0x1446db0',
        '1446da6: movzx eax, byte ptr [rdi + 0x1274]', '1446dad: xor eax, 1',
        '1446db1: ret '],
}
records = {}
provenance = []
for directory, filename, key in sources:
    path = directory / filename
    report = json.loads(path.read_text())
    assert report['serverSha256'] == EXPECTED and report['wholeArtifactHashVerified']
    assert len(report['classes']) == 7
    provenance.append({'report': str(path.relative_to(ROOT)), 'sha256': sha(path),
                       'serverSha256': report['serverSha256']})
    for row in report[key]:
        if row['name'] not in checks:
            continue
        path = directory / (row['name'] + '.txt')
        assert sha(path) == row['listingSha256'], row['name']
        lines = {line.split(' ; ')[0] for line in path.read_text().splitlines()}
        for expected in checks[row['name']]:
            assert expected in lines, (row['name'], expected)
        records[row['name']] = {'name': row['name'], 'codeSha256': row['codeSha256'],
            'listingSha256': sha(path), 'assertions': len(checks[row['name']])}
assert set(records) == set(checks)
new = json.loads((HERE / 'current-reset/current-read.json').read_text())
assert new['readerSha256'] == sha(TOOLS / 'read-reset.py')
old = json.loads((sources[0][0] / sources[0][1]).read_text())
assert new['priorReadSha256'] == sha(sources[0][0] / sources[0][1])
assert old['scriptSha256'] == sha(ROOT / 'cs2spraylab/tools/reaudit-common-reload-native.py')
metadata_path = ROOT / 'native-audit/reports/awp-clocks-next/metadata-read.json'
metadata = json.loads(metadata_path.read_text())
assert metadata['serverSha256'] == EXPECTED and metadata['wholeArtifactHashVerified']
assert metadata['readerSha256'] == sha(metadata_path.with_name('read-metadata.py'))
provenance.append({'report': str(metadata_path.relative_to(ROOT)), 'sha256': sha(metadata_path),
                   'serverSha256': metadata['serverSha256']})
field = next(x for x in metadata['schemaFields'] if x['field'] == 'm_bIsFullAuto')
assert field['offset'] == '0x72d'

# Supplied single-bit native state; do not label the unnamed mask as a DOM edge.
mask_cases = []
for held, transition_a, transition_b in itertools.product([False, True], repeat=3):
    predicate = held or (transition_b or (held if transition_a else False))
    assert predicate == (held or transition_b)
    mask_cases.append(dict(primaryStateBit=held, transitionSelectorBit=transition_a,
                           transitionResultBit=transition_b, active=predicate))

# Ordinary loaded same-weapon input, no secondary/reload/special branches.
# "admitted" means reaches primary virtual, not guaranteed successful shot.
cases = []
for active, ready, auto, counter_positive in itertools.product([False, True], repeat=4):
    chosen = active and ready
    admitted = chosen and (auto or not counter_positive)
    idle_reset = not active
    cases.append(dict(active=active, ready=ready, fullAuto=auto,
                      counterPositive=counter_positive, primaryChosen=chosen,
                      primaryVirtualAdmitted=admitted, idleCounterCleared=idle_reset))
assert len(mask_cases) == 8 and len(cases) == 16
result = {
    'method': __doc__, 'serverSha256': EXPECTED,
    'readerSha256': sha(TOOLS / 'read-reset.py'), 'checkerSha256': sha(Path(__file__)),
    'sourceReports': provenance,
    'fullAutoFieldDescriptorSha256': field['descriptorSha256'],
    'instructionAssertions': sum(x['assertions'] for x in records.values()),
    'newVirtualSlotAssertions': new['virtualSlotAssertions'], 'newReadBytes': new['bytesRead'],
    'weapons': list(new['classes']), 'evidence': list(records.values()),
    'rules': {
        'readyGate': 'In the bound ordinary shared dispatcher, active primary is admitted only when its primary deadline is ready, including equality. A failed readiness check does not call primary dispatch or its consume path.',
        'heldRetry': 'A primary-state bit still set on a later invocation again satisfies active input. If the deadline is then ready and the ordinary primary/player/ammo gates pass, it reaches primary dispatch without requiring a new edge.',
        'releasedInput': 'If both the primary-state bit and the fallback transition-result bit are absent at the later invocation, primary is inactive and is not dispatched. This is supplied native state, not proof that a physical release produced it.',
        'semiautoLatch': 'A positive retained player shot counter blocks another ordinary fullAuto=false primary shot. The ready active primary branch still owns arbitration when this rejection occurs.',
        'idleReset': 'When ordinary dispatch reaches idle with no selected primary/secondary attack input, it clears the same player counter before testing primary readiness for automatic reload. Thus that reset does not wait for firing cooldown to expire.',
        'physicalBoundary': 'A released tap may still satisfy a retained native transition bit. These reads do not prove the producer/reset lifetime, command aggregation, or the next invocation time, so they do not establish an exact physical click buffer window.',
    },
    'maskCases': mask_cases, 'ordinaryCases': cases,
    'implementationConclusion': 'No new unconditional physical-input timing fix is justified. Existing release-before-readiness behavior matches the supplied inactive-native-input branch; held retry matches the supplied active branch. Preserve source behavior pending observed command masks and caller timing.',
    'smallestRemainingEvidence': 'For one ordinary common pistol and one rifle, pair a near-deadline press/release with the active predicate masks, selected command invocation time and shot result. Especially distinguish press/release in one command from separate commands; do not add an arbitrary buffer constant.',
    'limits': [
        'Static-derived cases; no native code execution or live gameplay observations.',
        'No proof of physical input-to-command aggregation, producer/reset mask lifetimes or wall-clock latency.',
        'The counter is tied by matching native reads/writes, not a new field-name schema export.',
        'Idle reset is conditional on reaching idle; other active action buttons can take earlier branches.',
        'Generic full-auto/semiauto rules are conditional on compiled weapon data and exclude pending burst continuation.',
        'No claim that all weapon/deploy/player/ammo gates or full scheduling semantics are covered.',
    ],
}
(HERE / 'proof.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'instructionAssertions': result['instructionAssertions'],
                  'newVirtualSlotAssertions': result['newVirtualSlotAssertions'],
                  'newReadBytes': result['newReadBytes'], 'maskCases': len(mask_cases),
                  'ordinaryCases': len(cases), 'status': 'static-derived boundary only'}))
