#!/usr/bin/env python3
"""Scoped AWP supplied-state ground replay; frozen ground package is unchanged."""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GROUND = ROOT.parent / 'reaudit-ground-friction-native'
STANCE = GROUND / 'stance_oracle.py'
STANCE_SHA = 'caba74a0ae3ffb4e32a3d3a5ba329f88aa5ae9a111e36ff4d44590c6e99c3584'
STATIC_SHA = '0674ee146cdc4c9b6a91a53e7aacf466ac5eec62ae7c194ac9c74e58aa01613f'
SCOPE_REPORT_SHA = '78bc6b31b20fd4461905f8f5f21c6fa166c31e474ccd17f06d58b3a5ed20595d'
SCOPE_LISTING_SHA = '03d60e21ee51ec602a1a75925fe750b7ed56fecf7962da269947eb42b487cbe0'
DATA_SHA = '473089f681a3296ec69de31b84dfd137ad3df42e110bd8833f18fbf282c27bfe'
WEAPON_DATA = 0x5013000


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


assert digest(STANCE) == STANCE_SHA
spec = importlib.util.spec_from_file_location('preserved_scoped_stance', STANCE)
stance = importlib.util.module_from_spec(spec)
spec.loader.exec_module(stance)
combined, v3, v2, v1, f32 = stance.combined, stance.v3, stance.v2, stance.v1, stance.f32
v1.SUPPLIED_DATA.extend([(combined.WEAPON + 0x600, 8, 'supplied-scoped-weapon-data-pointer'),
                         (WEAPON_DATA + 0x7f4, 4, 'supplied-weapon-zoom-level-count')])
assert sum(size for _, size in v1.CODE.values()) == 7192


def verify_scope_join():
    proof_path, report_path = ROOT / 'static-proof.json', ROOT / 'retained-scope-report.json'
    listing_path = ROOT / 'retained-secondary-dispatch.txt'
    data_path = ROOT.parents[1] / 'docs/evidence/reaudit-awp-data.json'
    for path, expected in [(proof_path, STATIC_SHA), (report_path, SCOPE_REPORT_SHA),
                           (listing_path, SCOPE_LISTING_SHA), (data_path, DATA_SHA)]:
        assert digest(path) == expected, path.name
    proof, report = json.loads(proof_path.read_text()), json.loads(report_path.read_text())
    data = json.loads(data_path.read_text())
    assert proof['status'] == 'passed' and proof['serverSha256'] == report['serverSha256'] == v1.SHA
    assert proof['getters']['retained-gun-current-zoom-getter'][0]['operands'] == 'eax, dword ptr [rdi + 0x1548]'
    assert report['slots']['0xd38'] == '0x14bfa70'
    bound = next(r for r in report['ranges'] if r['name'] == 'secondary-dispatch')
    assert bound['listingSha256'] == SCOPE_LISTING_SHA
    listing = listing_path.read_text()
    for line in ['14bfcdf: mov eax, dword ptr [r15 + 0x1548]',
                 '14bfd01: lea ebx, [rax + 1]',
                 '14bfd0c: mov dword ptr [r15 + 0x1548], ebx',
                 '14bfd2c: mov eax, dword ptr [rax + 0x7f4]',
                 '14bfd32: cmp eax, ebx', '14bfd92: call 0x14bf050']:
        assert line in listing, line
    assert any(r['name'] == 'm_nZoomLevels' and r['offset'] == '0x7f4' for r in proof['schemaRecords'])
    assert data['awp']['zoomLevels'] == 2
    return {'staticProofSha256': STATIC_SHA, 'retainedScopeReportSha256': SCOPE_REPORT_SHA,
            'retainedScopeListingSha256': SCOPE_LISTING_SHA, 'weaponDataProofSha256': DATA_SHA,
            'currentLevelAssociation': 'Actual AWP getter reads the same instance integer advanced by the bound secondary scope dispatch and compared to configured zoom count.',
            'configuredCountAssociation': 'Current-server named m_nZoomLevels field is read by the actual AWP standard data accessor.',
            'limits': 'Static association and explicit supplied getter returns; no live scope transition is invoked in this replay.'}


