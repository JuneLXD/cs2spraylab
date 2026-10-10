"""Replay fixed numeric sway captures, streaming one row at a time.

No process memory, native code, browser, Node or game is opened. Capture
coherence checks are preserved; samples cannot establish unseen call counts.
Run under MemoryMax=512M, MemorySwapMax=0, CPUQuota=100% on this host.
"""
import argparse
import collections
import hashlib
import json
import math
import shlex
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--capture', type=Path, default=ROOT / 'reports/reaudit-motion-runtime-003')
parser.add_argument('--out', type=Path, default=ROOT / 'reports/reaudit-sway-clock-inputs')
parser.add_argument('--label', help='Output report prefix; defaults to capture-directory suffix')
parser.add_argument('--requested-cap', type=int, help='Requested cap label for additional windows; never an observed cadence')
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
report_label = args.label or args.capture.name.removeprefix('reaudit-motion-')
assert report_label and all(c.isalnum() or c in '-_' for c in report_label)
F = lambda value: struct.unpack('<f', struct.pack('<f', value))[0]


def error(a, b):
    return max(abs(x-y) for x, y in zip(a, b))


def wrap(value):
    if -180 <= value <= 180:
        return value
    return min(180, max(-180, F(value-F(360*math.floor(F(F(value*F(1/360))+.5))))))


