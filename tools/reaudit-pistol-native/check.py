"""Check bounded pistol evidence and write new sanitized static proofs."""
import argparse
import hashlib
import itertools
import json
import math
import struct
from pathlib import Path

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--input', type=Path, required=True, help='Completed raw reader output')
parser.add_argument('--output', type=Path, required=True, help='New sanitized proof directory; must not exist')
args = parser.parse_args()
ROOT, RAW, OUT = args.root.resolve(), args.input.resolve(), args.output.resolve()
if OUT.exists():
    raise SystemExit('Refusing to overwrite an existing proof directory')

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

config = json.loads((HERE / 'source-manifest.json').read_text())
report = json.loads((RAW / 'read.json').read_text())
assert report['wholeArtifactHashesVerified']
assert report['readerSha256'] == sha(HERE / 'read.py')
assert report['sourceManifestSha256'] == sha(HERE / 'source-manifest.json')
assert report['artifactHashes'] == {side: r['sha256'] for side, r in config['artifacts'].items()}
assert report['prerequisites'] == config['prerequisites']
for row in config['prerequisites']:
    assert sha(ROOT / row['path']) == row['sha256'], row['path']

evidence = {}
assert {r['name'] for r in report['ranges']} == {r['name'] for r in config['ranges']}
for row in config['ranges']:
    retained = next(r for r in report['ranges'] if r['name'] == row['name'])
    assert retained['codeSha256'] == row['sha256'] and retained['bytes'] == row['bytes']
    listing = RAW / (row['name'] + '.txt')
    assert sha(listing) == retained['listingSha256']
    lines = set(listing.read_text().splitlines())
    for expected in row['checks']:
        assert expected in lines, (row['name'], expected)
    evidence[row['name']] = dict(source=row['name'], codeSha256=row['sha256'], instructionAssertions=len(row['checks']))

for row in config['data']:
    raw = RAW / (row['name'] + '.bin')
    assert raw.stat().st_size == row['bytes'] and sha(raw) == row['sha256']
assert struct.unpack('<i', (RAW / 'selector-global-file-value.bin').read_bytes())[0] == -1
client_table = struct.unpack('<20Q', (RAW / 'client-base-table.bin').read_bytes())
assert client_table[10] == 0x10f9a80 and client_table[16] == 0x10f5610
descriptor_table = struct.unpack('<13Q', (RAW / 'client-descriptor-table.bin').read_bytes())
assert descriptor_table[0] >> 32 == 986 and descriptor_table[1] == 0xc32fc0
assert descriptor_table[5] >> 32 == 5 and descriptor_table[9] == 0x4788ac0
assert struct.unpack('<Q', (RAW / 'server-base-parser-slot.bin').read_bytes())[0] == 0x10fdbb0
for weapon, binding in config['classes'].items():
    actual = report['classes'][weapon]
    assert set(actual) == set(binding['slots'])
    for slot, target in binding['slots'].items():
        assert actual[slot]['target'] == target
        assert actual[slot]['sha256'] == hashlib.sha256(struct.pack('<Q', int(target, 16))).hexdigest()
assert report['virtualSlotAssertions'] == 42 and report['bytesRead'] == 16830

assert sha(RAW / 'descriptor.json') == report['descriptorSha256']
descriptor = json.loads((RAW / 'descriptor.json').read_text())
assert descriptor['file'] == 'usercmd.proto'
assert list(descriptor['messages'])[3] == 'CBaseUserCmdPB'
assert (0x4788af0 - descriptor_table[9]) // 16 == 3
field = next(f for f in descriptor['messages']['CBaseUserCmdPB'] if f['number'] == 10)
assert field == dict(name='random_seed', number=10, type=5, label=1, default='', type_name='')
assert sha(RAW / 'weapon-data.json') == report['weaponDataSha256']
data = json.loads((RAW / 'weapon-data.json').read_text())
assert data['decodedSha256'] == '46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b'
assert data['compiledSha256'] == '5ca094238e180376646a5cd69250c091ae5a9d937a3446c188ee5117fb6da28b'
for name in ['deagle', 'glock', 'usp']:
    assert data['weapons'][name]['fullAuto'] is False
    assert data['weapons'][name]['unzoomsAfterShot'] is False and data['weapons'][name]['zoomLevels'] == 0
assert data['weapons']['awp']['unzoomsAfterShot'] is True and data['weapons']['awp']['zoomLevels'] == 2

selector_sources = ['recoil-selector', 'recoil-lookup', 'seed-setter-one', 'seed-setter-two', 'seed-command-caller',
                    'gun-primary', 'gun-fire', 'full-auto-accessor', 'full-auto-wrapper']
