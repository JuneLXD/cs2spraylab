"""Small offline body-clock diagnostics; no oracle runs or fitted clock rule."""
import hashlib
import json
import math
import runpy
import struct
from collections import Counter
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent / 'native-audit'
EXPECTED = '698040d5947f90eff1ef26aa9539ddf09958bc67659eced15c287876cd880a27'
PROJECTION = ROOT/'reports/reaudit-scene-writer-oracle/capture-projection.json'
F = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]


def main():
    rows, fixture, fixture_sha = runpy.run_path(str(REPO/'tools/reaudit-motion-capture-fixture.py'))['load_fixture']()
    assert fixture['sourceSnapshotSha256'] == EXPECTED
    prior = json.loads(PROJECTION.read_text())
    assert prior['snapshotSha256'] == EXPECTED and len(rows) == 1614
    assert prior['fixtureSha256'] == fixture_sha
    delta_counts, pause_counts = Counter(), Counter()
    ramp = []
    for number, row in enumerate(rows):
        e = row['extra']
        s = e['swayInputFields']
        assert s['clockDomainSelector'] == e['sceneWriterContextSelector']
        tick = math.trunc(F(F(row['currentTime']*64)+.5))
        delta_counts[tick-e['sceneWriterRawGlobalTick']] += 1
        pause_counts[(s['clockOffsetTicks'], s['clockCeilingTick'], s['clockCeilingEnabled'], s['clockDefaultConverter'])] += 1
        if e['sceneWriterGroundState'] != 5 or e['sceneWriterAbsoluteAimBodyDifference'] <= 0:
            continue
        # Invert the independently bound native ramp for a diagnostic effective
        # elapsed integer. This is neither a capture of the provider nor a new rule.
        ratio = abs(e['sceneWriterTurnRate'])/(8*e['sceneWriterAbsoluteAimBodyDifference'])
        if not 0 < ratio < 1-1e-6:
            continue
        elapsed = 12*ratio-1
        inferred = e['sceneWriterActionStartTick']+round(elapsed)
        ramp.append(dict(row=number, inferredTick=inferred, elapsedIntegerResidual=abs(elapsed-round(elapsed)),
                         roundedSampledTimeTick=tick, rawGlobalTick=e['sceneWriterRawGlobalTick'],
                         cachedPredictedTick=s['cachedPredictedTick']))
    assert delta_counts == {0: 1614}
    # Since every proposed currentTime tick equals the already-executed raw tick,
    # reuse its exact supplied-state native outputs instead of rerunning emulation.
    result = dict(snapshotSha256=EXPECTED, fixtureSha256=fixture_sha, rows=len(rows),
       provenance='Captured numeric clock diagnostics plus identical-input reuse of the retained native dispatch projection; no new native run.',
       formula='trunc(float32(float32(sampledCurrentTime * 64) + 0.5))',
       roundedSampledTimeMinusRawTick=dict(delta_counts),
       gameRulesFields=[dict(totalPausedTicks=k[0], pauseStartTick=k[1], gamePaused=k[2], defaultTimeConverter=k[3], rows=v)
                       for k,v in pause_counts.items()],
       reusedNativeProjectionSha256=hashlib.sha256(PROJECTION.read_bytes()).hexdigest(),
       reusedNativeProjectionGroups=prior['groups']['normalized-raw-global'],
       rampDiagnostics=dict(rows=len(ramp), maxIntegerResidual=max(r['elapsedIntegerResidual'] for r in ramp),
          inferredMinusRoundedSampledTime=dict(Counter(r['inferredTick']-r['roundedSampledTimeTick'] for r in ramp)),
          positiveCachedPredictionRows=sum(r['cachedPredictedTick']>0 for r in ramp),
          positiveCachedPredictionMatches=sum(r['cachedPredictedTick']>0 and r['inferredTick']==r['cachedPredictedTick'] for r in ramp),
          zeroCachedPredictionRows=sum(r['cachedPredictedTick']==0 for r in ramp), details=ramp),
       findings=[
        'Sampled current time gives the same tick as the raw global field in all rows, so it does not recover the scoped command clock.',
        'The game-rules pause values are already present in the sway capture and are all zero/disabled here; they cannot explain the one-tick differences.',
        'The positive prediction-cache diagnostic agrees in its observed ramp rows, but that cache is not the bound body timer input and is zero in other ramp rows.',
       ], limits=[
        'The controller tick base and active command-phase markers were not captured.',
        'Observed prediction-cache agreement does not establish a production mapping or justify command-number offsets.',
        'The retained post-call state projection still has the documented final-loop-step/Idle transition ambiguity.',
       ])
    output = ROOT/'reports/reaudit-body-clock/capture-diagnostics.json'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2)+'\n')
    (REPO/'docs/evidence/reaudit-body-clock-diagnostics.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps({k:v for k,v in result.items() if k not in ['rampDiagnostics']}, indent=2))
    print(json.dumps({k:v for k,v in result['rampDiagnostics'].items() if k != 'details'}))

if __name__ == '__main__': main()
