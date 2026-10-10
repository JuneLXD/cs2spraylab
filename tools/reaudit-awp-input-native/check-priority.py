"""Check hash-bound retained AWP dispatch evidence; emit named portable findings.

This reads local proof files only. It does not execute native code or infer a
physical button lifetime from the weapon input predicate.
"""
import argparse, hashlib, json
from pathlib import Path

EXPECTED = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--gaps', type=Path, help='Optional fresh read-gaps.py output directory')
parser.add_argument('--consume', type=Path, help='Optional fresh read-consume-tail.py output directory')
args = parser.parse_args()
root, output = args.root.resolve(), args.output.resolve()
assert not output.exists(), 'Use a new output directory'
source = root / 'native-audit/reports'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
sources, records, listings = [], {}, {}

def retain(directory, report_name, reader_name, selected):
    folder = source / directory
    report = json.loads((folder / report_name).read_text())
    assert report['serverSha256'] == EXPECTED and report['wholeArtifactHashVerified']
    assert report['readerSha256'] == sha(folder / reader_name)
    for record in report['ranges']:
        name = record['name']
        if name not in selected: continue
        listing = folder / (name + '.txt')
        assert sha(listing) == record['listingSha256']
        records[name] = record
        listings[name] = listing.read_text()
    assert set(selected) <= records.keys()
    sources.append({'report': str((folder / report_name).relative_to(root)), 'reportSha256': sha(folder / report_name),
                    'reader': str((folder / reader_name).relative_to(root)), 'readerSha256': report['readerSha256']})
    return report

retain('awp-clocks-next', 'current-read.json', 'read-current.py', [
    'common-input-dispatch', 'primary-dispatch', 'ordinary-postframe', 'input-active',
    'primary-ready', 'secondary-ready', 'secondary-dispatch'])
metadata = retain('awp-clocks-next', 'metadata-read.json', 'read-metadata.py', [])
assert metadata['slots']['0xd30'] == '0x14b2ef0'
assert metadata['slots']['0xd38'] == '0x14bfa70'
assert metadata['slots']['0xd40'] == '0x14b4510'
assert metadata['slots']['0xbd0'] == '0x1444260'
assert metadata['slots']['0xbd8'] == '0x1446d60'
retain('common-burst-next', 'secondary-wrapper-read.json', 'read-secondary-wrapper.py', ['secondary-input-wrapper'])
retain('common-burst-next', 'secondary-thunk-read.json', 'read-secondary-thunk.py', ['secondary-dispatch-thunk'])

gap_folder = args.gaps.resolve() if args.gaps else source / 'awp-input-next/current-gaps'
gap = json.loads((gap_folder / 'current-read.json').read_text())
assert gap['serverSha256'] == EXPECTED and gap['wholeArtifactHashVerified']
assert gap['readerSha256'] == sha(source / 'awp-input-next/read-gaps.py')
assert gap['preference']['string'] == 'cl_debounce_zoom'
assert gap['slots']['0xb70'] == '0x16225f0'
assert gap['slots']['0xac8'] == '0x148ca20'
for record in gap['ranges']:
    path = gap_folder / (record['name'] + '.txt')
    assert sha(path) == record['listingSha256']
    records[record['name']] = record
    listings[record['name']] = path.read_text()
sources.append({'report': str((gap_folder / 'current-read.json').relative_to(root)),
                'reportSha256': sha(gap_folder / 'current-read.json'), 'readerSha256': gap['readerSha256']})

tail_folder = args.consume.resolve() if args.consume else source / 'awp-input-next/consume-tail'
tail = json.loads((tail_folder / 'current-read.json').read_text())
assert tail['serverSha256'] == EXPECTED and tail['wholeArtifactHashVerified']
assert tail['readerSha256'] == sha(source / 'awp-input-next/read-consume-tail.py')
assert tail['listingSha256'] == sha(tail_folder / 'input-consume-body.txt')
records['input-consume-body'] = tail
listings['input-consume-body'] = (tail_folder / 'input-consume-body.txt').read_text()
sources.append({'report': str((tail_folder / 'current-read.json').relative_to(root)),
                'reportSha256': sha(tail_folder / 'current-read.json'), 'readerSha256': tail['readerSha256']})

