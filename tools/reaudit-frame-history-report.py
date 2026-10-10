"""Freeze and analyze the approved runtime008 frame-history captures.

Raw snapshots stay local. The portable fixture allowlists numeric fields and
deduplicates published records; it contains no addresses, guards or memory bytes.
Polling associations are reported as observations, never a native call trace.
"""
import argparse
import collections
import hashlib
import json
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
AUDIT = REPO.parent/'native-audit'
NAMES = ['native_reaudit_history_001', 'native_reaudit_bob_007']


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1048576): h.update(chunk)
    return h.hexdigest()


def extract():
    directory = AUDIT/'reports/reaudit-motion-runtime-008'
    finished = json.loads((directory/'sampler-finished.json').read_text())
    assert finished['exitCode'] == 0 and not finished['stoppedByFile']
    launch = json.loads((directory/'launch.json').read_text())
    assert digest(directory/'sampler.py') == launch['samplerSha256']
    for name, sha in launch['helperHashes'].items(): assert digest(directory/'helpers'/name) == sha
    cases = []
    raw_hash = hashlib.sha256()
    handles = []
    pools = []
    offset_pools = []
    for name in NAMES:
        capture = json.loads((AUDIT/'reports'/f'{name}-capture.json').read_text())
        assert capture['inputResult'] == 0 and capture['recorderResult'] == 0
        cases.append(dict(name=name, start=capture['start']['monotonic'], end=capture['stop']['monotonic'], rows=[], presentedRecords=[], velocityOffsetRecords=[]))
        handles.append(tempfile.NamedTemporaryFile(mode='wb', dir=directory, prefix=f'{name}-snapshot-', suffix='.pending', delete=False))
        pools.append({})
        offset_pools.append({})
    try:
        with (directory/'samples.jsonl').open('rb') as source:
            for line in source:
                raw_hash.update(line)
                row = json.loads(line)
                for case, output, pool, offset_pool in zip(cases, handles, pools, offset_pools):
                    if not case['start'] <= row['monotonic'] <= case['end']: continue
                    output.write(line)
                    extra = row['extra']
                    f = extra['frameHistory']['fields']
                    record_ids = []
                    for record in f['presented']:
                        key = json.dumps(record, sort_keys=True)
                        if key not in pool:
                            pool[key] = len(case['presentedRecords'])
                            case['presentedRecords'].append(record)
                        record_ids.append(pool[key])
                    # The launch-version reader already guarded this native
                    # header but did not expose its early-return flag by name.
                    header = bytes.fromhex(extra['frameHistory']['guardBlocks'][3][1])
                    assert len(header) == 48
                    offset = extra['velocityOffset']['fields']
                    offset_key = json.dumps(offset, sort_keys=True)
                    if offset_key not in offset_pool:
                        offset_pool[offset_key] = len(case['velocityOffsetRecords'])
                        case['velocityOffsetRecords'].append(offset)
                    clock_keys = ['sampledPredictionTick', 'sampledGlobalTick', 'sampledGlobalCurrentTime',
                                  'sampledGlobalFrameDelta', 'sampledGlobalFraction', 'cameraStoredPunch', 'cameraAnchor',
                                  'primaryAttackIndex', 'secondaryAttackIndex', 'inputCount', 'lastInputFrame', 'lastPrimaryFrame',
                                  'latestPrimaryTransitionDown', 'latestSecondaryTransitionDown', 'processedTransitionCount']
                    compact = {k: f[k] for k in clock_keys}
                    compact.update(elapsed=row['monotonic']-case['start'], frame=row['frame'], currentTime=row['currentTime'],
                                   rawTick=row['tick'], inputReadDisabled=bool(header[1]),
                                   presentedRecordIds=record_ids, presentedSlot=f['presentedSlot'], inputEntries=f['inputEntries'],
                                   controllerTick=extra['bodyClock']['fields'].get('bodyClockControllerTickBase'),
                                   controllerActive=extra['bodyClock']['fields']['bodyClockProcessingControllerMatches'],
                                   transformValid=extra['transformHistory']['fields']['transformHistoryValid'],
                                   transformReason=extra['transformHistory']['fields'].get('transformHistoryReason'),
                                   velocityOffsetRecordId=offset_pool[offset_key])
                    case['rows'].append(compact)
    finally:
        for output in handles: output.close()
    for case, output in zip(cases, handles):
        temporary = Path(output.name)
        snapshot = directory/f"{case['name']}-snapshot.jsonl"
        if snapshot.exists():
            assert digest(snapshot) == digest(temporary), 'Retained snapshot differs; preserve both files for inspection'
            temporary.unlink()
        else:
            temporary.replace(snapshot)
    for case in cases:
        assert case['rows']
        case['snapshotSha256'] = digest(directory/f"{case['name']}-snapshot.jsonl")
        case['captureMetadataSha256'] = digest(AUDIT/'reports'/f"{case['name']}-capture.json")
        case['duration'] = case.pop('end')-case.pop('start')
    fixture = dict(format='reaudit-frame-history-v1', sourceSha256=raw_hash.hexdigest(),
                   clientSha256=launch['clientSha256'], engineSha256=json.loads((directory/'extensions.json').read_text())['engineSha256'],
                   samplerSha256=launch['samplerSha256'], helperHashes=launch['helperHashes'], finished=finished, cases=cases,
                   provenance='Owned offline game, read-only guarded polling; published records deduplicated by complete numeric value.',
                   limits=['No native invocation trace or atomic cross-object snapshot.', 'No physical scanout or input latency claim.',
                           'Input array may be before or after serialization/reduction; the sampling phase is unknown.',
                           'TransformHistory data were rejected because the live node subclass was not yet in the bound allowlist.',
                           'Original input early-return flag decoded from the preserved, guarded input header.'])
    # Remove the historical process identifier from the portable lifecycle data.
    fixture['finished'] = {k:v for k,v in finished.items() if k != 'pid'}
    destination = REPO/'docs/evidence/reaudit-frame-history-fixture.json'
    destination.write_text(json.dumps(fixture, separators=(',', ':'), allow_nan=False)+'\n')
    return fixture, destination


