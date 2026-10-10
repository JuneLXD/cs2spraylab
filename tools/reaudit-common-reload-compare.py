"""Reduce retained actual-engine common-reload runs to a portable comparison.

No engine/native execution. Validate both harness sources and all 56 paired
scenarios, preserving the measured source hashes rather than hashing today's
possibly changed application. Defaults resolve relative to this script.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
NATIVE = REPO.parent / 'native-audit'
WEAPONS = ('ak47', 'm4a4', 'm4a1s', 'awp', 'glock', 'usp', 'deagle')
ENGINES = ('range', 'duel')
SCENARIOS = ('early-tap', 'early-held', 'ready-tap', 'ready-held')


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def normalized_harness(path):
    lines = path.read_text().splitlines(keepends=True)
    for prefix in ('const repo=option(', 'const output=option('):
        assert sum(line.startswith(prefix) for line in lines) == 1, (path, prefix)
    return ''.join(line for line in lines if not line.startswith(('const repo=option(', 'const output=option(')))


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--native-root', type=Path, default=NATIVE)
    p.add_argument('--before', type=Path)
    p.add_argument('--after', type=Path)
    p.add_argument('--before-harness', type=Path)
    p.add_argument('--after-harness', type=Path, default=Path(__file__).with_name('reaudit-common-reload-trainer.mjs'))
    p.add_argument('--native-proof', type=Path, default=REPO / 'docs/evidence/reaudit-common-reload-native.json')
    p.add_argument('--out', type=Path, default=REPO / 'docs/evidence/reaudit-common-reload-engines.json')
    args = p.parse_args()
    source_dir = args.native_root / 'reports/reaudit-common-reload'
    before_path = args.before or source_dir / 'trainer-before.json'
    after_path = args.after or source_dir / 'trainer-after.json'
    before_harness = args.before_harness or args.native_root / 'reaudit-common-reload-trainer.mjs'
    before = json.loads(before_path.read_text())
    after = json.loads(after_path.read_text())
    proof = json.loads(args.native_proof.read_text())
    assert before['scriptSha256'] == sha(before_harness)
    assert after['scriptSha256'] == sha(args.after_harness)
    before_body = normalized_harness(before_harness)
    assert before_body == normalized_harness(args.after_harness)
    assert before['method'] == after['method'] and before['baseline'] == after['baseline']
    assert set(proof['weapons']) == set(WEAPONS) and proof['wholeArtifactHashVerified']
    assert proof['instructionAssertions'] == 102 and proof['virtualSlotAssertions'] == 63
    keys = {(e, w, s) for e in ENGINES for w in WEAPONS for s in SCENARIOS}
    runs = []
    for data in (before, after):
        mapped = {(x['engine'], x['weapon'], x['scenario']): x for x in data['cases']}
        assert len(data['cases']) == len(mapped) == 56 and set(mapped) == keys
        runs.append(mapped)
    rows = []
    for weapon in WEAPONS:
        compact = {'weapon': weapon}
        for scenario in SCENARIOS:
            paired = []
            for engine in ENGINES:
                a, b = (run[engine, weapon, scenario] for run in runs)
                for field in ('cycle', 'requestAt', 'releaseAt'):
                    assert a[field] == b[field], (engine, weapon, scenario, field)
                assert a['cycle'] > 0
                ready_tick = math.ceil(a['cycle'] * 128) / 128
                early = scenario.startswith('early')
                assert a['requestAt'] == (1 / 32 if early else ready_tick)
                assert a['firstReloadObserved'] == a['requestAt']
                expected = None if scenario == 'early-tap' else ready_tick
                assert b['firstReloadObserved'] == expected, (engine, weapon, scenario)
                paired.append((a['cycle'], a['requestAt'], a['releaseAt'],
                               a['firstReloadObserved'], b['firstReloadObserved']))
            assert paired[0] == paired[1], (weapon, scenario, paired)
            cycle, requested, released, old, new = paired[0]
            compact['configuredCycleSeconds'] = cycle
            compact[scenario] = {'requestSeconds': requested, 'releaseSeconds': released,
                                 'beforeReloadSeconds': old, 'afterReloadSeconds': new}
        rows.append(compact)
    before_sources, after_sources = before['sourceHashes'], after['sourceHashes']
    assert before_sources['src/range/equipment-data.json'] == after_sources['src/range/equipment-data.json']
    source_names = sorted(set(before_sources) | set(after_sources))
    changed = {name: {'before': before_sources.get(name), 'after': after_sources.get(name)}
               for name in source_names if before_sources.get(name) != after_sources.get(name)}
    unchanged_relevant = ('src/range/equipment-data.json', 'src/range/equipment.ts',
                          'src/range/game-data.json', 'src/range/weapon-actions.ts', 'src/range/reload-clock.ts')
    tables = {}
    for name in unchanged_relevant:
        assert before_sources[name] == after_sources[name], name
        tables[name] = before_sources[name]
    result = {
        'method': before['method'],
        'baselineCommit': before['baseline'],
        'reportSha256': {'before': sha(before_path), 'after': sha(after_path)},
        'harnessSha256': {'before': before['scriptSha256'], 'after': after['scriptSha256'],
                          'normalizedBody': hashlib.sha256(before_body.encode()).hexdigest()},
        'harnessNormalization': 'Omit exactly the two const repo/const output default-path declaration lines. All remaining source bytes match. Both measurements passed explicit --output.',
        'bundleSha256': {'before': before['bundleSha256'], 'after': after['bundleSha256']},
        'completeSourceManifestSha256': {'before': canonical_sha(before_sources), 'after': canonical_sha(after_sources)},
        'manifestHashMethod': 'SHA-256 of UTF-8 JSON with sorted keys and compact separators.',
        'changedMeasuredSources': changed,
        'unchangedRelevantSources': tables,
        'nativeGate': {'file': 'reaudit-common-reload-native.json', 'sha256': sha(args.native_proof),
                       'serverSha256': proof['serverSha256'],
                       'evidenceIds': ['COMMON-RELOAD-common-input-dispatch', 'COMMON-RELOAD-primary-ready',
                                       'COMMON-RELOAD-input-active', 'COMMON-RELOAD-ordinary-gun-postframe']},
        'cases': 56, 'engines': list(ENGINES), 'stepHz': 128, 'durationSecondsPerCase': 8,
        'counts': {'earlyTapsRejectedAfter': 14, 'earlyHeldDeferredAfter': 14, 'readyControlsUnchanged': 28,
                   'pairedEngineRowsAgree': 28},
        'rows': rows,
        'limits': ['These are actual trainer measurements, not new native per-tick/input captures.',
                   'Held starts are first sampled 128 Hz updates at or after configured cycle; native static proof separately establishes inclusive readiness.',
                   'Null afterReloadSeconds means no reload observed within the eight-second case.',
                   'Exact-deadline, input-priority and pending-burst checks live in common-reload-input.test.ts, outside this baseline bench.',
                   'These reload runs predate the separate duck-flag integration; hashes identify the isolated measured source versions, not the final release tree.',
                   'The baseline commit identifies HEAD for both dirty-worktree runs; captured source and bundle hashes identify each measured version.',
                   'No full-suite, browser, deployment or shipped-status claim is made by this report.'],
        'reproduction': 'systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-common-reload-compare.py',
        'comparisonScriptSha256': sha(Path(__file__)),
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps({'output': str(args.out), 'cases': 56, 'counts': result['counts'],
                      'changedSources': list(changed)}))


if __name__ == '__main__':
    main()