data_path = source / 'awp-clocks-next/current-awp-data.json'
data = json.loads(data_path.read_text())
pass39 = json.loads((source / 'awp-clocks-next/portable-proof.json').read_text())
assert pass39['dataProofSha256'] == sha(data_path)
assert data['awp']['fullAuto'] is False and data['awp']['zoomLevels'] == 2
assert data['scriptSha256'] == sha(source / 'awp-clocks-next/read-data.mjs')
assert data['compiled']['sha256'] == '5ca094238e180376646a5cd69250c091ae5a9d937a3446c188ee5117fb6da28b'

CHECKS = {
 'common-input-dispatch': [
    '14b3fee: mov esi, 1', '14b3ff9: call 0x16412f0', '14b4000: je 0x14b4012',
    '14b4005: call 0x1641710', '14b400c: jne 0x14b4128',
    '14b402c: mov esi, 0x800', '14b4034: call 0x16412f0',
    '14b403b: je 0x14b404d', '14b4040: call 0x16417a0', '14b4047: jne 0x14b4188',
    '14b412e: call 0x14b0360', '14b4133: cmp eax, 1', '14b4136: jne 0x14b406f',
    '14b4144: call 0x1641460', '14b4149: jmp 0x14b406f',
    '14b418e: call 0x14a9b70', '14b4193: cmp eax, 1', '14b4196: jne 0x14b406f',
    '14b419c: mov esi, 0x800', '14b41a4: call 0x1641460', '14b41a9: jmp 0x14b406f'],
 'primary-dispatch': [
    '14b03eb: mov edx, dword ptr [r12 + 0x17b8]', '14b03f3: test edx, edx',
    '14b03f5: jg 0x14b0678', '14b0682: mov rdx, qword ptr [rax + 0xbd8]',
    '14b0689: cmp rdx, rcx', '14b068c: jne 0x14b0860',
    '14b0692: mov rax, qword ptr [rax + 0xbd0]', '14b06a0: cmp rax, rdx',
    '14b06a3: jne 0x14b0878', '14b06b0: movzx eax, byte ptr [rax + 0x72d]',
    '14b06b7: test al, al', '14b06b9: jne 0x14b0750',
    '14b06c0: xor r12d, r12d', '14b06c7: mov eax, r12d', '14b06d4: ret ',
    '14b05f8: call qword ptr [rax + 0xd30]'],
 'primary-ready': ['164174f: cmp r12d, eax', '1641752: setle dl',
    '1641775: comiss xmm2, xmm0', '1641798: mov edx, 1'],
 'secondary-ready': ['16417df: cmp r12d, eax', '16417e2: setle dl',
    '1641805: comiss xmm2, xmm0', '1641828: mov edx, 1'],
 'input-active': ['1641306: mov rax, qword ptr [rax + 0xb70]',
    '1641365: mov rdi, qword ptr [rax + 0xe30]',
    '1641374: and rdx, qword ptr [rdi + 0x58]', '1641378: mov eax, 1',
    '164137d: je 0x1641390', '1641398: jmp 0x17b85e0'],
 'ordinary-postframe': ['14b4534: call 0x1641710', '14b453b: jne 0x14b4560',
    '14b4560: cmp byte ptr [r12 + 0x179d], 0', '14b458f: mov eax, dword ptr [rbx + 0x11a0]',
    '14b462b: call 0x1543eb0', '14b46aa: mov byte ptr [r12 + 0x179d], 0',
    '14b46b3: jmp 0x14b453d', '14b4558: jmp 0x14b3fd0'],
 'secondary-input-wrapper': ['14a9b80: call qword ptr [rax + 0xd68]',
    '14a9b88: je 0x14a9cf1', '14a9cf8: jmp 0x14957f0'],
 'secondary-dispatch-thunk': ['1495815: call qword ptr [rax + 0xac8]',
    '149581d: je 0x1495950', '1495829: call qword ptr [rax + 0xd08]',
    '1495831: je 0x14958e0', '14958bc: lea rdx, [rip - 0xbc0ab2]',
    '14958c8: call r14', '14958ce: je 0x14958e0', '14958d3: call 0x9fc500',
    '14958d8: test eax, eax', '14958da: setg r12b', '14958e0: xor r12d, r12d',
    '1495930: call qword ptr [rdx + 0xd38]', '1495936: test r12b, r12b',
    '1495939: mov edx, 1', '149593f: cmovne eax, edx', '1495949: ret '],
 'secondary-dispatch': ['14bfb8e: xor eax, eax', '14bfb9a: ret ',
    '14bfd01: lea ebx, [rax + 1]', '14bfd0c: mov dword ptr [r15 + 0x1548], ebx',
    '14bfd32: cmp eax, ebx', '14bfd34: jge 0x14bfd40',
    '14bfd92: call 0x14bf050', '14bfd97: jmp 0x14bfcb9',
    '14bfcc6: call 0x1653ae0', '14bfccb: jmp 0x14bfb8a'],
 'awp-secondary-eligibility': ['148ca64: mov eax, dword ptr [rax + 0x7f4]',
    '148ca6c: jne 0x148cac7', '148cacb: mov eax, 1', '148cad1: ret '],
 'input-consume': ['16414e5: jmp 0x17c3050'],
 'input-consume-body': ['17c305d: call 0x17c1e10', '17c3062: or qword ptr [rbx + 0x198], r12', '17c306d: ret '],
}
checked = []
for name, expected in CHECKS.items():
    plain = {line.split(' ; ')[0] for line in listings[name].splitlines()}
    for instruction in expected: assert instruction in plain, (name, instruction)
    record = records[name]
    checked.append({'name': name, 'assertions': len(expected), 'codeSha256': record['codeSha256'], 'listingSha256': record['listingSha256']})