def analyze(fixture):
    results = []
    for case in fixture['cases']:
        rows, records = case['rows'], case['presentedRecords']
        selected_entries, entry_matches, entry_absent, entry_different = [], 0, 0, 0
        unique_input_records = set()
        changes, last_anchor, latest_selected = [], None, None
        offsets = collections.Counter()
        for i, row in enumerate(rows):
            lookup = collections.defaultdict(list)
            for index in row['presentedRecordIds']:
                record = records[index]
                lookup[record['frame']].append(record)
            for entry in row['inputEntries']:
                unique_input_records.add(json.dumps(entry, sort_keys=True))
                candidates = lookup[entry['frame']]
                if not candidates: entry_absent += 1
                elif any(entry['render'] == v['render'] and entry['player'] == v['player'] for v in candidates): entry_matches += 1
                else: entry_different += 1
            primary = row['primaryAttackIndex']
            if 0 <= primary < len(row['inputEntries']):
                entry = row['inputEntries'][primary]
                key = (entry['frame'], entry['player']['tick'], entry['player']['fraction'])
                if key != latest_selected:
                    latest_selected = key
                    selected_entries.append(dict(elapsed=row['elapsed'], frame=entry['frame'], player=entry['player'], render=entry['render'], disabled=row['inputReadDisabled']))
            anchor = row['cameraAnchor']
            key = (anchor['tick'], anchor['fraction'])
            if last_anchor is not None and key != last_anchor:
                # Compare every retained selected edge before this observed
                # camera change. This is an association, not shot-resolution proof.
                prior = [e for e in selected_entries if 0 <= row['elapsed']-e['elapsed'] <= 1]
                matches = [e for e in prior if e['player'] == anchor]
                changes.append(dict(elapsed=row['elapsed'], anchor=anchor, storedPunch=row['cameraStoredPunch'],
                                    rawTick=row['rawTick'], predictionTick=row['sampledPredictionTick'], controllerTick=row['controllerTick'],
                                    matchingPriorSelectedEdges=matches, recentSelectedEdges=prior,
                                    retainedPreviousAnchor=dict(tick=last_anchor[0], fraction=last_anchor[1])))
            last_anchor = key
            f = case['velocityOffsetRecords'][row['velocityOffsetRecordId']]
            offsets[json.dumps({'valid':f['velocityOffsetValid'], 'rings':f['velocityOffsetRings'], 'groups':f['velocityOffsetGroupPairs']}, sort_keys=True)] += 1
        gaps = [b['elapsed']-a['elapsed'] for a,b in zip(rows,rows[1:])]
        results.append(dict(name=case['name'], rows=len(rows), uniquePresentedRecords=len(records), maxNumericGap=max(gaps),
                            uniqueInputRecords=len(unique_input_records),
                            inputReadDisabledRows=sum(r['inputReadDisabled'] for r in rows),
                            inputEntryPublishedPairMatches=entry_matches, inputEntryFramesAbsentFromSampledRing=entry_absent,
                            inputEntryPublishedPairDifferences=entry_different, selectedPrimaryEdges=selected_entries,
                            observedCameraAnchorChanges=changes,
                            transformValidRows=sum(r['transformValid'] for r in rows),
                            transformRejections=dict(collections.Counter(r['transformReason'] for r in rows)),
                            velocityOffsetStates=[dict(state=json.loads(k), rows=v)for k,v in offsets.items()]))
    return results


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--fixture', type=Path, help='Reanalyze an existing portable fixture without raw capture files')
    args = p.parse_args()
    fixture, path = (json.loads(args.fixture.read_text()), args.fixture) if args.fixture else extract()
    report = dict(fixtureSha256=digest(path), probeSha256=digest(Path(__file__)), cases=analyze(fixture), limits=fixture['limits'])
    out = REPO/'docs/evidence/reaudit-frame-history-runtime.json'
    out.write_text(json.dumps(report, indent=2)+'\n')
    for case in report['cases']:
        print(json.dumps({k:v for k,v in case.items()if k not in ['selectedPrimaryEdges','observedCameraAnchorChanges','velocityOffsetStates']} |
                         {'selectedPrimaryEdges':len(case['selectedPrimaryEdges']), 'cameraAnchorChanges':len(case['observedCameraAnchorChanges']),
                          'anchorChangesMatchingRecentPrimary':sum(bool(r['matchingPriorSelectedEdges'])for r in case['observedCameraAnchorChanges'])}))


if __name__ == '__main__': main()