class Native(stance.Native):
    def __init__(self):
        self.zoom_level = 1
        self.zoom_levels = 2
        self.scoped_branches = {}
        super().__init__()
        self.wq(combined.WEAPON_TABLE + 0xc68, 0x133daa0)
        self.wq(combined.WEAPON + 0x600, WEAPON_DATA)
        self.u.mem_write(WEAPON_DATA + 0x7f4, v1.struct.pack('<i', 2))

    def configure(self, fixture):
        super().configure(fixture)
        self.zoom_level, self.zoom_levels = fixture['zoomLevel'], fixture['zoomLevels']
        assert self.zoom_level in (1, 2) and self.zoom_levels == 2 and self.weapon_base == 100
        self.u.mem_write(WEAPON_DATA + 0x7f4, v1.struct.pack('<i', self.zoom_levels))

    def hook(self, u, at, size, data):
        if at in (combined.SPEED_HOOK, combined.ZOOM_HOOK):
            assert u.reg_read(v1.UC_X86_REG_RDI) == combined.WEAPON
            if at == combined.SPEED_HOOK:
                role = 'supplied-mode-weapon-speed'
                assert self.weapon_base == 100
                self.xmm(v1.UC_X86_REG_XMM0, self.weapon_base)
            else:
                role = 'supplied-current-zoom-level'
                assert self.zoom_level in (1, 2)
                u.reg_write(v1.UC_X86_REG_RAX, self.zoom_level)
            self.calls[role] = self.calls.get(role, 0) + 1
            self.ret()
            return
        assert at != 0x158d488, 'Nonstandard count accessor must not execute'
        if at in (0x158d326, 0x158d450):
            role = 'standard-data-count-read' if at == 0x158d326 else 'retained-scoped-scale'
            key = f'zoom{self.zoom_level}:{role}'
            self.scoped_branches[key] = self.scoped_branches.get(key, 0) + 1
        super().hook(u, at, size, data)


