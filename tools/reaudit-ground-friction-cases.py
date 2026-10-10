#!/usr/bin/env python3
"""Export stable trainer inputs from an exactly verified native execution report.

Portable report paths/readers may differ; every execution row, fixture, hook
and guard count must retain the pinned canonical content digest. Run at 512MiB.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('native_comparison', ROOT / 'reaudit-ground-friction-native/compare.py')
comparison = importlib.util.module_from_spec(spec)
spec.loader.exec_module(comparison)
parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path)
parser.add_argument('destination', type=Path)
parser.add_argument('--kind', choices=['release', 'combined', 'stance'], default='release')
args = parser.parse_args()
assert not args.destination.exists()
assert args.source.stat().st_size <= 128 * 1024 * 1024
with args.source.open() as stream:
    native = json.load(stream)
evidence = json.loads(comparison.EVIDENCE.read_text())
expected = evidence['nativeReplays'][args.kind]
assert native['schema'] == expected['schema']
assert native['serverSha256'] == evidence['serverSha256']
assert native['guardedNativeExecution'] is True
assert native['memoryGuard']['unexpectedAccesses'] == 0
assert native['fixtureDefinitionSha256'] == expected['fixtureDefinitionSha256']
digest = comparison.content_digest(native, args.kind)
assert digest == expected['executionContentSha256'], 'Native execution content changed'
keys = ['command', 'startFraction', 'endFraction', 'duration', 'before', 'currentWish',
        'afterCache', 'nativeControlSpeed', 'afterFriction', 'afterPreHelper',
        'nativeStopGate', 'afterPostHelper', 'afterWishCopy', 'derivedUncollidedDisplacement']
if args.kind in ('combined', 'stance'):
    keys += ['preparedWish', 'afterAccelerate', 'afterNativeCap']
sequences = []
for sequence in native['sequences']:
    rows = [{key: row[key] for key in keys + (['afterCommandHandoff'] if 'afterCommandHandoff' in row else [])}
            for row in sequence['rows']]
    sequences.append({'fixtureId': sequence['fixtureId'], 'mxcsrProfile': sequence['mxcsrProfile'], 'rows': rows})
report = {key: native[key] for key in ['schema', 'serverSha256', 'fixtureDefinitionSha256', 'fixtures']}
if args.kind == 'release':
    report.update({key: native[key] for key in ['stopGateControls', 'smallControlSpeedCases']})
report.update(sourceExecutionSha256=digest, guardedNativeExecution=True, sequences=sequences, unexpectedAccesses=0)
with args.destination.open('x') as stream:
    json.dump(report, stream, separators=(',', ':'), allow_nan=False)
    stream.write('\n')
output_hash = hashlib.sha256(args.destination.read_bytes()).hexdigest()
source_hash = hashlib.sha256()
with args.source.open('rb') as stream:
    for block in iter(lambda: stream.read(1024 * 1024), b''):
        source_hash.update(block)
provenance = {'sourceSha256': source_hash.hexdigest(), 'executionContentSha256': digest,
              'extractorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'outputSha256': output_hash, 'rows': sum(len(s['rows']) for s in sequences)}
with Path(str(args.destination) + '.source.json').open('x') as stream:
    json.dump(provenance, stream, indent=2)
    stream.write('\n')
print(json.dumps(provenance))
