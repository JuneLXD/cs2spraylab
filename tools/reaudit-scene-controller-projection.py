"""Compare captured controller/provider clocks through the native yaw dispatch.

Inputs remain sampled post-call state with reconstructed pre-dispatch yaw. This
does not identify the clock consumed by an invocation or establish a replay.
Only the two independently captured clock candidates are supplied; no offsets
are searched, fitted or applied.
"""
import argparse
import hashlib
import json
import math
import runpy
import struct
from collections import Counter, defaultdict
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent / 'native-audit'
EXPECTED = '1583fed348b1d62a6c281bacd181b3d6df4eb82df24ffb1524be14c2f545c30a'
F = lambda x: struct.unpack('<f', struct.pack('<f', x))[0]


def ulp32(value):
    bits = struct.unpack('<I', struct.pack('<f', abs(value)))[0]
    return struct.unpack('<f', struct.pack('<I', bits+1))[0]-abs(F(value))


def case_from(row, tick):
    e = row['extra']
    aim = e['sceneWriterAimYaw']
    error = e['sceneWriterSignedAimBodyDifference']
    body = F(aim-error)
    if body > 180: body = F(body-360)
    if body < -180: body = F(body+360)
    return dict(name='capture-row', state=e['sceneWriterGroundState'],
        bodyYaw=body, aimYaw=aim, aimPitch=e['sceneWriterAimPitch'], signedError=error,
        absoluteError=e['sceneWriterAbsoluteAimBodyDifference'], aimChangeRate=e['sceneWriterAimYawChangeRate'],
        speed=e['sceneWriterHorizontalSpeed'], maxSpeed=e['sceneWriterMaxSpeed'], duckAmount=e['sceneWriterDuckAmount'],
        commandDirection=e['sceneWriterNormalizedCommandDirection'], commandDirectionCode=e['sceneWriterCommandDirectionCode'],
        movementDirection=e['sceneWriterMovementDirection'], grounded=bool(row['flags']&1), moveType=row['moveType'],
        actionStart=e['sceneWriterActionStartTick'], staticAimStart=e['sceneWriterStaticAimStartTick'],
        plantStart=e['sceneWriterPlantTurnStartTick'], turnOnSpotAngle=e['sceneWriterTurnOnSpotAngle'],
        previousAimYaw=e['sceneWriterPreviousAimYaw'], previousSpeed=e['sceneWriterPreviousHorizontalSpeed'],
        wasOnGround=e['sceneWriterWasOnGround'], wasStationary=e['sceneWriterWasStationary'],
        airOverride=e['sceneWriterTransientAirOverride'], currentMoveType=e['sceneWriterCurrentMoveType'],
        actionDirection=e['sceneWriterGroundActionDirection'], turnRate=e['sceneWriterTurnRate'], tick=tick)


def summarize(records):
    return dict(rows=len(records), matches=sum(r['matchesWithinReconstruction'] for r in records),
        maxAbsoluteError=max((abs(r['error']) for r in records), default=0),
        stateChanges=sum(not r['stateRemainsSame'] for r in records),
        mismatchedRows=[r['row'] for r in records if not r['matchesWithinReconstruction']])