report = {
 'method': __doc__, 'serverSha256': EXPECTED, 'checkerSha256': sha(Path(__file__)),
 'sourceReports': sources, 'dataProofSha256': sha(data_path),
 'concreteClass': 'CWeaponAWP', 'concreteBindingAssertions': 7,
 'instructionAssertions': sum(len(v) for v in CHECKS.values()), 'evidence': checked,
 'newReadBytes': gap['bytesRead'] + tail['bytesRead'],
 'rules': {
  'arbitration': 'Given active primary input and a ready primary clock, the shared dispatcher selects primary before secondary. Both the primary-success and primary-rejection returns bypass the secondary branch.',
  'semiautoRejection': 'For the bound AWP fullAuto=false path, a positive retained shot counter rejects another primary shot. That rejection still owns primary dispatch for the command and does not permit secondary fallback.',
  'primaryNotReady': 'Active primary whose clock is not ready does not own that branch. In the ordinary command with no intervening special button, active secondary is checked against its own deadline.',
  'secondaryRetry': 'The dispatcher re-evaluates active secondary and its readiness on each invocation. Before readiness it does not enter the secondary thunk or its consume path. Once ready, it dispatches if primary does not own the command. This is conditional on the native input predicate remaining active, not a claim about a browser physical-held event.',
  'release': 'When the next invocation reports primary inactive, it can admit ready active secondary in that same invocation. No additional one-update delay is authored by this dispatcher.',
  'autoRescopeOrder': 'Ordinary postframe handles pending primary-ready rescope before this shared input arbitration, subject to the previously proved ammo/saved-level gates.',
  'zoomPreference': 'For a qualifying scope/controller path, the secondary thunk reads cl_debounce_zoom. A parsed positive value forces return1 after SecondaryAttack; common dispatch then invokes the input-consume path. Zero/nonpositive or missing preference leaves the SecondaryAttack return unchanged. The retained ordinary AWP zoom branch returns0.',
  'consumeObserved': 'The selected consume path calls another service helper and then ORs the button bit into a service mask. Immediate helper semantics and the producer/reset lifetime of this mask are outside the selected reads.',
 },
 'implementationBoundary': 'A priority-only AWP guard can require active primary plus primary readiness before refusing secondary. It must not use primary shot acceptance as the priority test, and must not block secondary merely because primary is held during cooldown. Keep existing engine zoom-repeat preference gating and cadence unchanged.',
 'limits': [
  'No game, native execution, client prediction, or runtime preference/default observation.',
  'Native input predicate combines service state and a transition fallback; producer/reset lifetimes are not established here.',
  'The full secondary-wrapper special-weapon branch and its current field-name schema are not newly proved; the ordinary scope path and preference result are stated conditionally.',
  'Other action buttons, player/equip/reload gates, empty-fire outcomes, and native command/subtick aggregation remain outside the derived arbitration cases.',
  'Separate equal-time browser DOM edges need not form one atomic native command; event order remains an explicit integration boundary.',
  'The native shot-counter lifetime is retained from prior evidence; this pass checks its dispatch read and semiauto branch, not all producers/resets.'
 ]
}
output.mkdir(parents=True)
(output / 'priority-proof.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'instructionAssertions': report['instructionAssertions'], 'newReadBytes': report['newReadBytes'], 'sources': len(sources)}))
