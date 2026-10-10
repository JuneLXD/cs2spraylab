"""Project captured pre-dispatch yaw/error inputs through native dispatch.

This is not a full state replay: captured ground state and timers are post-call;
input yaw is reconstructed from the retained pre-dispatch aim/error pair.
Explicit raw-global clock hypotheses are diagnostics, not selected native rules.
"""
import hashlib
import json
import math
import runpy
import struct
from collections import Counter, defaultdict
from pathlib import Path

REPO=Path(__file__).resolve().parents[1]
ROOT=REPO.parent/'native-audit'
module=runpy.run_path(str(REPO/'tools/reaudit-scene-writer-oracle.py'))
oracle=module['Oracle']()
F=module['F']
OUT=ROOT/'reports/reaudit-scene-writer-oracle'
rows,fixture,fixture_sha=runpy.run_path(str(REPO/'tools/reaudit-motion-capture-fixture.py'))['load_fixture']()
EXPECTED=fixture['sourceSnapshotSha256']
assert fixture['clientSha256']==module['EXPECTED']
assert len(rows)==1614 and all(r['extra']['sceneWriterValid'] for r in rows)


def ulp32(value):
    bits=struct.unpack('<I',struct.pack('<f',abs(value)))[0]
    return struct.unpack('<f',struct.pack('<I',bits+1))[0]-abs(F(value))


def case_from(row,tick):
    e=row['extra']
    aim=e['sceneWriterAimYaw']
    error=e['sceneWriterSignedAimBodyDifference']
    body=F(aim-error)
    if body>180:body=F(body-360)
    if body<-180:body=F(body+360)
    return dict(name='capture-row',state=e['sceneWriterGroundState'],
        bodyYaw=body,aimYaw=aim,aimPitch=e['sceneWriterAimPitch'],signedError=error,
        absoluteError=e['sceneWriterAbsoluteAimBodyDifference'],aimChangeRate=e['sceneWriterAimYawChangeRate'],
        speed=e['sceneWriterHorizontalSpeed'],maxSpeed=e['sceneWriterMaxSpeed'],duckAmount=e['sceneWriterDuckAmount'],
        commandDirection=e['sceneWriterNormalizedCommandDirection'],commandDirectionCode=e['sceneWriterCommandDirectionCode'],
        movementDirection=e['sceneWriterMovementDirection'],grounded=bool(row['flags']&1),moveType=row['moveType'],
        actionStart=e['sceneWriterActionStartTick'],staticAimStart=e['sceneWriterStaticAimStartTick'],
        plantStart=e['sceneWriterPlantTurnStartTick'],turnOnSpotAngle=e['sceneWriterTurnOnSpotAngle'],
        previousAimYaw=e['sceneWriterPreviousAimYaw'],previousSpeed=e['sceneWriterPreviousHorizontalSpeed'],
        wasOnGround=e['sceneWriterWasOnGround'],wasStationary=e['sceneWriterWasStationary'],
        airOverride=e['sceneWriterTransientAirOverride'],currentMoveType=e['sceneWriterCurrentMoveType'],
        actionDirection=e['sceneWriterGroundActionDirection'],turnRate=e['sceneWriterTurnRate'],tick=tick)


summaries={}
details=[]
for label,extra_tick in [('normalized-raw-global',0),('normalized-raw-global-plus-one',1)]:
    groups=defaultdict(list)
    for number,row in enumerate(rows):
        e=row['extra']
        # Captured fraction is zero in this window. This explicit expression
        # preserves the static provider's positive-fraction ceil distinction.
        tick=e['sceneWriterRawGlobalTick']+int(e['sceneWriterRawGlobalFraction']>0)+extra_tick
        case=case_from(row,tick)
        result=oracle.invoke(case,dispatch_only=True)
        expected=e['sceneWriterProducedYaw']
        error=F(result['bodyYaw']-expected)
        # Conservative float32 reconstruction allowance, based solely on value
        # spacing. It is not selected from observed comparison errors.
        tolerance=4*max(ulp32(case['aimYaw']),ulp32(case['signedError']),ulp32(expected),2**-149)
        group='air' if not row['flags']&1 else str(case['state'])
        record=dict(row=number,clock=label,group=group,frame=row['frame'],command=e['sceneWriterLastCommandNumberProcessed'],
                    suppliedTick=tick,actionStart=case['actionStart'],inputYaw=case['bodyYaw'],
                    expectedYaw=expected,nativeYaw=result['bodyYaw'],error=error,tolerance=tolerance,
                    matchesWithinReconstruction=abs(error)<=tolerance,
                    suppliedState=case['state'],resultState=result['state'],
                    stateRemainsSame=result['state']==case['state'])
        groups[group].append(record)
        details.append(record)
    summaries[label]={group:dict(rows=len(records),matches=sum(r['matchesWithinReconstruction'] for r in records),
        maxAbsoluteError=max(abs(r['error']) for r in records),stateChanges=sum(not r['stateRemainsSame'] for r in records))
        for group,records in groups.items()}
result=dict(method=__doc__,snapshotSha256=EXPECTED,fixtureSha256=fixture_sha,clientSha256=module['EXPECTED'],rows=len(rows),
            groups=summaries,details=details,
            limits=['This projects captured post-call state/timers with cached pre-dispatch error; it is not a consecutive-command replay.',
                    'Working input yaw is reconstructed from a float32 aim/error pair. The documented tolerance derives from float32 spacing, not a fitted margin.',
                    'Both clocks are explicit diagnostics. The scoped movement clock is not established by either sampled raw global field.',
                    'Skipped IK, air auxiliary and mathematical shims retain the synthetic oracle limitations.',
                    'Mismatches cannot be used to tune body yaw or select a production update phase.'])
OUT.mkdir(exist_ok=True)
(OUT/'capture-projection.json').write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
print(json.dumps(dict(rows=len(rows),groups=summaries,output=str(OUT/'capture-projection.json'))))