def boundary_diagnostics(oracle, rows, report):
    records = []
    latest_nonidle = None
    mismatch_rows = set(report['groups']['controller-seed']['1']['mismatchedRows'])
    for number, row in enumerate(rows):
        e = row['extra']
        if e['sceneWriterGroundState'] != 1:
            latest_nonidle = e['sceneWriterGroundState']
        if number not in mismatch_rows or latest_nonidle != 5:
            continue
        tick = e['bodyClock']['fields']['bodyClockControllerSeedCandidate']
        case = case_from(row, tick)
        # Explicit diagnostic counterfactual, selected from the preceding
        # observed non-idle state. No inference of an unobserved invocation.
        case['state'] = latest_nonidle
        result = oracle.invoke(case, dispatch_only=True)
        expected = e['sceneWriterProducedYaw']
        tolerance = 4*max(ulp32(case['aimYaw']), ulp32(case['signedError']), ulp32(expected), 2**-149)
        records.append(dict(row=number, suppliedPriorObservedState=latest_nonidle,
            capturedPostState=e['sceneWriterGroundState'], resultState=result['state'],
            expectedYaw=expected, nativeYaw=result['bodyYaw'],
            error=F(result['bodyYaw']-expected), tolerance=tolerance,
            matchesWithinReconstruction=abs(F(result['bodyYaw']-expected))<=tolerance,
            command=e['sceneWriterLastCommandNumberProcessed']))
    report['boundaryDiagnostics'] = dict(
        method='For remaining Idle mismatches only, substitute preceding observed non-Idle state (Loop), retaining all other captured post-call inputs. This is a counterfactual boundary diagnostic, not an invocation replay.',
        rows=len(records), distinctCommands=len({r['command'] for r in records}),
        matches=sum(r['matchesWithinReconstruction'] and r['resultState']==r['capturedPostState'] for r in records),
        details=records)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixture', type=Path, default=REPO/'docs/evidence/reaudit-motion-clock-fixture.json')
    parser.add_argument('--summary', type=Path, default=REPO/'docs/evidence/reaudit-scene-controller-runtime.json')
    parser.add_argument('--out', type=Path, default=ROOT/'reports/reaudit-body-clock/runtime007-projection.json')
    args = parser.parse_args()
    rows, fixture, fixture_sha = runpy.run_path(str(REPO/'tools/reaudit-motion-capture-fixture.py'))['load_fixture'](args.fixture)
    assert fixture['sourceSnapshotSha256'] == EXPECTED
    assert len(rows) == 2589
    assert all(r['extra']['sceneWriterValid'] and r['extra']['bodyClock']['fields']['bodyClockValid'] for r in rows)
    module = runpy.run_path(str(REPO/'tools/reaudit-scene-writer-oracle.py'))
    assert fixture['clientSha256'] == module['EXPECTED']
    oracle = module['Oracle']()
    candidates = {'sampled-provider': 'bodyClockSampledProviderTick',
                  'controller-seed': 'bodyClockControllerSeedCandidate'}
    summaries, details, unique = {}, [], {}
    for label, field in candidates.items():
        groups = defaultdict(list)
        seen = {}
        unique_groups = defaultdict(list)
        compared = set()
        for number, row in enumerate(rows):
            e, c = row['extra'], row['extra']['bodyClock']['fields']
            tick = c[field]
            assert tick is not None and isinstance(tick, int)
            case = case_from(row, tick)
            signature = json.dumps(case, sort_keys=True)
            if signature not in seen: seen[signature] = oracle.invoke(case, dispatch_only=True)
            result = seen[signature]
            expected = e['sceneWriterProducedYaw']
            error = F(result['bodyYaw']-expected)
            tolerance = 4*max(ulp32(case['aimYaw']), ulp32(case['signedError']), ulp32(expected), 2**-149)
            group = 'air' if not row['flags']&1 else str(case['state'])
            record = dict(row=number, clock=label, group=group, frame=row['frame'],
                command=e['sceneWriterLastCommandNumberProcessed'], suppliedTick=tick,
                actionStart=case['actionStart'], inputYaw=case['bodyYaw'], expectedYaw=expected,
                nativeYaw=result['bodyYaw'], error=error, tolerance=tolerance,
                matchesWithinReconstruction=abs(error)<=tolerance, suppliedState=case['state'],
                resultState=result['state'], stateRemainsSame=result['state']==case['state'],
                processingPawnMatches=c['bodyClockProcessingPawnMatches'],
                anyProcessingPawn=c['bodyClockAnyProcessingPawn'],
                processingControllerMatches=c['bodyClockProcessingControllerMatches'],
                anyProcessingController=c['bodyClockAnyProcessingController'])
            groups[group].append(record)
            details.append(record)
            # Include retained output in the signature: same sampled inputs with
            # a different retained output are not collapsed into one comparison.
            comparison_signature = (signature, expected)
            if comparison_signature not in compared:
                compared.add(comparison_signature)
                unique_groups[group].append(record)
        summaries[label] = {g: summarize(v) for g, v in groups.items()}
        unique[label] = {g: summarize(v) for g, v in unique_groups.items()}
    scopes = Counter()
    differences = Counter()
    command_outputs = defaultdict(set)
    ramps = []
    for number, row in enumerate(rows):
        e, c = row['extra'], row['extra']['bodyClock']['fields']
        scopes[str((c['bodyClockAnyProcessingPawn'], c['bodyClockProcessingPawnMatches'],
                    c['bodyClockAnyProcessingController'], c['bodyClockProcessingControllerMatches']))] += 1
        differences[str(c['bodyClockControllerSeedCandidate']-c['bodyClockSampledProviderTick'])] += 1
        command_outputs[e['sceneWriterLastCommandNumberProcessed']].add(e['sceneWriterProducedYaw'])
        if row['flags']&1 and e['sceneWriterGroundState'] == 5 and e['sceneWriterAbsoluteAimBodyDifference'] > 0:
            ratio = abs(e['sceneWriterTurnRate'])/(8*e['sceneWriterAbsoluteAimBodyDifference'])
            if 0 < ratio < 1-1e-6:
                elapsed = 12*ratio-1
                inferred_tick = e['sceneWriterActionStartTick']+round(elapsed)
                ramps.append(dict(row=number, elapsedDiagnostic=elapsed, nearestIntegerResidual=abs(elapsed-round(elapsed)),
                    inferredTickDiagnostic=inferred_tick, sampledProviderTick=c['bodyClockSampledProviderTick'],
                    controllerSeedCandidate=c['bodyClockControllerSeedCandidate'],
                    controllerSeedMatches=inferred_tick==c['bodyClockControllerSeedCandidate'],
                    sampledProviderMatches=inferred_tick==c['bodyClockSampledProviderTick'],
                    processingControllerMatches=c['bodyClockProcessingControllerMatches']))
    ramp_summary = dict(rows=len(ramps), maxIntegerResidual=max((r['nearestIntegerResidual'] for r in ramps), default=0),
        controllerSeedMatches=sum(r['controllerSeedMatches'] for r in ramps),
        sampledProviderMatches=sum(r['sampledProviderMatches'] for r in ramps))
    report = dict(method=__doc__, clientSha256=module['EXPECTED'], snapshotSha256=EXPECTED,
        rows=len(rows), fixtureSha256=fixture_sha,
        probeSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        productionChanged=False, groups=summaries, uniqueComparisons=unique, scopeTuples=scopes,
        scopeTupleOrder=['anyPawn', 'pawnMatches', 'anyController', 'controllerMatches'],
        controllerMinusProviderTick=differences,
        commandsWithMultipleYaws=sum(len(v)>1 for v in command_outputs.values()),
        rampDiagnosticSummary=ramp_summary, rampDiagnostics=ramps, details=details,
        limits=[
            'The independently captured candidates are supplied inputs, not proven invocation clocks.',
            'Post-call states/timers and cached pre-dispatch aim/error cannot establish a free-running replay; boundary state transitions can differ.',
            'The controller can be sampled after increment and before body postprocessing/publication; inactive markers do not prove association.',
            'The ramp inversion is an output-derived diagnostic only, not an alternative clock source or a fitted rule.',
            'Float32 yaw reconstruction tolerance derives from spacing, not from observed error.',
            'Private-memory native oracle retains its entity-interface, movement-preparation, math, IK and auxiliary-work shims.',
        ])
    boundary_diagnostics(oracle, rows, report)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2, allow_nan=False)+'\n')
    brief = {k: v for k, v in report.items() if k not in ['details', 'rampDiagnostics', 'uniqueComparisons']}
    shared = {k: v for k, v in report.items() if k not in ['details', 'rampDiagnostics']}
    args.summary.write_text(json.dumps(shared, indent=2, allow_nan=False)+'\n')
    print(json.dumps(brief))


if __name__ == '__main__': main()