def stats(values):
    if not values:
        return {'count': 0}
    values = sorted(values)
    return dict(count=len(values), min=values[0], max=values[-1],
                median=values[len(values)//2], exact=sum(value == 0 for value in values),
                above1e5=sum(abs(value) > 1e-5 for value in values))


def clock(fields):
    now = fields['globalCurrentTime']
    if fields['clockDomainSelector'] or not fields['clockControllerPresent']:
        return now, 'global'
    if not fields['clockDefaultConverter']:
        return None, 'unmodeled_converter'
    offset, ceiling = fields['clockOffsetTicks'], fields['clockCeilingTick']
    if fields['clockCeilingEnabled'] and ceiling > 0 and now >= F(F(ceiling)*F(1/64)):
        return F(F(ceiling-offset)*F(1/64)), 'controller_ceiling'
    return F(now-F(F(offset)*F(1/64))), 'controller_offset'


def prediction_clock(fields):
    tick = fields.get('cachedPredictedTick', 0)
    if tick <= 0:
        return F(F(fields['globalTick'])*F(1/64)), 'global_integer'
    fraction = fields['globalPlayerFraction'] if fields['globalFrameDelta'] != 0 else 0
    # Current captured finite ordinary normalized fractions need no carry.
    assert 0 <= fraction < 1
    return F(F(F(tick)*F(1/64))+F(F(fraction)*F(1/64))), 'predicted_fraction' if fraction else 'predicted_integer'


def angle_source(fields):
    if not fields['predictionInterpolation']:
        return 'raw'
    mode, state = fields['interpolationMode'], fields['interpolationState']
    alternate = bool(fields['sourceAngleCacheFlags'][0] & 0x20)
    if mode == -1 or mode == 0 and state == 1:
        return 'cache0'
    if mode == 0 and alternate:
        return 'cache1'
    if mode == 1 and state == 1:
        return 'cache1' if alternate else 'cache0'
    return 'raw'


def selected_angle(fields):
    selected = angle_source(fields)
    return fields[{'raw':'sourceAngles','cache0':'sourceAngleCache0','cache1':'sourceAngleCache1'}[selected]], selected


def source_availability(fields, selected):
    if selected == 'raw':
        return 'raw', None
    slot = int(selected[-1])
    requested = fields['interpolationTimes'][(fields['sourceAngleCacheFlags'][0] >> 7) & 1]
    return ('cache_time_match' if fields['sourceAngleCacheTimes'][slot] == requested else 'cache_stale'), requested


manifest_raw = (args.capture / 'snapshot-manifest.json').read_bytes()
manifest = json.loads(manifest_raw)
reports = []
for name, window in manifest['windows'].items():
    source = args.capture / window['snapshot']
    assert source.stat().st_size < 128*1024*1024
    sha = hashlib.sha256()
    counts = collections.Counter()
    branches = collections.defaultdict(collections.Counter)
    errors = collections.defaultdict(list)
    examples = collections.defaultdict(list)
    previous = None
    frames = set()
    cadence = collections.defaultdict(list)
    previous_hud_frame = None
    first = last = None
    event_path = args.out / (name + '-transitions.jsonl')
    with source.open('rb') as stream, event_path.open('w') as events:
        for raw in stream:
            sha.update(raw)
            row = json.loads(raw)
            fields = row['extra']['swayInputs']['fields']
            counts['rows'] += 1
            first = row['monotonic'] if first is None else first
            last = row['monotonic']
            frames.add(row['frame'])
            coherence = all(row[key] == fields[key] for key in ('sourceAngles','historyTimes','historyAngles','pawnSwayRate','predictionInterpolation'))
            coherence &= row['currentTime'] == fields['globalCurrentTime'] and row['frame'] == fields['globalFrame'] and row['frameDelta'] == fields['globalFrameDelta']
            counts['rowFieldCoherenceFailures'] += not coherence
            if not coherence and len(examples['rowFieldCoherenceFailures']) < 8:
                examples['rowFieldCoherenceFailures'].append(dict(row=counts['rows'],frame=row['frame'],
                    outerCurrentTime=row['currentTime'],helperCurrentTime=fields['globalCurrentTime']))
            writer_now, clock_kind = clock(fields)
            predicted_now, prediction_kind = prediction_clock(fields)
            angle, angle_kind = selected_angle(fields)
            availability, requested_cache_time = source_availability(fields, angle_kind)
            for key, value in dict(clock=clock_kind, prediction=prediction_kind, angle=angle_kind,
                interpolationMode=fields['interpolationMode'], interpolationState=fields['interpolationState'],
                clockDomain=fields['clockDomainSelector'], offsetTicks=fields.get('clockOffsetTicks'),
                ceilingTick=fields.get('clockCeilingTick'), ceilingEnabled=fields.get('clockCeilingEnabled'),
                historyCallerGate=fields['pawnHistoryCallerGate'], sourceGetterGate=fields['pawnSourceGetterGate'],
                helperMode=fields['interpolationHelperMode'], interpolation=fields['predictionInterpolation'],
                sourceAvailability=availability, sourceCacheTimes=fields['sourceAngleCacheTimes'],
                sourceHistoryPresent=fields['sourceAngleHistoryPresent']).items():
                branches[key][str(value)] += 1
            if previous is not None:
                old, old_fields, old_coherence = previous
                counts['globalClockBackwardTransitions'] += fields['globalCurrentTime'] < old_fields['globalCurrentTime']
                if row['frame'] != old['frame']:
                    cadence['observedFrameAdvance'].append(row['frame']-old['frame'])
                    counts['skippedFrameNumbers'] += max(0,row['frame']-old['frame']-1)
                changed = [i for i in range(4) if fields['historyTimes'][i] != old_fields['historyTimes'][i]]
                counts['historyChangedSlots_' + str(len(changed))] += 1
                if not changed and fields['historyAngles'] != old_fields['historyAngles']:
                    counts['historyAngleOnlyTransitions'] += 1
                if not changed and fields['pawnSwayRate'] != old_fields['pawnSwayRate']:
                    counts['rateOnlyTransitions'] += 1
                if len(changed) == 1 and coherence and old_coherence:
                    counts['singleSlotCoherentTransitions'] += 1
                    slot = changed[0]
                    sample_time = fields['historyTimes'][slot]
                    requested = F(sample_time-.0625)
                    exact = [i for i,t in enumerate(old_fields['historyTimes']) if t == requested]
                    kind = 'exact' if exact else 'before' if requested < min(old_fields['historyTimes']) else 'after' if requested > max(old_fields['historyTimes']) else 'bracket'
                    written = fields['historyAngles'][slot*3:slot*3+3]
                    event = dict(kind='history', row=counts['rows'], monotonic=row['monotonic'],
                        frame=row['frame'], historyTime=sample_time, writerClock=writer_now,
                        predictionClock=predicted_now, clockBranch=clock_kind, angleBranch=angle_kind,
                        sourceAvailability=availability,requestedSourceTime=requested_cache_time,
                        sampleKind=kind, oldestReplaced=old_fields['historyTimes'][slot] == min(old_fields['historyTimes']),
                        timeError=None if writer_now is None else sample_time-writer_now,
                        predictedTimeError=sample_time-predicted_now,
                        angleError=error(written, angle), rawAngleError=error(written, fields['sourceAngles']),
                        writtenAngle=written, selectedAngle=angle, observedRate=fields['pawnSwayRate'])
                    cadence['newHistoryTimeAdvance'].append(sample_time-max(old_fields['historyTimes']))
                    counts['newHistoryTimeOn64HzGrid'] += sample_time*64 == int(sample_time*64)
                    branches['historySourceAvailability'][availability] += 1
                    branches['writerClockRelation'][str(event['timeError'])] += 1
                    if availability != 'cache_stale':
                        errors['availableSourceAngleError'].append(event['angleError'])
                    candidates = dict(globalTick=F(fields['globalTick']/64),
                            contextTime0=fields['interpolationTimes'][0],contextTime1=fields['interpolationTimes'][1])
                    if fields['cachedPredictedTick'] > 0:
                        candidates['positivePredictedInteger'] = F(fields['cachedPredictedTick']/64)
                    for candidate_name, candidate in candidates.items():
                        errors['writtenTimeMinus_'+candidate_name].append(sample_time-candidate)
                    branches['historyKind'][kind] += 1
                    branches['historyAngleBranch'][angle_kind] += 1
                    counts['oldestReplacementFailures'] += not event['oldestReplaced']
                    for key in ('timeError','predictedTimeError','angleError','rawAngleError'):
                        if event[key] is not None:
                            errors[key].append(event[key])
                    if exact:
                        prior = old_fields['historyAngles'][exact[0]*3:exact[0]*3+3]
                        expected = [F(wrap(F(x-y))*16) for x,y in zip(written, prior)]
                        source_expected = [F(wrap(F(x-y))*16) for x,y in zip(angle, prior)]
                        event.update(rateError=error(expected,fields['pawnSwayRate']),
                                     sourceRateError=error(source_expected,fields['pawnSwayRate']))
                        errors['rateError'].append(event['rateError'])
                        errors['sourceRateError'].append(event['sourceRateError'])
                        counts['nonzeroRateTransitions'] += max(map(abs, fields['pawnSwayRate'])) > 1e-6
                    if event['timeError'] == 0:
                        counts['writerClockExactTransitions'] += 1
                        errors['angleErrorAtExactWriterClock'].append(event['angleError'])
                        if 'rateError' in event:
                            errors['rateErrorAtExactWriterClock'].append(event['rateError'])
                        branches['exactClockSourceAvailability'][availability] += 1
                    for key in ('timeError','angleError','rateError','sourceRateError'):
                        if event.get(key) and len(examples[key]) < 8:
                            examples[key].append(event)
                    events.write(json.dumps(event)+'\n')
                if row['swayTime'] != old['swayTime'] and coherence and old_coherence:
                    counts['hudTimeTransitions'] += 1
                    dt = F(row['swayTime']-old['swayTime'])
                    alpha = min(1,max(0,F(dt*15)))
                    expected = [F(x+F(F(t-x)*alpha)) for x,t in zip(old['swaySmooth'],row['swayTarget'])]
                    result = error(expected,row['swaySmooth'])
                    frame_advance = None if previous_hud_frame is None else row['frame']-previous_hud_frame
                    cadence['hudElapsed'].append(dt)
                    cadence['hudFrameDelta'].append(row['frameDelta'])
                    if frame_advance is not None:
                        cadence['hudFrameAdvance'].append(frame_advance)
                        errors['hudSmoothingAdjacentFrameError' if frame_advance == 1 else 'hudSmoothingFrameGapError'].append(result)
                    previous_hud_frame = row['frame']
                    errors['hudSmoothingError'].append(result)
                    errors['hudCurrentClockError'].append(row['swayTime']-fields['globalCurrentTime'])
                    target = [0,0,0] if row['flags']&0x20 else fields['pawnSwayRate']
                    errors['hudTargetError'].append(error(row['swayTarget'],target))
                    event = dict(kind='hud',row=counts['rows'],monotonic=row['monotonic'],frame=row['frame'],
                        dt=dt,alpha=alpha,error=result,frameAdvance=frame_advance,
                        old=old['swaySmooth'],target=row['swayTarget'],actual=row['swaySmooth'])
                    if result and len(examples['hudSmoothingError']) < 8:
                        examples['hudSmoothingError'].append(event)
                    events.write(json.dumps(event)+'\n')
                elif row['swaySmooth'] != old['swaySmooth']:
                    counts['hudSmoothChangedWithoutTimeChange'] += 1
            previous = row, fields, coherence
    assert sha.hexdigest() == window['snapshotSha256']
    assert counts['rows'] == window['rows']
    known_caps = {'native_reaudit_bob_002':60,'native_reaudit_bob_003':30}
    reports.append(dict(name=name,requestedCap=window.get('requestedCap',args.requested_cap if args.requested_cap is not None else known_caps.get(name)),
        snapshotSha256=sha.hexdigest(),snapshotBytes=source.stat().st_size,inputSha256=window['inputSha256'],
        seconds=last-first,frames=len(frames),counts=dict(counts),cadence={k:stats(v)for k,v in cadence.items()},
        branches={k:dict(v)for k,v in branches.items()},errors={k:stats(v)for k,v in errors.items()},
        examples=dict(examples),transitions=event_path.name))

report = dict(schemaVersion=2,method=__doc__,clientSha256=manifest['clientSha256'],
    sourceSha256=manifest['sourceSha256'],sourceBytes=manifest['sourceBytes'],
    manifestSha256=hashlib.sha256(manifest_raw).hexdigest(),
    scriptSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    productionChange=False,windows=reports,
    limits=['Coherence means captured duplicated fields agree and the producer guarded its blocks; no read-only polling scheme proves atomic observation of every native call.',
            'Only single-slot timestamp changes with coherent endpoints are used for direct writer replay; multi-slot and angle-only changes remain counted separately.',
            'A sample observed after a writer call can expose a later clock/cache phase. Nonzero clock/angle comparisons are retained and cannot alone refute the native call rule.',
            'Cache output is available only when its stored time equals the selected requested time. A stale lazy cache is recorded but excluded from available-source comparisons; the interpolation ring needed to evaluate it was not captured.',
            'Requested caps of 60 and 30 are capture labels only. Observed HUD cadence must be read from elapsed time and frame advances; this capture does not establish distinct 60 Hz and 30 Hz rendering.',
            'A HUD replay spanning a missing frame applies one smoothing step across multiple possible invocations, so its residual is a coverage limit, not a refutation.',
            'Interpolation history payload and alternate virtual getter gates were not captured; selecting a cache output is not a replay of its complete construction.',
            'No native instructions or production source are executed by this analysis.'])
path = args.out/(report_label+'-analysis.json')
path.write_text(json.dumps(report,indent=2)+'\n')
writer_count = sum(w['errors']['rateError']['count'] for w in reports)
writer_exact = sum(w['errors']['rateError']['exact'] for w in reports)
hud_count = sum(w['errors']['hudSmoothingError']['count'] for w in reports)
hud_exact = sum(w['errors']['hudSmoothingError']['exact'] for w in reports)
adjacent_count = sum(w['errors']['hudSmoothingAdjacentFrameError']['count'] for w in reports)
adjacent_exact = sum(w['errors']['hudSmoothingAdjacentFrameError']['exact'] for w in reports)
gap_residuals = sum(v['count']-v['exact'] for w in reports for k,v in w['errors'].items() if k == 'hudSmoothingFrameGapError')
command = ['systemd-run','--user','--scope','--quiet','-p','MemoryMax=512M','-p','MemorySwapMax=0',
           '-p','CPUQuota=100%','python3',str(Path(__file__).resolve()),'--capture',str(args.capture.resolve()),
           '--out',str(args.out.resolve()),'--label',report_label]
if args.requested_cap is not None:
    command += ['--requested-cap',str(args.requested_cap)]
findings = dict(schemaVersion=1, productionChange=False,
    scope='Offline replay of fixed owned numeric capture windows; no native execution',
    clientSha256=report['clientSha256'],sourceSha256=report['sourceSha256'],
    manifestSha256=report['manifestSha256'],scriptSha256=report['scriptSha256'],
    analysisSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
    evidence=['SC01-SC07 in findings.json', 'SH native history oracle, 37 cases retained separately',
              'snapshot-manifest.json and SHA-bound runtime windows'],
    observations=[
        f'Wrapped angle difference times16 reproduces {writer_exact}/{writer_count} accepted rates exactly. Per-window counts retain oldest-entry replacement and clock-grid coverage.',
        'All captured controller states use domain0, offset0, ceiling disabled and the default converter. Therefore the statically proved writer accessor returns global current time at the call. Later observed phases can expose different clocks.',
        'Every clock-exact new-write observation selects raw source angles. Both source-angle caches retain invalid time -1 in every row; their stale stored angles cannot replay a fresh lazy-cache evaluation.',
        f'HUD smoothing matches {hud_exact}/{hud_count} accepted updates, including {adjacent_exact}/{adjacent_count} adjacent-frame comparisons. Target/rate and timestamp/current-time comparisons are reported separately.',
        f'{gap_residuals} nonzero smoothing residuals cross missing frames. Uncaptured intermediate timestamps/states prevent exact multi-invocation replay from endpoints alone.',
        'Requested caps label configuration only; measured HUD elapsed times and frame advances establish observed cadence.'
    ],
    windows=[dict(name=w['name'],requestedCap=w['requestedCap'],rows=w['counts']['rows'],
        snapshotSha256=w['snapshotSha256'],inputSha256=w['inputSha256'],
        incoherentRows=w['counts']['rowFieldCoherenceFailures'],
        coherentSingleWrites=w['counts']['singleSlotCoherentTransitions'],
        multipleSlotTransitions=sum(w['counts'].get('historyChangedSlots_'+str(i),0) for i in (2,3,4)),
        exactWriterRates=w['errors']['rateError']['exact'],writerRateMaxError=w['errors']['rateError']['max'],
        snapshotClockExactWrites=w['counts']['writerClockExactTransitions'],
        availableRawSourceWrites=w['errors']['availableSourceAngleError']['count'],
        rawSourceAngleMaxError=w['errors']['availableSourceAngleError']['max'],
        staleCacheNewWriteObservations=w['branches']['historySourceAvailability'].get('cache_stale',0),
        hudUpdates=w['counts']['hudTimeTransitions'],exactHudUpdates=w['errors']['hudSmoothingError']['exact'],
        adjacentFrameHudComparisons=w['errors']['hudSmoothingAdjacentFrameError']['count'],
        adjacentFrameHudMaxError=w['errors']['hudSmoothingAdjacentFrameError']['max'],
        hudMaxError=w['errors']['hudSmoothingError']['max'],
        hudMedianElapsed=w['cadence']['hudElapsed']['median'],
        globalClockBackwardTransitions=w['counts']['globalClockBackwardTransitions'],
        missedFrameNumbers=w['counts']['skippedFrameNumbers']) for w in reports],
    remainingMetadata=[
        'Caller and prediction-phase identity at each source-angle/history write, including same-state duplicate calls and any writes missed by polling.',
        'Unrounded source-angle input before the observed raw QAngle update; the remaining at most 0.000167847 degree difference is retained rather than fitted.',
        'The source getter global alternate-path gates and related entity/transform state when selected.',
        'If cache selection is live in another state: source interpolation-ring payload and evaluated endpoint/time pair; these windows never contain a valid cache timestamp.',
        'Input event/prediction/presentation ordering mapping trainer128Hz inputs to native64Hz history writes. A 64Hz grid alone does not identify the source phase.',
        'Nonzero controller offset, ceiling, nondefault converter and alternative domains were not observed; no runtime parity claim extends to them.'
    ],
    limits=report['limits'],
    reproduce=shlex.join(command))
(args.out/(report_label+'-findings.json')).write_text(json.dumps(findings,indent=2)+'\n')
print(json.dumps({**{k:v for k,v in report.items()if k!='windows'},
                  'windows':[{k:v for k,v in r.items()if k!='examples'}for r in reports]},indent=2))
