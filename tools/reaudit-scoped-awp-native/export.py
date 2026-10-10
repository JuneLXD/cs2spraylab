#!/usr/bin/env python3
"""Export only semantic scoped AWP states; no pointer or native-byte ledger.

Run serially under MemoryMax=512M, MemorySwapMax=0 and CPUQuota=100%.
The output preserves every fixture, command, intermediate and endpoint row.
"""
import argparse
import hashlib
import json
from pathlib import Path

SERVER_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
READER_SHA = '3ef80ff86342ddc0d0f07eb13388f89160eb96fa868fba148ebf6e223d86eacb'
FIXTURE_SHA = '169c9a00bb8d8d31befe9fb966b1c9f4faae6bcacbd3eca292668d6a76398999'
FIXTURE_FILE_SHA = '9b5a3ae0693206ed0d536ae219b288b7ada299a43a31863c8608a6aab8beeb4d'
SEMANTIC_KEYS = ('fixtureDefinitionSha256', 'fixtureFileSha256', 'fixtures', 'sequences',
                 'hooks', 'mxcsrProfiles', 'mxcsrExecutionResults',
                 'scopeBranchCounts', 'identicalZoomPairs')


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def execution_digest(report):
    values = {key: report[key] for key in SEMANTIC_KEYS}
    values['guardCounts'] = report['memoryGuard']['counts']
    h = hashlib.sha256()
    for chunk in json.JSONEncoder(sort_keys=True, separators=(',', ':'), allow_nan=False).iterencode(values):
        h.update(chunk.encode())
    return h.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--report', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--expect-execution-sha')
    args = parser.parse_args()
    assert not args.out.exists(), 'Refusing to overwrite scoped export'
    assert args.report.stat().st_size <= 12 * 1024 * 1024
    report = json.loads(args.report.read_text())
    assert report['schema'] == 'cs2.native-scoped-awp-oracle.v1'
    assert report['serverSha256'] == SERVER_SHA and report['readerSha256'] == READER_SHA
    assert report['fixtureDefinitionSha256'] == FIXTURE_SHA
    assert report['fixtureFileSha256'] == FIXTURE_FILE_SHA
    assert report['guardedNativeExecution'] is True and report['memoryGuard']['unexpectedAccesses'] == 0
    assert len(report['fixtures']) == 30 and len(report['sequences']) == 32
    assert sum(len(s['rows']) for s in report['sequences']) == 844
    assert report['identicalZoomPairs'] == 15
    semantic_sha = execution_digest(report)
    if args.expect_execution_sha:
        assert semantic_sha == args.expect_execution_sha, 'Native execution changed'
    compact = {
        'schema': 'cs2.native-scoped-awp-comparison-input.v1',
        'sourceSchema': report['schema'], 'sourceNativeSha256': digest(args.report),
        'readerSha256': READER_SHA, 'exporterSha256': digest(Path(__file__)),
        'serverSha256': SERVER_SHA, 'guardedNativeExecution': True,
        'executionContentSha256': semantic_sha,
        **{key: report[key] for key in SEMANTIC_KEYS},
        'scopeJoin': report['scopeJoin'],
        'memoryGuard': {'unexpectedAccesses': 0, 'counts': report['memoryGuard']['counts']},
        'limits': report['limits'],
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    with args.out.open('x') as output:
        json.dump(compact, output, separators=(',', ':'), allow_nan=False)
        output.write('\n')
    assert execution_digest(compact) == semantic_sha
    print(json.dumps({'output': str(args.out), 'sha256': digest(args.out),
                      'bytes': args.out.stat().st_size, 'executionContentSha256': semantic_sha,
                      'fixtures': 30, 'sequences': 32, 'rows': 844, 'status': 'passed'}))


if __name__ == '__main__':
    main()
