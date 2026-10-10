"""Validate retained bounded current-byte AWP evidence and emit address-free findings.

Static instruction assertions, not a native execution test. Each current read
verified the whole server identity; this checker verifies reader/listing hashes.
"""
import hashlib, json
from pathlib import Path
import argparse
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True, help='Workspace root; shared interface with the readers')
parser.add_argument('--output', type=Path, required=True, help='Evidence directory produced by the four readers')
args = parser.parse_args()

TOOLS = Path(__file__).resolve().parent
HERE = args.output.resolve()
assert not (HERE / 'portable-proof.json').exists(), 'Refusing to overwrite evidence'
EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
READERS = [('current-read.json', 'read-current.py'), ('next-read.json', 'read-next.py'), ('metadata-read.json', 'read-metadata.py')]
CHECKS = {
 'gun-primary': [
  '14b2fc2: movss xmm0, dword ptr [rdx + 0x738]',
  '14b301e: xor edx, edx', '14b3023: call 0x14b22d0',
  '14b3028: test al, al', '14b302a: je 0x14b305c',
  '14b304e: mov esi, dword ptr [rbx + 0x1548]', '14b3056: jg 0x14b3100',
  '14b311e: movzx eax, byte ptr [rax + 0x7f0]', '14b3127: je 0x14b305c',
  '14b316a: call 0x9fc500', '14b3171: jne 0x14b3278',
  '14b3197: mov dword ptr [rbx + 0x1548], 0',
  '14b31ec: call 0x1543eb0', '14b3215: mov dword ptr [rbx + 0x1248], 0',
  '14b329e: mov byte ptr [r12 + 0x179d], 1', '14b32c7: mov byte ptr [r12 + 0x179c], 0'],
 'gun-fire-entry': ['14b22f2: mov dword ptr [rbp - 0x114], edx',
  '14b240b: mov edx, dword ptr [rbp - 0x114]', '14b2426: call 0x14ac0a0'],
 'attack-clock-compute': [
  '14ac0c9: call 0x17fd290', '14ac0d7: mov qword ptr [rbp - 0x80], rax',
  '14ac0df: call 0x1496e60', '14ac11b: cmp byte ptr [r12 + 0x38], 0',
  '14ac121: jne 0x14ac231', '14ac132: mov esi, 1', '14ac137: call 0x1653800',
  '14ac147: mov esi, 1', '14ac14c: call 0x1653ae0',
  '14ac234: call 0x16416b0', '14ac239: mov r15d, dword ptr [rbp - 0x80]',
  '14ac242: cmp eax, r15d', '14ac245: je 0x14ac448', '14ac24b: jge 0x14ac2f6',
  '14ac2dc: mov dword ptr [rbx + 0x1190], r15d',
  '14ac2f9: call 0x16416e0', '14ac307: cmp eax, r15d', '14ac30a: je 0x14ac470',
  '14ac310: jge 0x14ac127', '14ac3a1: mov dword ptr [rbx + 0x1198], r15d',
  '14ac435: movss dword ptr [rbx + 0x119c], xmm1',
  '14ac450: comiss xmm0, xmm1', '14ac45f: ja 0x14ac2f6',
  '14ac478: comiss xmm0, xmm1', '14ac481: je 0x14ac127', '14ac487: ja 0x14ac127'],
 'attack-context': [
  '1496e9d: mov byte ptr [r15 + 0x38], 0',
  '1496f3b: call 0x16416b0', '1496f52: call 0x22b7270',
  '1496f57: movss xmm0, dword ptr [r14 + 0x1390]', '1496f88: call 0x22b3c90',
  '1497001: je 0x1497d20', '1497d20: movsxd rax, dword ptr [rax + 0x4c]',
  '1497926: js 0x1497010', '1497936: jge 0x1497010',
  '1497b23: mov byte ptr [r15 + 0x38], 1', '1497b2c: jmp 0x14972ee',
  '14970b0: mov esi, dword ptr [rax + 0x3e0]',
  '14970cc: je 0x14977c0', '14970d2: jge 0x14977da',
  '1497109: jl 0x14973be', '14973ca: jge 0x1497880',
  '14978fc: jmp 0x14972ee',
  '1497116: call 0x17fd290', '1497165: cmp eax, ebx',
  '149717b: mov dword ptr [r15], ebx', '1497186: mov byte ptr [r15 + 0x38], 1',
  '149780c: mov qword ptr [r15], r12',
  '1497351: call 0x1785c30', '149736d: ret '],
 'context-time-seconds': ['1785c34: cvtsi2ss xmm0, dword ptr [rdi]',
  '1785c40: mulss xmm0, xmm1', '1785c44: mulss xmm1, dword ptr [rdi + 4]', '1785c49: addss xmm0, xmm1'],
 'primary-setter': ['1653840: cmp r12d, 1', '1653844: je 0x1653a30',
  '1653a30: movss xmm5, dword ptr [rbx + 0x1194]', '1653a38: mov r13d, dword ptr [rbx + 0x1190]',
  '16538ee: cmp byte ptr [rax + 0x4c6], 0'],
 'secondary-setter': ['1653b20: cmp r12d, 1', '1653b24: je 0x1653d10',
  '1653d10: movss xmm5, dword ptr [rbx + 0x119c]', '1653d18: mov r13d, dword ptr [rbx + 0x1198]',
  '1653cc3: cmp byte ptr [rax + 0x4c6], 0', '1653cca: je 0x1653bdb'],
 'ordinary-postframe': [
  '14b4534: call 0x1641710', '14b453b: jne 0x14b4560',
  '14b4560: cmp byte ptr [r12 + 0x179d], 0', '14b456b: mov edx, dword ptr [rbx + 0x1548]',
  '14b4573: jle 0x14b453d', '14b458f: mov eax, dword ptr [rbx + 0x11a0]',
  '14b4597: jne 0x14b45ad', '14b459f: call qword ptr [rax + 0xaa8]',
  '14b45a5: test al, 2', '14b45a7: je 0x14b4684',
  '14b45d4: mov dword ptr [rbx + 0x1248], 1',
  '14b462b: call 0x1543eb0', '14b4652: mov byte ptr [r12 + 0x179c], 1',
  '14b46aa: mov byte ptr [r12 + 0x179d], 0', '14b46b3: jmp 0x14b453d',
  '14b4558: jmp 0x14b3fd0'],
 'common-input-dispatch': ['14b3ff9: call 0x16412f0', '14b4005: call 0x1641710',
  '14b400c: jne 0x14b4128', '14b412e: call 0x14b0360',
  '14b4136: jne 0x14b406f', '14b4149: jmp 0x14b406f',
  '14b4034: call 0x16412f0', '14b4040: call 0x16417a0',
  '14b4047: jne 0x14b4188', '14b418e: call 0x14a9b70'],
 'primary-dispatch': ['14b03f5: jg 0x14b0678', '14b0404: jne 0x14b06c0',
  '14b05f8: call qword ptr [rax + 0xd30]', '14b062e: je 0x14b06c3'],
 'input-active': ['1641374: and rdx, qword ptr [rdi + 0x58]', '1641378: mov eax, 1', '164137d: je 0x1641390'],
 'secondary-dispatch': ['14bfd01: lea ebx, [rax + 1]', '14bfd0c: mov dword ptr [r15 + 0x1548], ebx',
  '14bfd92: call 0x14bf050', '14bfd97: jmp 0x14bfcb9', '14bfcc1: xor esi, esi', '14bfcc6: call 0x1653ae0'],
 'camera-fov-setter': ['15440dc: call 0x17d8f30', '15440e3: call 0x134e850', '15440e8: ucomiss xmm0, dword ptr [rbx + 0x180]'],
 'camera-fov-setter-tail': ['15443bc: movss dword ptr [rbx + 0x180], xmm0', '1544447: movss dword ptr [rbx + 0x184], xmm4'],
 'camera-time-domain': ['17d8f30: mov rax, qword ptr [rdi + 0x38]', '17d8f38: mov eax, dword ptr [rax + 0x38]'],
 'weapon-flags': ['162ba84: call 0x15841b0', '162ba8a: movzx eax, byte ptr [rax + 0x4c7]'],
 'vdata-source': ['15841c9: mov rax, qword ptr [rbx + 0x600]', '15841e1: cmove rax, rdx'],
 'cs-vdata-constructor': ['1499e9e: mov dword ptr [rbx + 0x4c4], 1'],
 'base-vdata-default-flags': ['17f6440: mov dword ptr [rbx + 0x4c4], 1'],
 'base-placement-default-flags': ['17f6653: mov dword ptr [rbx + 0x4c4], 1'],
}
records = {}; sources = []
for report_name, reader_name in READERS:
    report = json.loads((HERE / report_name).read_text())
    assert report['serverSha256'] == EXPECTED and report['wholeArtifactHashVerified']
    assert report['readerSha256'] == sha(TOOLS / reader_name)
    for record in report['ranges']:
        assert sha(HERE / (record['name'] + '.txt')) == record['listingSha256']
        records[record['name']] = record
    sources.append({'report': report_name, 'reportSha256': sha(HERE / report_name),
                    'reader': reader_name, 'readerSha256': report['readerSha256'], 'bytesRead': report['bytesRead']})
