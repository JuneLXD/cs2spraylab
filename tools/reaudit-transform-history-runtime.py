"""Stream an immutable TransformHistory capture; compatibility, not call replay.

No process access, native invocation, clock fitting or velocity-layout reuse.
Run only after the capture slot is released, under 512 MiB / CPU100.
"""
import argparse
import collections
import hashlib
import json
import math
import os
import struct
import tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]/'native-audit'
MAX_ROWS=50000
MAX_EXAMPLES=12
TRANSFORM_KEYS=('localOrigin','localOriginW','localQuaternion','worldOrigin','worldOriginW',
                'worldQuaternion','localScale','worldScale','parentIdentityOrdinal',
                'attachmentOrdinal','forceWorld','flag55')
CLIENT_SHA256='eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
READER_SHA256='1b1d12dcc28974766a87e6da86467a0af96a32529860063bd323064970063cdb'
FORMAT='spraylab-transform-history-numeric-v1'
COMPACT_FORMAT='spraylab-transform-history-compact-v1'
FIELD_KEYS=('transformHistoryValid','transformHistoryClassBound','transformHistoryCallbacksBound',
    'transformWrapperFlags','transformHasParent','transformSceneLocalAngles','transformSceneLocalScale',
    'transformSceneAbsoluteOrigin','transformSceneAbsoluteAngles','transformSceneAbsoluteScale',
    'transformSceneEvaluatedLocalOrigin','transformSceneEvaluatedLocalAngles','transformSceneEvaluatedLocalScale',
    'transformSceneFlags','transformSceneDirty','transformCubicGlobalFlag','transformPastNewestGateTick',
    'transformPastNewestGateEnabled','transformQuaternionZeroNormFallback','transformInvocationArgumentsCaptured')
RECORD_KEYS=('localOrigin','localOriginW','localQuaternion','worldOrigin','worldOriginW','worldQuaternion',
    'localScale','worldScale','parentIdentityMatchesNode','parentIdentityIsInvalid','attachmentMatchesNode','forceWorld','flag55')
RING_KEYS=('head','components','count','capacity','freeMask','validityTick','offsetTicks','timeOffset','copyWholeValue')
ROW_KEYS=('monotonic','frame','tick','currentTime','frameDelta','pawnTransform','identityOrdinal')
SCENE_KEYS=FIELD_KEYS+('transformParentIdentityOrdinal','transformAttachmentOrdinal')
VALUE_KEYS=RECORD_KEYS+('parentIdentityOrdinal','attachmentOrdinal')
ENTRY_KEYS=('logical','physical','tick','valueIndex')


class Compact:
    """Intern complete semantic values/rings; preserve every numeric row field."""
    def __init__(self,provenance):
        self.provenance=provenance
        self.records=[];self.rings=[];self.rows=[]
        self.record_ids={};self.ring_ids={}

    @staticmethod
    def intern(value,values,ids):
        key=json.dumps(value,separators=(',',':'),allow_nan=False)
        if key not in ids:
            if len(values)>=65536:raise ValueError('Compact table exceeds bounded distinct-value count')
            ids[key]=len(values);values.append(value)
        return ids[key]

    def record(self,value):
        if set(value)!=set(VALUE_KEYS):raise ValueError('Unexpected semantic record fields')
        return self.intern([value[key] for key in VALUE_KEYS],self.records,self.record_ids)

    def add(self,row):
        if set(row)!=set(ROW_KEYS)|{'extra'}:raise ValueError('Unexpected portable row fields')
        fields=row['extra']['transformHistory']['fields']
        if not fields.get('transformHistoryValid'):raise ValueError('Compact export currently requires valid TransformHistory rows')
        if set(fields)!=set(SCENE_KEYS)|{'transformCurrentRecord','transformHistoryRings'}:
            raise ValueError('Unexpected scene fields')
        current=self.record(fields['transformCurrentRecord'])
        ring_ids=[]
        for ring in fields['transformHistoryRings']:
            entries=[[entry[key] for key in ENTRY_KEYS]+[self.record(entry['value'])] for entry in ring['entries']]
            value=[[ring[key] for key in RING_KEYS],entries]
            ring_ids.append(self.intern(value,self.rings,self.ring_ids))
        self.rows.append([[row[key] for key in ROW_KEYS],[fields[key] for key in SCENE_KEYS],current,ring_ids])
        if len(self.rows)>MAX_ROWS:raise ValueError('Compact row limit exceeded')

    def data(self):
        return dict(format=COMPACT_FORMAT,provenance=self.provenance,
            columns=dict(row=ROW_KEYS,scene=SCENE_KEYS,record=VALUE_KEYS,ring=RING_KEYS,entry=ENTRY_KEYS),
            records=self.records,rings=self.rings,rows=self.rows)


