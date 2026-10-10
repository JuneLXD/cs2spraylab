"""Export only named numeric state from the accepted motion capture.

The allowlists omit process identities, pointers, virtual addresses and raw
memory. Velocity value words are the ten numeric words per vector already
decoded by the bounded capture reader; no dereference is performed here.
"""
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent / 'native-audit'
SOURCE = ROOT / 'reports/reaudit-motion-runtime-006/native_reaudit_bob_005-snapshot.jsonl'
EXPECTED = '698040d5947f90eff1ef26aa9539ddf09958bc67659eced15c287876cd880a27'
FIELDS = ['monotonic', 'frame', 'currentTime', 'frameDelta', 'tick', 'flags',
          'storedVelocity', 'velocityInterpolationEnabled', 'moveType',
          'velocityCache0', 'velocityCacheTimes', 'interpolationContext']
EXTRA_FIELDS = ['velocityWrapperFlags', 'velocityHistoryRings',
    'sceneLocalAngles', 'sceneAbsoluteAngles', 'sceneAbsUpdateSourceAngles',
    'sceneWriterValid', 'sceneWriterCurrentMoveType', 'sceneWriterGroundState',
    'sceneWriterGroundActionDirection', 'sceneWriterAirAction',
    'sceneWriterWasOnGround', 'sceneWriterWasStationary', 'sceneWriterActionStartTick',
    'sceneWriterStaticAimStartTick', 'sceneWriterPlantTurnStartTick',
    'sceneWriterTurnOnSpotAngle', 'sceneWriterPreviousAimYaw',
    'sceneWriterPreviousHorizontalSpeed', 'sceneWriterTransientAirOverride',
    'sceneWriterCommandDirectionCode', 'sceneWriterNormalizedCommandDirection',
    'sceneWriterLocalVelocity', 'sceneWriterMovementDirection', 'sceneWriterMaxSpeed',
    'sceneWriterHorizontalSpeed', 'sceneWriterDuckAmount', 'sceneWriterTurnRate',
    'sceneWriterAimYaw', 'sceneWriterAimPitch', 'sceneWriterSignedAimBodyDifference',
    'sceneWriterAbsoluteAimBodyDifference', 'sceneWriterAimYawChangeRate',
    'sceneWriterProducedYaw', 'sceneWriterMovementInputs',
    'sceneWriterLastCommandNumberProcessed', 'sceneWriterContextSelector',
    'sceneWriterRawGlobalTick', 'sceneWriterRawGlobalFraction', 'swayInputFields']


def main():
    raw = SOURCE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED
    rows = [json.loads(line) for line in raw.splitlines()]
    for row in rows:
        row['extra']['swayInputFields'] = row['extra']['swayInputs']['fields']
    launch = json.loads((SOURCE.parent / 'launch.json').read_text())
    fixture = dict(capture='native_reaudit_bob_005', sourceSnapshotSha256=EXPECTED,
        clientSha256=launch['clientSha256'], samplerSha256=launch['samplerSha256'],
        helperHashes=launch['helperHashes'], fields=FIELDS, extraFields=EXTRA_FIELDS,
        rows=[[r[k] for k in FIELDS] + [[r['extra'][k] for k in EXTRA_FIELDS]] for r in rows],
        limits=['Accepted asynchronous snapshots; changed reads were rejected.',
                'Repeated state does not count native invocations or presented frames.',
                'No controller tick base or active movement-processing identity was captured.',
                'Ordinary unscoped AK movement, turns, crouch and jump only.'])
    out = REPO / 'docs/evidence/reaudit-motion-runtime-fixture.json'
    out.write_text(json.dumps(fixture, separators=(',', ':'), allow_nan=False) + '\n')
    print(json.dumps(dict(rows=len(rows), bytes=out.stat().st_size,
                          sha256=hashlib.sha256(out.read_bytes()).hexdigest())))


def load_fixture(path=None):
    path = Path(path) if path is not None else REPO / 'docs/evidence/reaudit-motion-runtime-fixture.json'
    data = path.read_bytes()
    fixture = json.loads(data)
    rows = []
    for values in fixture['rows']:
        assert len(values) == len(fixture['fields']) + 1
        row = dict(zip(fixture['fields'], values[:-1]))
        assert len(values[-1]) == len(fixture['extraFields'])
        row['extra'] = dict(zip(fixture['extraFields'], values[-1]))
        rows.append(row)
    return rows, fixture, hashlib.sha256(data).hexdigest()


if __name__ == '__main__':
    main()