field_sources = ['base-command-factory', 'base-command-parser', 'base-command-descriptor-method', 'base-command-descriptor-getter',
                 'server-base-command-factory', 'server-base-command-parser', 'client-outer-parser', 'server-outer-parser',
                 'seed-command-caller', 'seed-setter-one', 'seed-setter-two']
shared = dict(method='Exact-hash static native byte inspection and text assertions. Derived cases are not executed native commands.',
              artifactHashes=report['artifactHashes'], readerSha256=report['readerSha256'], checkerSha256=sha(Path(__file__)),
              sourceManifestSha256=report['sourceManifestSha256'], readManifestSha256=sha(RAW / 'read.json'),
              selectedBytesInCombinedRead=report['bytesRead'], wholeArtifactHashesVerified=True,
              prerequisites=config['prerequisites'], originalEvidence=config['originalEvidence'])
cases = []
for full_auto, burst in itertools.product([False, True], repeat=2):
    for floating in [0.0, 1.99, 63.5, 64.25]:
        for seed in [-1, 0, 25, 56, 70, 127]:
            sequential = full_auto and not burst
            cases.append(dict(fullAuto=full_auto, burstEnabled=burst, floatingIndex=floating, suppliedSeed=seed,
                              source='floating' if sequential else 'command-seed',
                              tableIndex=(math.trunc(floating) if sequential else seed) & 63))

selector = dict(**shared, evidenceId='AUDIT-PISTOL-SELECTOR-01',
                instructionAssertions=sum(evidence[n]['instructionAssertions'] for n in selector_sources),
                codeEvidence=[evidence[n] for n in selector_sources], classSlotAssertions=42,
                compiledWeaponDataSha256=data['compiledSha256'], decodedWeaponDataSha256=data['decodedSha256'],
                weapons=data['weapons'], cases=cases, caseCount=len(cases),
                rules=[dict(id='PS01', rule='The common full-auto/non-burst predicate selects the truncated floating recoil index. Otherwise the table selector comes from the external command-seed global.'),
                       dict(id='PS02', rule='The table lookup masks the chosen integer to six bits, selects the supplied mode block and returns its stored angle and magnitude.'),
                       dict(id='PS03', rule='Recoil selection precedes the floating recoil-index increment. The floating index remains independent accuracy/recovery state.'),
                       dict(id='PS04', rule='Deagle, Glock and USP-S share the common path and bypass the scoped magnitude blend. AWP has the separate automatic-unzoom/multiple-zoom-level magnitude path.'),
                       dict(id='PS05', rule='The incoming command integer is written to the recoil-selector global before an optional custom-seed branch. That branch changes only a different global.')],
                limits=['No default trainer seed rule or probability distribution is established.',
                        'A supplied selector can validate table choice without reconstructing native command generation.',
                        'Inverse replay table indices inferred from observed recoil impulses are not recorded command seeds.',
                        'This static current-build proof does not establish which binary executed a historical demo.',
                        'The scoped blend is identified but is not generalized into the ordinary pistol-mode implementation.'])
seed_field = dict(**shared, evidenceId='AUDIT-PISTOL-SEED-FIELD-01',
                  instructionAssertions=sum(evidence[n]['instructionAssertions'] for n in field_sources),
                  codeEvidence=[evidence[n] for n in field_sources],
                  descriptorSha256=next(r['sha256'] for r in config['data'] if r['name'] == 'usercmd-descriptor'),
                  field=dict(message='CBaseUserCmdPB', name='random_seed', number=10, type='int32', optional=True),
                  rules=[dict(id='PF01', rule='The client CS game command base field allocates the exact base-message class whose parser and embedded descriptor identify random_seed as tag 10.'),
                         dict(id='PF02', rule='The independently bound server base-message parser stores tag 10 in the exact member consumed by the server recoil-selector seed caller.'),
                         dict(id='PF03', rule='This closes the field-name boundary only; the upstream client producer, generating algorithm, cadence and distribution remain unproved.')],
                  limits=['No game, native runtime, code discovery scan, RNG execution or seed producer is reconstructed.',
                          'An RNG import name is not evidence that this field is produced by that RNG.',
                          'No authored default gameplay seed follows from identifying this field.',
                          'Inverse replay indices remain inferred table choices, not observed random_seed values.'])
OUT.mkdir(parents=True, exist_ok=False)
for filename, doc in [('reaudit-pistol-selector-native.json', selector), ('reaudit-pistol-seed-field-native.json', seed_field)]:
    (OUT / filename).write_text(json.dumps(doc, indent=2) + '\n')
print(json.dumps(dict(selectorAssertions=selector['instructionAssertions'], seedFieldAssertions=seed_field['instructionAssertions'],
                      classSlotAssertions=42, staticDerivedCases=len(cases), generatorProved=False)))