def fixtures():
    out = []
    for zoom in (1, 2):
        for name, multiplier in [('stand', 1), ('walk', .52), ('crouch', .34)]:
            cap = f32(100 * multiplier)
            for maneuver in ('start', 'release', 'counter', 'diagonal'):
                moving = maneuver in ('release', 'counter')
                initial = v2.seed(cap if moving else 0, prior=(cap, 0) if moving else (0, 0))
                wish = {'start': (cap, 0), 'release': (0, 0), 'counter': (-cap, 0), 'diagonal': (cap, -cap)}[maneuver]
                out.append({'id': f'awp-zoom{zoom}-{name}-{maneuver}', 'kind': maneuver,
                            'stance': name, 'weaponSpeed': 100, 'suppliedSpeed': cap,
                            'suppliedProcessedCap': cap, 'zoomLevel': zoom, 'zoomLevels': 2,
                            'initialState': initial,
                            'commands': [v2.command(wish=wish, extra=(.5,)) for _ in range(16)],
                            'mxcsrProfiles': ['nearest-gradual']})
        for speed in (50, 52, 55):
            out.append({'id': f'awp-zoom{zoom}-walk-taper-input{speed}', 'kind': 'walking-taper-control',
                        'stance': 'walk', 'weaponSpeed': 100, 'suppliedSpeed': 52,
                        'suppliedProcessedCap': 52, 'zoomLevel': zoom, 'zoomLevels': 2,
                        'initialState': v2.seed(speed, prior=(52, 0)),
                        'commands': [v2.command(wish=(52, 0), extra=(.5,))],
                        'mxcsrProfiles': ['nearest-gradual']})
    for ident in ('awp-zoom1-walk-start', 'awp-zoom2-crouch-diagonal'):
        next(f for f in out if f['id'] == ident)['mxcsrProfiles'].append('nearest-ftz-daz')
    assert len(out) == 30
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite scoped replay output'
    scope_join = verify_scope_join()
    sys.path.insert(0, str(GROUND))
    from proof import verify
    static_proof = verify(args.binary.resolve(), GROUND / 'proof-manifest.json')
    v1.BINARY = args.binary.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    definition = {'schema': 'cs2.native-scoped-awp-fixtures.v1', 'fixtures': fixtures(),
                  'mxcsrProfiles': v2.PROFILES, 'friction': 5.2, 'stopSpeed': 80, 'accelerate': 5.5,
                  'surfaceFactor': 1, 'ownerFactor': 1, 'ownerExternalVector': [0, 0, 0],
                  'weaponSpeedScaling': True, 'debug': False, 'waterLevel': 0,
                  'zoomLevels': 2, 'suppliedZoomLevels': [1, 2], 'weaponSpeed': 100,
                  'walkServiceHandle': -1,
                  'processedCapProvenance': 'Explicit float32(100 * stance multiplier); upstream native cap modifiers are not invoked.'}
    fixture_path = args.out / 'fixtures.json'
    fixture_path.write_text(json.dumps(definition, indent=2, allow_nan=False) + '\n')
    n = Native()
    sequences = []
    for fixture in definition['fixtures']:
        n.configure(fixture)
        for profile in fixture['mxcsrProfiles']:
            sequences.append(combined.replay(n, fixture, profile))
    rows = sum(len(s['rows']) for s in sequences)
    assert len(definition['fixtures']) <= 32 and rows <= 1024
    gradual = {s['fixtureId']: s for s in sequences if s['mxcsrProfile'] == 'nearest-gradual'}
    equal_pairs = 0
    for ident, sequence in gradual.items():
        if 'zoom1' in ident:
            counterpart = gradual[ident.replace('zoom1', 'zoom2')]
            assert sequence['rows'] == counterpart['rows'], ident
            assert sequence['generatedCommands'] == counterpart['generatedCommands'], ident
            equal_pairs += 1
    assert equal_pairs == 15
    for zoom in (1, 2):
        assert n.scoped_branches[f'zoom{zoom}:standard-data-count-read'] > 0
        assert n.scoped_branches[f'zoom{zoom}:retained-scoped-scale'] > 0
    report = {'schema': 'cs2.native-scoped-awp-oracle.v1', 'guardedNativeExecution': True,
              'serverSha256': v1.SHA, 'readerSha256': digest(Path(__file__)), 'stanceReaderSha256': STANCE_SHA,
              'scopeJoin': scope_join, 'portableStaticProof': static_proof,
              'fixtureDefinitionSha256': hashlib.sha256(v2.canonical(definition)).hexdigest(),
              'fixtureFileSha256': digest(fixture_path), 'selectedNativeCodeBytes': 7192,
              'newNativeCodeBytes': 0, 'newPrivateBytesBeyondStance': 12, 'newAccessorHooks': 0,
              'fixtures': definition['fixtures'], 'sequences': sequences, 'hooks': n.calls,
              'mxcsrProfiles': v2.PROFILES, 'mxcsrExecutionResults': n.mxcsr_calls,
              'scopeBranchCounts': n.scoped_branches, 'identicalZoomPairs': equal_pairs,
              'readLedger': n.reads,
              'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts,
                  'policy': 'Frozen strict guard plus only the declared 8-byte weapon-data pointer and 4-byte configured zoom count.',
                  'accessLedger': [{'operation': op, 'address': hex(at), 'bytes': size, 'count': count}
                                  for (op, at, size), count in sorted(n.memory_accesses.items())]},
              'limits': ['Supplied scoped AWP getter speed100, current zoom1/2, configured zoom count2, stance and processed cap.',
                         'The actual class/field association is static; native getter implementations are not newly executed.',
                         'Native Accelerate consults the standard data count inline; only existing speed/current-zoom hook return values change.',
                         'Walking uses the explicit invalid movement-service handle; other handle paths remain outside scope.',
                         'Scope transitions, upstream cap modifiers, collision and complete native command dispatch are not invoked.',
                         'Command marker/segmentation and uncollided displacement remain the existing byte-bound supplied harness.',
                         'No new native code range or accessor hook; MXCSR and flat dry owner/surface inputs are supplied.']}
    target = args.out / 'native.json'
    with target.open('w') as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write('\n')
    summary = {'sourceNativeSha256': digest(target), 'readerSha256': report['readerSha256'],
               'fixtureDefinitionSha256': report['fixtureDefinitionSha256'],
               'fixtureFileSha256': report['fixtureFileSha256'],
               'fixtures': len(definition['fixtures']), 'sequences': len(sequences), 'rows': rows,
               'identicalZoomPairs': equal_pairs, 'guardCounts': n.memory_counts,
               'scopeBranchCounts': n.scoped_branches, 'status': 'passed'}
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'output': str(target), **summary}))


if __name__ == '__main__':
    main()
