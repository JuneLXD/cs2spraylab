"""Summarize retained body native cases and capture projections; no emulator."""
import hashlib
import json
import math
import runpy
import struct
from collections import Counter, defaultdict
from pathlib import Path

REPO=Path(__file__).resolve().parents[1]
ROOT=REPO.parent/'native-audit'
OUT=ROOT/'reports/reaudit-scene-writer-oracle'
rows,fixture,fixture_sha=runpy.run_path(str(REPO/'tools/reaudit-motion-capture-fixture.py'))['load_fixture']()
EXPECTED=fixture['sourceSnapshotSha256']
projection=json.loads((OUT/'capture-projection.json').read_text())
synthetic=json.loads((OUT/'oracle.json').read_text())
assert projection['fixtureSha256']==fixture_sha
assert projection['snapshotSha256']==EXPECTED
assert projection['clientSha256']==synthetic['clientSha256']==fixture['clientSha256']
F=lambda x:struct.unpack('<f',struct.pack('<f',x))[0]
by_row=defaultdict(list)
for record in projection['details']:
    by_row[record['row']].append(record)
assert len(by_row)==len(rows)
groups=defaultdict(list)
by_command=defaultdict(set)
ramp=[]
transitions=[]
angles=defaultdict(list)
for number,row in enumerate(rows):
    e=row['extra']
    group='air' if not row['flags']&1 else str(e['sceneWriterGroundState'])
    groups[group].append((number,row))
    by_command[e['sceneWriterLastCommandNumberProcessed']].add(e['sceneWriterProducedYaw'])
    for key in ['sceneLocalAngles','sceneAbsoluteAngles','sceneAbsUpdateSourceAngles']:
        angles[key].append(abs(F(e[key][1]-e['sceneWriterProducedYaw'])))
    error=e['sceneWriterAbsoluteAimBodyDifference']
    rate=e['sceneWriterTurnRate']
    if group=='5' and error>0:
        ratio=abs(rate)/(8*error)
        if ratio<.99999:
            elapsed=12*ratio-1
            ramp.append(dict(row=number,integerResidual=abs(elapsed-round(elapsed)),
                inferredTick=e['sceneWriterActionStartTick']+round(elapsed),
                globalTick=e['sceneWriterRawGlobalTick'],command=e['sceneWriterLastCommandNumberProcessed']))
    if number and rows[number-1]['extra']['sceneWriterGroundState']!=e['sceneWriterGroundState']:
        previous=rows[number-1]['extra']
        transitions.append(dict(row=number,previousObservedState=previous['sceneWriterGroundState'],
            currentState=e['sceneWriterGroundState'],commandDelta=e['sceneWriterLastCommandNumberProcessed']-previous['sceneWriterLastCommandNumberProcessed'],
            yaw=e['sceneWriterProducedYaw'],cachedError=e['sceneWriterSignedAimBodyDifference'],cachedRate=rate,
            rawProjectionMatched=by_row[number][0]['matchesWithinReconstruction']))

summary=dict(
    clientSha256=synthetic['clientSha256'],snapshotSha256=EXPECTED,fixtureSha256=fixture_sha,captureName='native_reaudit_bob_005',
    productionChanged=False,
    method='Native wrapper/state cases in private emulator memory, plus captured-input dispatch projections. Supplied interfaces and post-call-state limitations remain explicit.',
    synthetic=dict(cases=len(synthetic['cases']),assertions=len(synthetic['assertions']),binaryPagesMapped=synthetic['pagesMapped'],
        imports=sorted(set(synthetic['imports'].values())),
        nativeRanges={r['name']:r['sha256'] for r in synthetic['proofRanges']}),
    capture=dict(rows=len(rows),validBodyOwners=sum(r['extra']['sceneWriterValid'] for r in rows),
        processedCommands=len(by_command),commandsWithMultipleProducedYaws=sum(len(v)>1 for v in by_command.values()),
        requestedFrameCounters=len(set(r['frame'] for r in rows))),
    projections=projection['groups'],
    groups={group:dict(rows=len(entries),commands=len(set(r['extra']['sceneWriterLastCommandNumberProcessed'] for _,r in entries)),
        nativeYawSignatures=len(set((r['extra']['sceneWriterProducedYaw'],r['extra']['sceneWriterSignedAimBodyDifference'],r['extra']['sceneWriterAimYaw'])for _,r in entries)),
        matchesUnderAtLeastOneExplicitClock=sum(any(d['matchesWithinReconstruction'] for d in by_row[number])for number,_ in entries))
        for group,entries in groups.items()},
    rampClockDiagnostic=dict(rows=len(ramp),maxIntegerResidual=max(x['integerResidual']for x in ramp),
        inferredMinusRawGlobal=dict(Counter(x['inferredTick']-x['globalTick']for x in ramp)),
        inferredMinusProcessedCommand=dict(Counter(x['inferredTick']-x['command']for x in ramp)),
        warning='The integer ramp inversion is diagnostic only. The observed command offset is not a proven caller rule and must not be copied into production.'),
    sceneAngleComparison={k:dict(exactMatches=sum(v==0 for v in values),maxAbsoluteDegrees=max(values))for k,values in angles.items()},
    stateTransitions=transitions,
    conclusions=[
        'All retained Move, Start and airborne produced-yaw samples match the native dispatch projection exactly.',
        'Every retained TurnOnSpotLoop sample matches under at least one of the two explicit supplied clocks, but neither single raw-clock hypothesis explains every sample.',
        'One projected Idle mismatch follows an observed TurnOnSpotLoop-to-Idle transition; the cached turn rate records the final step before the state changed.',
        'Repeated processed-command values can accompany different produced yaws. These snapshots do not prove invocation count or update ownership within prediction.',
        'The constructor/reset and caller-clock requirements remain open; this pass does not justify a production body-yaw update.'
    ],
    limits=synthetic['limits']+projection['limits'])
(OUT/'summary.json').write_text(json.dumps(summary,indent=2,allow_nan=False)+'\n')
(REPO/'docs/evidence/reaudit-scene-writer-runtime.json').write_text(json.dumps(summary,indent=2,allow_nan=False)+'\n')
print(json.dumps({k:summary[k]for k in ['synthetic','capture','groups','rampClockDiagnostic','sceneAngleComparison']}))