def expand_compact(data):
    assert data['format']==COMPACT_FORMAT
    assert data['columns']==dict(row=list(ROW_KEYS),scene=list(SCENE_KEYS),record=list(VALUE_KEYS),ring=list(RING_KEYS),entry=list(ENTRY_KEYS))
    if len(data['rows'])>MAX_ROWS or len(data['records'])>65536 or len(data['rings'])>65536:
        raise ValueError('Oversized compact fixture')
    records=[]
    for values in data['records']:
        if len(values)!=len(VALUE_KEYS):raise ValueError('Invalid compact record width')
        records.append(dict(zip(VALUE_KEYS,values)))
    rings=[]
    def value(index):
        if not isinstance(index,int) or not 0<=index<len(records):raise ValueError('Invalid compact record reference')
        return records[index]
    for headers,entries in data['rings']:
        if len(headers)!=len(RING_KEYS) or len(entries)>32:raise ValueError('Invalid compact ring shape')
        ring=dict(zip(RING_KEYS,headers));ring['entries']=[]
        for entry in entries:
            if len(entry)!=len(ENTRY_KEYS)+1:raise ValueError('Invalid compact entry width')
            ring['entries'].append(dict(zip(ENTRY_KEYS,entry[:-1]),value=value(entry[-1])))
        rings.append(ring)
    for values,scene,current,indices in data['rows']:
        if len(values)!=len(ROW_KEYS) or len(scene)!=len(SCENE_KEYS) or not 1<=len(indices)<=2:
            raise ValueError('Invalid compact row shape')
        if not all(isinstance(i,int) and 0<=i<len(rings) for i in indices):raise ValueError('Invalid compact ring reference')
        row=dict(zip(ROW_KEYS,values));fields=dict(zip(SCENE_KEYS,scene))
        fields.update(transformCurrentRecord=value(current),transformHistoryRings=[rings[i] for i in indices])
        row['extra']={'transformHistory':{'fields':fields}}
        yield row


class Sanitize:
    """Allowlist numeric values; replace identity tokens by stable ordinals."""
    def __init__(self):
        self.identities={}
        self.parents={}
        self.attachments={}

    @staticmethod
    def ordinal(table,key):
        if key not in table:table[key]=len(table)
        return table[key]

    def record(self,value):
        result={key:value[key] for key in RECORD_KEYS}
        result['parentIdentityOrdinal']=self.ordinal(self.parents,tuple(value['parentIdentityWords']))
        result['attachmentOrdinal']=self.ordinal(self.attachments,value['attachmentToken'])
        return result

    def row(self,row):
        transform=row.get('extra',{}).get('transformHistory',{})
        source=transform.get('fields',{})
        fields={key:source[key] for key in FIELD_KEYS if key in source}
        identity=(row.get('pawnEntity'),tuple(x[0] for x in transform.get('guardBlocks',[])[:3]))
        result={key:row[key] for key in ('monotonic','frame','tick','currentTime','frameDelta','pawnTransform')}
        result['identityOrdinal']=self.ordinal(self.identities,identity)
        result['extra']={'transformHistory':{'fields':fields}}
        if not fields.get('transformHistoryValid'):return result
        fields['transformParentIdentityOrdinal']=self.ordinal(self.parents,tuple(source['transformParentIdentityWords']))
        fields['transformAttachmentOrdinal']=self.ordinal(self.attachments,source['transformAttachmentToken'])
        fields['transformCurrentRecord']=self.record(source['transformCurrentRecord'])
        fields['transformHistoryRings']=[]
        for ring in source['transformHistoryRings']:
            saved={key:ring[key] for key in RING_KEYS}
            saved['entries']=[dict(logical=x['logical'],physical=x['physical'],tick=x['tick'],valueIndex=x['valueIndex'],
                                   value=self.record(x['value'])) for x in ring['entries']]
            fields['transformHistoryRings'].append(saved)
        return result