metadata = json.loads((HERE / 'metadata-read.json').read_text())
assert len(metadata['slots']) == 17
expected_slots = {'0xaa8': '0x162ba80', '0xb00': '0xacb2c0', '0xb90': '0x14bf9e0',
 '0xbd0': '0x1444260', '0xbd8': '0x1446d60', '0xbf0': '0x1444270', '0xc68': '0x133daa0',
 '0xc70': '0x14444e0', '0xcb0': '0x1483b10', '0xcd0': '0x1483fc0',
 '0xd08': '0x1487f60', '0xd30': '0x14b2ef0', '0xd38': '0x14bfa70', '0xd40': '0x14b4510',
 '0xd60': '0x14445d0', '0xd68': '0x1483c20'}
for slot, target in expected_slots.items(): assert metadata['slots'][slot] == target
checked = []
for name, checks in CHECKS.items():
    lines = (HERE / (name + '.txt')).read_text().splitlines()
    plain = {line.split(' ; ')[0] for line in lines}
    for line in checks: assert line in plain, (name, line)
    checked.append({'name': name, 'assertions': len(checks), 'codeSha256': records[name]['codeSha256'],
                    'listingSha256': records[name]['listingSha256']})
for name, needle in [('gun-primary', "str='cl_sniper_auto_rezoom'"),
 ('gun-primary', 'f32=0.05000000074505806'), ('ordinary-postframe', 'f32=0.10000000149011612'),
 ('secondary-dispatch', 'f32=0.30000001192092896'), ('context-time-seconds', 'f32=0.015625')]:
    assert needle in (HERE / (name + '.txt')).read_text()
