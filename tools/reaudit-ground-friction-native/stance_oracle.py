#!/usr/bin/env python3
"""Portable supplied stance/cap extension of the frozen combined native oracle.

No new native code ranges or accessor hooks. Processed stance/tag caps are
declared inputs, not a proof of the upstream native cap-modifier pipeline.
Requires only the sibling packaged modules/proofs and a matching server ELF.
Run serially under MemoryMax=512M, MemorySwapMax=0 and CPUQuota=100%.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
COMBINED = ROOT / 'oracle.py'
COMBINED_SHA = '2988404618a76104557a73949649c67f759999373e4829fddd37f6a84ff46306'
ORIGINAL_COMBINED_SHA = 'cc784a00031e18006d57da6da252a6fd5916b4768278e3885cd146a50368dd74'
ORIGINAL_READER_SHA = '700f1bfe61ee7a3eeed7ff1d00495e80399923263d429edadc956188de822888'
OWNER_SERVICE = 0x5012300

def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()

assert digest(COMBINED) == COMBINED_SHA
spec = importlib.util.spec_from_file_location('preserved_ground_combined', COMBINED)
combined = importlib.util.module_from_spec(spec)
spec.loader.exec_module(combined)
v3, v2, v1, f32 = combined.v3, combined.v2, combined.v1, combined.f32
v1.SUPPLIED_DATA.extend([(v1.PAWN + 0x1100, 8, 'supplied-owner-movement-service-pointer'),
                         (OWNER_SERVICE, 80, 'supplied-movement-service-invalid-handle')])
assert sum(size for _, size in v1.CODE.values()) == 7192

class Native(combined.Native):
    def __init__(self):
        self.stance = 'stand'
        self.weapon_base = None
        super().__init__()
        self.wq(v1.PAWN + 0x1100, OWNER_SERVICE)
        self.u.mem_write(OWNER_SERVICE + 0x48, v1.struct.pack('<i', -1))

    def configure(self, fixture):
        self.stance = fixture['stance']
        assert self.stance in ('stand', 'walk', 'crouch')
        self.weapon_base = fixture['weaponSpeed']
        self.wb(v1.MOVE + 0x58, 4 if self.stance == 'crouch' else 0)
        self.wb(v1.MOVE + 0x5a, 1 if self.stance == 'walk' else 0)
        self.wb(v1.MOVE + 0x416, 0)
        self.wb(v1.PAWN + 0x668, 2 if self.stance == 'crouch' else 0)

    def hook(self, u, at, size, data):
        # Permit only the two newly declared stance branches. All existing
        # accessor, instruction, data and unrelated-branch guards remain.
        if at in (0x158d100, 0x158d1f8):
            assert self.stance == ('walk' if at == 0x158d100 else 'crouch')
            v3.Native.hook(self, u, at, size, data)
            return
        if at == combined.SPEED_HOOK:
            assert u.reg_read(v1.UC_X86_REG_RDI) == combined.WEAPON
            assert self.weapon_base in (200, 215, 225, 230, 240)
            role = 'supplied-mode-weapon-speed'
            self.calls[role] = self.calls.get(role, 0) + 1
            self.xmm(v1.UC_X86_REG_XMM0, self.weapon_base)
            self.ret()
            return
        super().hook(u, at, size, data)

def fixtures():
    out = []
    for weapon in (200, 215, 225, 230, 240):
        for stance, multiplier in [('stand', 1), ('walk', .52), ('crouch', .34)]:
            for tag in (1, .5):
                # This is an explicitly authored fixture input. Its relation
                # to stance/tag is a label, not an upstream native invocation.
                cap = f32(weapon * multiplier * tag)
                for name, initial in [('start', 0), ('below-cap', v1.frombits(v1.bits(cap) - 1)),
                                      ('at-cap', cap), ('above-cap', f32(cap * 1.2))]:
                    out.append({'id': f'{weapon}-{stance}-tag{tag:g}-{name}', 'kind': 'supplied-stance-cap',
                                'stance': stance, 'weaponSpeed': weapon, 'suppliedSpeed': cap,
                                'suppliedProcessedCap': cap, 'capLabelMultiplier': multiplier, 'tagLabel': tag,
                                'initialState': v2.seed(initial),
                                'commands': [v2.command(wish=(cap, 0), extra=(.5,)) for _ in range(16)],
                                'mxcsrProfiles': ['nearest-gradual']})
    for initial, side in [(0, 1), (215, 0), (215, -1), (3, 0)]:
        out.append({'id': f'old-midpoint-{initial}-{side:+d}', 'kind': 'old-midpoint-state',
                    'stance': 'stand', 'weaponSpeed': 215, 'suppliedSpeed': 215,
                    'suppliedProcessedCap': 215, 'capLabelMultiplier': 1, 'tagLabel': 1,
                    'initialState': v2.seed(initial),
                    'commands': [v2.command(end=.5, wish=(215 * side, 0), finish=False)],
                    'mxcsrProfiles': ['nearest-gradual']})
    for ident in ['215-walk-tag1-at-cap', '240-crouch-tag0.5-start', 'old-midpoint-215--1']:
        next(f for f in out if f['id'] == ident)['mxcsrProfiles'].append('nearest-ftz-daz')
    assert len(out) == 124
    return out

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', type=Path, required=True)
    parser.add_argument('--out', type=Path, required=True)
    args = parser.parse_args()
    from proof import verify
    manifest = ROOT / 'proof-manifest.json'
    static_proof = verify(args.binary.resolve(), manifest)
    v1.BINARY = args.binary.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    definition = {'schema': 'cs2.native-ground-stance-fixtures.v1', 'fixtures': fixtures(),
                  'mxcsrProfiles': v2.PROFILES, 'friction': 5.2, 'stopSpeed': 80, 'accelerate': 5.5,
                  'surfaceFactor': 1, 'ownerFactor': 1, 'ownerExternalVector': [0, 0, 0],
                  'weaponSpeedScaling': True, 'debug': False, 'waterLevel': 0, 'zoomLevel': 0,
                  'walkServiceHandle': -1,
                  'stanceFlags': {'stand': {'heldDuck': False, 'ownerDuck': False, 'walk': False},
                                  'walk': {'heldDuck': False, 'ownerDuck': False, 'walk': True},
                                  'crouch': {'heldDuck': True, 'ownerDuck': True, 'walk': False}},
                  'processedCapProvenance': 'Explicit supplied float32 cap; fixture labels do not execute upstream stance/tag modifiers.'}
    (args.out / 'fixtures.json').write_text(json.dumps(definition, indent=2, allow_nan=False) + '\n')
    n = Native()
    sequences = []
    for fixture in definition['fixtures']:
        n.configure(fixture)
        for profile in fixture['mxcsrProfiles']:
            sequences.append(combined.replay(n, fixture, profile))
    report = {'schema': 'cs2.native-ground-stance-oracle.v1', 'guardedNativeExecution': True,
              'serverSha256': v1.SHA, 'readerSha256': digest(Path(__file__)),
              'preservedCombinedReaderSha256': ORIGINAL_COMBINED_SHA,
              'portableCombinedReaderSha256': COMBINED_SHA,
              'originalLocalReaderSha256': ORIGINAL_READER_SHA,
              'portableManifestSha256': digest(manifest), 'portableStaticProof': static_proof,
              'selectedNativeCodeBytes': 7192,
              'newNativeCodeBytes': 0, 'newPrivateBytes': 88,
              'newPrivateSpans': [{'address': hex(v1.PAWN + 0x1100), 'bytes': 8},
                                  {'address': hex(OWNER_SERVICE), 'bytes': 80}],
              'fixtureDefinitionSha256': hashlib.sha256(v2.canonical(definition)).hexdigest(),
              'fixtureFileSha256': digest(args.out / 'fixtures.json'), 'fixtures': definition['fixtures'],
              'sequences': sequences, 'hooks': n.calls, 'readLedger': n.reads,
              'mxcsrProfiles': v2.PROFILES, 'mxcsrExecutionResults': n.mxcsr_calls,
              'memoryGuard': {'unexpectedAccesses': 0, 'counts': n.memory_counts,
                  'policy': 'Existing strict guard plus only the declared 8-byte owner pointer and 80-byte service object.',
                  'accessLedger': [{'operation': op, 'address': hex(at), 'bytes': size, 'count': count}
                                  for (op, at, size), count in sorted(n.memory_accesses.items())]},
              'limits': ['All stance flags, weapon getter speeds, processed caps and schedules are explicitly supplied.',
                         'The upstream native stance/tag/cap-modifier pipeline is not invoked or newly validated.',
                         'Same finite grounded native arithmetic as the combined oracle, with only existing walk/crouch branches enabled.',
                         'No new native code, native accessor, collision, physical input replay or complete command dispatcher.',
                         'Walking uses the explicit invalid movement-service handle; other handle cases remain outside this replay.',
                         'Tag factors label supplied caps only; tag recovery/application is outside this replay.',
                         'MXCSR profiles and zero external owner velocity are supplied.']}
    target = args.out / 'native.json'
    with target.open('w') as output:
        json.dump(report, output, indent=2, allow_nan=False)
        output.write('\n')
    summary = {'sourceNativeSha256': digest(target), 'readerSha256': report['readerSha256'],
               'fixtureDefinitionSha256': report['fixtureDefinitionSha256'],
               'fixtureFileSha256': report['fixtureFileSha256'], 'fixtures': len(definition['fixtures']),
               'sequences': len(sequences), 'rows': sum(len(s['rows']) for s in sequences),
               'guardCounts': n.memory_counts, 'newNativeCodeBytes': 0, 'newPrivateBytes': 88,
               'oldMidpoints': [], 'capControls': [], 'status': 'passed'}
    by_id = {f['id']: f for f in definition['fixtures']}
    for sequence in sequences:
        fixture = by_id[sequence['fixtureId']]
        if sequence['mxcsrProfile'] != 'nearest-gradual':
            continue
        if fixture['kind'] == 'old-midpoint-state':
            row = sequence['rows'][0]
            summary['oldMidpoints'].append({'fixtureId': fixture['id'], 'initialVelocity': fixture['initialState']['velocity'][0],
                'nativeMidpoint': row['afterPreHelper']['speedX'], 'nativeFinalVelocity': row['afterPostHelper']['speedX'],
                'derivedPosition': row['derivedUncollidedDisplacement']['x'], 'stopGate': row['nativeStopGate']['taken']})
        else:
            last = sequence['rows'][-1]
            summary['capControls'].append({'fixtureId': fixture['id'], 'weaponSpeed': fixture['weaponSpeed'],
                'suppliedCap': fixture['suppliedProcessedCap'], 'nativeFinalVelocity': last['afterPostHelper']['speedX'],
                'nativeCapEndpoint': last['afterNativeCap']['speedX'], 'nativeMidpoint': last['afterPreHelper']['speedX']})
    (args.out / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
    print(json.dumps({'output': str(target), **{k: v for k, v in summary.items() if k not in ('capControls', 'oldMidpoints')},
                      'oldMidpoints': summary['oldMidpoints']}))

if __name__ == '__main__':
    main()