def signature(value):
    """Float32 values and equality-preserving identity ordinals; no padding."""
    scalars=(*value['localOrigin'],value['localOriginW'],*value['localQuaternion'],
             *value['worldOrigin'],value['worldOriginW'],*value['worldQuaternion'],
             value['localScale'],value['worldScale'])
    return struct.pack('<18f2IBB',*scalars,value['parentIdentityOrdinal'],
                       value['attachmentOrdinal'],value['forceWorld'],value['flag55'])


def consumer_choice(fields,current):
    if fields['transformHasParent']:return None
    return 'world' if current['forceWorld'] or not current['parentIdentityIsInvalid'] else 'local'


def euler_quaternion(angles):
    # Conventional Source pitch/yaw/roll conversion, evaluated in Python
    # double precision only. Diagnostic orientation comparison, not a replay
    # of the float32 native conversion helper or its exact tolerance gate.
    p,y,r=[math.radians(x)/2 for x in angles]
    sp,cp,sy,cy,sr,cr=math.sin(p),math.cos(p),math.sin(y),math.cos(y),math.sin(r),math.cos(r)
    return [sr*cp*cy-cr*sp*sy,cr*sp*cy+sr*cp*sy,cr*cp*sy-sr*sp*cy,cr*cp*cy+sr*sp*sy]


def quaternion_distance(a,b):
    na,nb=math.sqrt(sum(x*x for x in a)),math.sqrt(sum(x*x for x in b))
    if na==0 or nb==0:return None
    dot=abs(sum(x*y for x,y in zip(a,b)))/(na*nb)
    return math.degrees(2*math.acos(min(1,max(0,dot))))


def same_vector(a,b):
    return struct.pack('<'+str(len(a))+'f',*a)==struct.pack('<'+str(len(b))+'f',*b)


def example(row,fields):
    current=fields['transformCurrentRecord']
    return dict(monotonic=row['monotonic'],frame=row['frame'],tick=row['tick'],
        parentless=not fields['transformHasParent'],dirty=fields['transformSceneDirty'],
        choiceIfInvokedNow=consumer_choice(fields,current),
        current={key:current[key] for key in TRANSFORM_KEYS},
        evaluatedOrigin=fields['transformSceneEvaluatedLocalOrigin'],
        evaluatedAngles=fields['transformSceneEvaluatedLocalAngles'],
        absoluteOrigin=fields['transformSceneAbsoluteOrigin'],
        absoluteAngles=fields['transformSceneAbsoluteAngles'])


