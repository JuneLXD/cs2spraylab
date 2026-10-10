#!/usr/bin/env python3
"""Compare portable native execution content to the preserved oracle digest.

Run serially under MemoryMax=512M, MemorySwapMax=0 and CPUQuota=100%.
JSON hashing is incremental; it never builds another full serialized report.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
EVIDENCE = ROOT.parents[1] / 'docs/evidence/reaudit-ground-friction-native.json'
COMMON = ('fixtureDefinitionSha256', 'fixtureFileSha256', 'fixtures', 'sequences',
          'hooks', 'mxcsrProfiles', 'mxcsrExecutionResults')
RELEASE = ('derivedReleaseThresholds', 'stopGateControls', 'smallControlSpeedCases')

def content_digest(report, kind):
    assert kind in ('release', 'combined', 'stance'), 'Unknown replay kind'
    values = {key: report[key] for key in COMMON + (RELEASE if kind == 'release' else ())}
    values['guardCounts'] = report['memoryGuard']['counts']
    h = hashlib.sha256()
    for chunk in json.JSONEncoder(sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(values):
        h.update(chunk.encode())
    return h.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--kind', required=True, choices=['release', 'combined', 'stance'])
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--evidence', type=Path, default=EVIDENCE)
    args = parser.parse_args()
    assert args.report.stat().st_size <= 128 * 1024 * 1024, 'Report size budget exceeded'
    evidence = json.loads(args.evidence.read_text())
    expected = evidence['nativeReplays'][args.kind]
    report = json.loads(args.report.read_text())
    assert report['schema'] == expected['schema']
    assert report['serverSha256'] == evidence['serverSha256']
    assert report['guardedNativeExecution'] is True
    assert report['memoryGuard']['unexpectedAccesses'] == 0
    assert report['fixtureDefinitionSha256'] == expected['fixtureDefinitionSha256']
    actual = content_digest(report, args.kind)
    assert actual == expected['executionContentSha256'], 'Native execution content changed'
    print(json.dumps({'kind': args.kind, 'executionContentSha256': actual,
                      'rows': sum(len(s['rows']) for s in report['sequences']), 'status': 'exact-match'}))

if __name__ == '__main__':
    main()