data = json.loads((HERE / 'current-awp-data.json').read_text())
assert data['scriptSha256'] == sha(TOOLS / 'read-data.mjs')
assert data['awp']['cycle'] == 1.455 and data['awp']['unzoomsAfterShot']
assert all(x['linked'] is None and x['flags'] is None for x in data['inheritedDefaults'])
report = {
 'serverSha256': EXPECTED, 'method': __doc__, 'checkerSha256': sha(Path(__file__)),
 'sources': sources, 'dataProofSha256': sha(HERE / 'current-awp-data.json'),
 'class': 'CWeaponAWP', 'virtualBindingAssertions': len(expected_slots),
 'schemaFields': [dict(field=f['field'], descriptorSha256=f['descriptorSha256']) for f in metadata['schemaFields']],
 'instructionAssertions': sum(len(c) for c in CHECKS.values()), 'literalAssertions': 5,
 'codeRangesRetained': len(records), 'boundedBytesRead': sum(s['bytesRead'] for s in sources), 'evidence': checked,
 'rules': {
  'clockDefinition': 'Let P,S be existing primary/secondary normalized tick-fraction clocks, C the current command clock captured before context construction, D the authored cycle, R the constructed rebase flag. For unlinked AWP clocks: R=0 gives P+=D,S+=D; R=1 gives P=max(P,C)+D,S=max(S,C)+D. Float32 tick normalization remains native.',
  'context': 'A selected explicit command attack record writes R=1. Historical context paths retain initial R=0. The fallback that selects current command context writes R=1; a retained candidate can leave it0. The exact command/history producer state is not measured by trainer probes.',
  'futureSecondary': 'Both branches preserve a secondary clock already ahead of C before adding D. A recent manual zoom can therefore leave secondary readiness later than primary.',
  'scopeAfterShot': 'Only a successful shot with a positive saved zoom level and UnzoomsAfterShot enabled enters the automatic unzoom path. With auto-rezoom enabled it sets the pending flag and retains the level; otherwise it clears the level. It requests the default FOV with a 0.05-second transition at current camera-domain time.',
  'rescopeGate': 'Ordinary postframe first tests primary readiness. If pending and saved zoom positive, normal AWP requires nonzero ammo (flags default0, no override). It restores the saved level with a 0.1-second FOV transition when ammo exists, then clears pending. With empty ammo it clears pending without rescoping. No secondary-ready check or independent shotTime+cycle rescope timer is present in this path.',
  'order': 'The auto-rescope path precedes shared primary/secondary input dispatch. Eligible held primary wins even on semiauto rejection; otherwise eligible held secondary uses its own secondary deadline and can advance the saved zoom level after auto-rescope in the same command.',
  'fovClock': 'The camera setter stores current seconds in the camera owner time domain as the transition start. Unzoom starts when the successful-shot path calls it; rescope starts when ready postframe calls it. Neither path backdates that transition to an earlier scheduled shot/readiness timestamp.',
 },
 'invariant': {
  'preservation': 'Given S>=P initially, an ordinary loaded shoot/zoom-only sequence preserves it. Same D additions and max(C,clock) preserve ordering. Accepted zoom requires C>=S and writes S=C+0.3, which remains >=P. Automatic unzoom/rescope writes neither clock.',
  'boundary': 'The audit does not establish S>=P after every deploy/reload/holster/special state. With S<P and R=0, native increments S directly; max(S,scheduled=P)+D would differ. No naturally reachable counterexample within the stated invariant was found.',
 },
 'derivedExamplesNotRuntime': [
  {'current': 2.46875, 'primaryBefore': 2.458, 'secondaryBefore': 2.458, 'rebase': False, 'primaryAfter': 3.913, 'secondaryAfter': 3.913},
  {'current': 2.46875, 'primaryBefore': 2.458, 'secondaryBefore': 2.458, 'rebase': True, 'primaryAfter': 3.92375, 'secondaryAfter': 3.92375},
  {'current': 2.46875, 'primaryBefore': 2.458, 'secondaryBefore': 2.605, 'rebase': False, 'primaryAfter': 3.913, 'secondaryAfter': 4.06},
 ],
 'implementationBoundary': 'A bounded AWP change may integrate with the trainer existing shot scheduler and primary-ready gate; it must not claim to port native command/history context selection. Preserve future secondary clocks, use actual processing time for FOV transition start, and account for ammo at rescope. Do not generalize to other scoped weapons or upstream gates.',
 'unknown': ['Native runtime context flag for the specific queued trainer input sequence.',
  'Full native command/history production, input-mask lifetime and scheduling/subtick delivery.',
  'Global clock-order invariant through deploy/reload/holster and special flags/states.',
  'Client rendering/prediction of these transitions; no new client or game capture performed.',
  'Every float32 normalization boundary and dynamic auto-rezoom preference change.'],
}
(HERE / 'portable-proof.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'instructionAssertions': report['instructionAssertions'], 'literalAssertions': 5,
                  'virtualBindings': len(expected_slots), 'bytesRead': report['boundedBytesRead']}))