class Stats:
    def __init__(self):
        self.rows=self.valid=0
        self.invalid=collections.Counter()
        self.counts=collections.Counter()
        self.flags=collections.Counter()
        self.shapes=collections.Counter()
        self.matches=collections.Counter()
        self.choices=collections.Counter()
        self.metrics={}
        self.transitions=collections.Counter()
        self.transition_examples=[]
        self.previous=None
        self.first=self.last=None
        self.frames=set()

    def metric(self,key,value,row,fields):
        if value is None:
            self.counts[key+'Unavailable']+=1
            return
        assert math.isfinite(value)
        metric=self.metrics.setdefault(key,dict(samples=0,minimum=value,maximum=value,sum=0,maximumExample=None))
        metric['samples']+=1
        metric['sum']+=value
        metric['minimum']=min(metric['minimum'],value)
        if value>=metric['maximum']:
            metric['maximum']=value
            metric['maximumExample']=example(row,fields)

    def add(self,row):
        self.rows+=1
        if self.rows>MAX_ROWS:raise ValueError('Capture exceeds bounded row count')
        fields=row.get('extra',{}).get('transformHistory',{}).get('fields',{})
        if not fields.get('transformHistoryValid'):
            self.invalid[fields.get('transformHistoryReason','reader absent')]+=1
            self.previous=None
            return
        if fields.get('transformInvocationArgumentsCaptured') is not False:
            raise ValueError('Unexpected invocation-association schema; review before analysis')
        current=fields['transformCurrentRecord']
        rings=fields['transformHistoryRings']
        if not 1<=len(rings)<=2:raise ValueError('Unsupported ring count')
        self.valid+=1
        self.frames.add(row['frame'])
        self.first=row['monotonic'] if self.first is None else self.first
        self.last=row['monotonic']
        self.flags[tuple(fields['transformWrapperFlags'])]+=1
        choice=consumer_choice(fields,current)
        self.choices[str(choice)]+=1
        self.counts['parented']+=fields['transformHasParent']
        self.counts['sceneDirty']+=fields['transformSceneDirty']
        self.counts['forceWorld']+=current['forceWorld']
        self.counts['flag55']+=current['flag55']
        self.counts['currentParentIdentityMatchesNode']+=current['parentIdentityMatchesNode']
        self.counts['currentAttachmentMatchesNode']+=current['attachmentMatchesNode']
        self.counts['wrapperAllowsThirdPoint']+=not bool(fields['transformWrapperFlags'][0]&1)
        self.counts['sampledCubicGlobalEnabled']+=fields['transformCubicGlobalFlag']
        self.counts['sampledPastNewestGateEnabled']+=fields['transformPastNewestGateEnabled']
        current_sig=signature(current)
        exact_matches=[]
        ring_summary=[]
        for context,ring in enumerate(rings):
            if not 0<=ring['count']<=ring['capacity']<=32 or ring['components']!=1:
                raise ValueError('Unsupported ring shape')
            if len(ring['entries'])!=ring['count']:raise ValueError('Truncated history entries')
            self.shapes[(context,ring['count'],ring['capacity'],ring['offsetTicks'],ring['timeOffset'])]+=1
            ticks=[entry['tick'] for entry in ring['entries']]
            self.counts['ringsWithAtLeastTwoEntries']+=len(ticks)>=2
            self.counts['multiEntryRingsStrictlyDescendingTicks']+=len(ticks)>=2 and all(a>b for a,b in zip(ticks,ticks[1:]))
            self.counts['ringsWithDuplicateTicks']+=len(ticks)!=len(set(ticks))
            values=[]
            for entry in ring['entries']:
                if not 0<=entry['valueIndex']<ring['capacity']:raise ValueError('Invalid history value index')
                sig=signature(entry['value'])
                values.append((entry['tick'],sig))
                if sig==current_sig:exact_matches.append((context,entry['logical'],entry['tick']))
            ring_summary.append(tuple(values))
            if ring['entries']:
                newest=ring['entries'][0]['value']
                self.counts[f'currentMatchesNewestLocalPosition_context{context}']+=same_vector(current['localOrigin'],newest['localOrigin'])
                self.counts[f'currentMatchesNewestWorldPosition_context{context}']+=same_vector(current['worldOrigin'],newest['worldOrigin'])
        self.matches[len(exact_matches)]+=1
        self.counts['matchesAnyRecordedSemanticValue']+=bool(exact_matches)
        self.counts['matchesMoreThanOneRecordedSemanticValue']+=len(exact_matches)>1
        local_origin=fields['transformSceneEvaluatedLocalOrigin']
        absolute_origin=fields['transformSceneAbsoluteOrigin']
        self.counts['currentLocalPositionEqualsEvaluatedScene']+=same_vector(current['localOrigin'],local_origin)
        self.counts['currentWorldPositionEqualsAbsoluteScene']+=same_vector(current['worldOrigin'],absolute_origin)
        self.counts['currentLocalScaleEqualsDeclaredSceneScale']+=same_vector([current['localScale']],[fields['transformSceneLocalScale']])
        self.metric('localPositionVsEvaluatedSceneMaxComponentUnits',max(abs(a-b) for a,b in zip(current['localOrigin'],local_origin)),row,fields)
        self.metric('worldPositionVsAbsoluteSceneMaxComponentUnits',max(abs(a-b) for a,b in zip(current['worldOrigin'],absolute_origin)),row,fields)
        self.metric('localQuaternionVsEvaluatedEulerDiagnosticDegrees',quaternion_distance(current['localQuaternion'],euler_quaternion(fields['transformSceneEvaluatedLocalAngles'])),row,fields)
        self.metric('worldQuaternionVsAbsoluteEulerDiagnosticDegrees',quaternion_distance(current['worldQuaternion'],euler_quaternion(fields['transformSceneAbsoluteAngles'])),row,fields)
        node_quaternion=row.get('pawnTransform',[])[4:8]
        if len(node_quaternion)==4:
            self.metric('worldQuaternionVsNodeCachedQuaternionDegrees',quaternion_distance(current['worldQuaternion'],node_quaternion),row,fields)
            if choice in ('local','world'):
                self.metric('parentlessChosenQuaternionVsNodeCachedQuaternionDegrees',quaternion_distance(current[choice+'Quaternion'],node_quaternion),row,fields)
                self.counts['parentlessChosenQuaternionExactlyEqualsNodeCache']+=same_vector(current[choice+'Quaternion'],node_quaternion)
                self.metric('parentlessChosenPositionVsNodeCacheMaxComponentUnits',max(abs(a-b) for a,b in zip(current[choice+'Origin'],row['pawnTransform'][:3])),row,fields)
                self.counts['parentlessChosenPositionExactlyEqualsNodeCache']+=same_vector(current[choice+'Origin'],row['pawnTransform'][:3])
                dirty=fields['transformSceneDirty']
                self.counts[f'chosenPositionDiffersFromEvaluated_dirty{dirty}']+=not same_vector(current[choice+'Origin'],local_origin)
                self.counts[f'chosenPositionDiffersFromNodeCache_dirty{dirty}']+=not same_vector(current[choice+'Origin'],row['pawnTransform'][:3])
        self.metric('currentLocalQuaternionNorm',math.sqrt(sum(x*x for x in current['localQuaternion'])),row,fields)
        self.metric('currentWorldQuaternionNorm',math.sqrt(sum(x*x for x in current['worldQuaternion'])),row,fields)
        if choice in ('local','world'):
            self.metric('parentlessChosenPositionVsEvaluatedSceneMaxComponentUnits',max(abs(a-b) for a,b in zip(current[choice+'Origin'],local_origin)),row,fields)
        # Do not infer current-record writer, invocation count, request time,
        # selected context/endpoints or a clock shift from these transitions.
        identity=row['identityOrdinal']
        state=(current_sig,tuple(ring_summary),tuple(fields['transformSceneEvaluatedLocalAngles']),tuple(node_quaternion))
        if self.previous and identity==self.previous['identity']:
            delta=row['monotonic']-self.previous['time']
            self.metric('acceptedRowSpacingSeconds',delta,row,fields)
            changes=tuple(a!=b for a,b in zip(state,self.previous['state']))
            self.transitions[str(changes)]+=1
            if any(changes) and len(self.transition_examples)<MAX_EXAMPLES:
                self.transition_examples.append(dict(previousMonotonic=self.previous['time'],deltaSeconds=delta,
                    changed=dict(zip(('currentSemanticRecord','completeRingValues','evaluatedAngles','nodeQuaternion'),changes)),
                    sample=example(row,fields),exactHistoryMatches=[dict(context=c,logical=l,tick=t) for c,l,t in exact_matches]))
        elif self.previous:self.counts['identityTransitions']+=1
        self.previous=dict(identity=identity,time=row['monotonic'],state=state)

    def report(self):
        for metric in self.metrics.values():metric['mean']=metric.pop('sum')/metric['samples']
        return dict(totalRows=self.rows,acceptedTransformRows=self.valid,invalidReasons=dict(self.invalid),
            distinctFrames=len(self.frames),acceptedSpanSeconds=None if self.first is None else self.last-self.first,
            parentlessConsumerChoicesIfInvokedNow=dict(self.choices),counts=dict(self.counts),
            wrapperFlags=[dict(flags=list(key),rows=n) for key,n in sorted(self.flags.items())],
            ringShapes=[dict(context=k[0],count=k[1],capacity=k[2],offsetTicks=k[3],timeOffset=k[4],rows=n) for k,n in sorted(self.shapes.items())],
            exactRecordedValueMatchCounts=dict(sorted(self.matches.items())),metrics=self.metrics,
            observedChangePatterns=dict(self.transitions),transitionExamples=self.transition_examples)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    inputs=parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument('--capture',type=Path)
    inputs.add_argument('--fixture',type=Path)
    inputs.add_argument('--compact',type=Path)
    parser.add_argument('--sha256',required=True,help='Frozen input digest: raw snapshot or exported fixture')
    parser.add_argument('--launch',type=Path,help='Required for raw capture; defaults to capture directory launch.json')
    parser.add_argument('--export-fixture',type=Path,help='Optional portable numeric JSONL output, with provenance header')
    parser.add_argument('--export-compact',type=Path,help='Optional deduplicated numeric JSON output with shared semantic values/rings')
    parser.add_argument('--out',type=Path,required=True)
    args=parser.parse_args()
    input_path=args.capture or args.fixture or args.compact
    if args.out.resolve()==input_path.resolve():raise ValueError('Output cannot overwrite input')
    if args.export_fixture and args.export_fixture.resolve() in (input_path.resolve(),args.out.resolve()):
        raise ValueError('Fixture output cannot overwrite input or report')
    if args.export_compact and args.export_compact.resolve() in (input_path.resolve(),args.out.resolve(),args.export_fixture.resolve() if args.export_fixture else None):
        raise ValueError('Compact output cannot overwrite input, report or JSONL fixture')
    digest=hashlib.sha256()
    stats=Stats()
    sanitizer=Sanitize()
    temporary=None
    fixture_sha=None
    compact_sha=None
    compact_export=None
    try:
        with input_path.open('rb') as source:
            if args.capture:
                launch_path=args.launch or args.capture.parent/'launch.json'
                launch_raw=launch_path.read_bytes()
                launch=json.loads(launch_raw)
                assert launch['clientSha256']==CLIENT_SHA256
                assert hashlib.sha256((launch_path.parent/'sampler.py').read_bytes()).hexdigest()==launch['samplerSha256']
                assert launch['helperHashes']['reaudit-transform-history-capture-fields.py']==READER_SHA256
                # Bind each retained helper to its exact launch digest before
                # allowing a portable fixture to claim that provenance.
                for name,expected in launch['helperHashes'].items():
                    if Path(name).name!=name:raise ValueError('Invalid helper name')
                    assert hashlib.sha256((launch_path.parent/'helpers'/name).read_bytes()).hexdigest()==expected
                provenance=dict(format=FORMAT,sourceSnapshotName=args.capture.name,sourceSnapshotSha256=args.sha256,
                    sourceLaunchSha256=hashlib.sha256(launch_raw).hexdigest(),clientSha256=CLIENT_SHA256,
                    samplerSha256=launch['samplerSha256'],helperHashes=launch['helperHashes'],
                    identityPolicy='Stable equality-preserving ordinals replace raw pawn/node, parent-identity and attachment tokens.',
                    clocksAreLabelsOnly=True,invocationArgumentsCaptured=False)
            elif args.fixture:
                header=source.readline();digest.update(header)
                provenance=json.loads(header)
                assert provenance['format']==FORMAT and provenance['clientSha256']==CLIENT_SHA256
                assert provenance['helperHashes']['reaudit-transform-history-capture-fields.py']==READER_SHA256
            else:
                if input_path.stat().st_size>128*1024*1024:raise ValueError('Oversized compact fixture')
                encoded=source.read();digest.update(encoded)
                data=json.loads(encoded)
                provenance=data['provenance']
                assert provenance['format']==FORMAT and provenance['clientSha256']==CLIENT_SHA256
                assert provenance['helperHashes']['reaudit-transform-history-capture-fields.py']==READER_SHA256
            if args.export_compact:compact_export=Compact(provenance)
            if args.export_fixture:
                args.export_fixture.parent.mkdir(parents=True,exist_ok=True)
                temporary=tempfile.NamedTemporaryFile('w',dir=args.export_fixture.parent,delete=False)
                temporary.write(json.dumps(provenance,separators=(',',':'),allow_nan=False)+'\n')
            def input_rows():
                if args.compact:
                    yield from expand_compact(data)
                else:
                    for line in source:
                        if len(line)>2*1024*1024:raise ValueError('Oversized capture row')
                        digest.update(line)
                        if line.strip():yield sanitizer.row(json.loads(line)) if args.capture else json.loads(line)
            for row in input_rows():
                stats.add(row)
                if compact_export:compact_export.add(row)
                if temporary:temporary.write(json.dumps(row,separators=(',',':'),allow_nan=False)+'\n')
        if digest.hexdigest()!=args.sha256:raise ValueError('Frozen input digest mismatch')
        if temporary:
            temporary.close()
            os.replace(temporary.name,args.export_fixture)
            fixture_digest=hashlib.sha256()
            with args.export_fixture.open('rb') as source:
                while block:=source.read(1024*1024):fixture_digest.update(block)
            fixture_sha=fixture_digest.hexdigest()
    finally:
        if temporary:
            temporary.close()
            Path(temporary.name).unlink(missing_ok=True)
    if compact_export:
        args.export_compact.parent.mkdir(parents=True,exist_ok=True)
        with tempfile.NamedTemporaryFile('w',dir=args.export_compact.parent,delete=False) as compact_file:
            json.dump(compact_export.data(),compact_file,separators=(',',':'),allow_nan=False)
            compact_file.write('\n')
        os.replace(compact_file.name,args.export_compact)
        compact_sha=hashlib.sha256(args.export_compact.read_bytes()).hexdigest()
    report=dict(captureName=provenance['sourceSnapshotName'],captureSha256=provenance['sourceSnapshotSha256'],
        inputSha256=digest.hexdigest(),fixtureSha256=fixture_sha,compactSha256=compact_sha,captureProvenance=provenance,
        analysisSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        provenance='Streaming numeric comparison of a retained, owner-digest-bound snapshot. No live read or native code invocation.',
        comparison=stats.report(),
        limits=['Current-record equality with one or many history values is compatibility, not last-writer or selected-endpoint identification.',
            'Current record can be written by recording/getter, interpolation and fallback paths; matching scene state does not distinguish them.',
            'Parentless consumer choice is the static choice if invoked on the sampled state, not evidence that the consumer ran at that moment.',
            'Euler-derived quaternion comparisons use Python double math, not the native float32 conversion helper or its strict tolerance gate.',
            'World-getter scale compatibility is unavailable: this capture reader omits the separate divisor used by the native getter.',
            'Sampled global clocks, velocity interpolation context and tick numbers are not TransformHistory invocation arguments.',
            'No clock fitting, bracket selection, kernel replay or native invocation count is inferred from current-record/ring agreement.',
            'Polling and double-read guards do not establish atomicity, transient writer identity or entry/exit order.'],
        nextReplayInputs=['Identity-bound wrapper/scene owner and input/output current records at an actual recording/evaluation/consumer call.',
            'Actual requested time, context selector, bracket mode and apply options with selected endpoints and globals read in that invocation.',
            'The getter world-scale divisor alongside scene absolute scale; full parent/attachment transform dependencies for parented cases.'])
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(report,indent=2,allow_nan=False)+'\n')
    print(json.dumps(dict(output=str(args.out),rows=stats.rows,acceptedTransformRows=stats.valid,
                         invalidReasons=dict(stats.invalid))))


if __name__=='__main__':main()
