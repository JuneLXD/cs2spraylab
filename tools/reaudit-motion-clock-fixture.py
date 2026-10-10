"""Preserve named numeric fields from the accepted controller-clock capture.

The source is immutable and hash-bound. The exported fixture has no process
identity, address, guard bytes or controller handle. Repeated snapshots do not
establish native invocations or associate a retained body result with a call.
"""
import hashlib
import json
import runpy
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent / 'native-audit'
SOURCE = ROOT / 'reports/reaudit-motion-runtime-007/native_reaudit_bob_006-snapshot.jsonl'
EXPECTED = '1583fed348b1d62a6c281bacd181b3d6df4eb82df24ffb1524be14c2f545c30a'
BASE = runpy.run_path(str(REPO / 'tools/reaudit-motion-capture-fixture.py'))
FIELDS = BASE['FIELDS']
EXTRA_FIELDS = BASE['EXTRA_FIELDS'] + ['bodyClock']
CLOCK_FIELDS = [
    'bodyClockGlobalCurrentTime', 'bodyClockGlobalFrameDelta',
    'bodyClockGlobalTick', 'bodyClockGlobalFraction', 'bodyClockContext',
    'bodyClockProcessingPawnMatches', 'bodyClockAnyProcessingPawn',
    'bodyClockAnyProcessingController', 'bodyClockGameRulesPresent',
    'bodyClockDefaultTickConverter', 'bodyClockTotalPausedTicks',
    'bodyClockPauseStartTick', 'bodyClockGamePaused',
    'bodyClockSampledProviderTick', 'bodyClockSampledProviderFraction',
    'bodyClockControllerHandleValid', 'bodyClockControllerClassBound',
    'bodyClockProcessingControllerMatches', 'bodyClockControllerTickBase',
    'bodyClockControllerTickBaseNormalRange', 'bodyClockControllerSeedCandidate',
    'bodyClockValid',
]


def main():
    raw = SOURCE.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == EXPECTED
    rows = [json.loads(line) for line in raw.splitlines()]
    assert len(rows) == 2589
    for row in rows:
        extra = row['extra']
        assert extra['sceneWriterValid'] and extra['bodyClock']['fields']['bodyClockValid']
        extra['swayInputFields'] = extra['swayInputs']['fields']
        extra['bodyClock'] = {'fields': {k: extra['bodyClock']['fields'][k] for k in CLOCK_FIELDS}}
    launch = json.loads((SOURCE.parent / 'launch.json').read_text())
    sampler = SOURCE.parent / 'sampler.py'
    assert hashlib.sha256(sampler.read_bytes()).hexdigest() == launch['samplerSha256']
    fixture = dict(capture='native_reaudit_bob_006', sourceSnapshotSha256=EXPECTED,
        clientSha256=launch['clientSha256'], samplerSha256=launch['samplerSha256'],
        helperHashes=launch['helperHashes'], fields=FIELDS, extraFields=EXTRA_FIELDS,
        bodyClockFields=CLOCK_FIELDS,
        rows=[[r[k] for k in FIELDS] + [[r['extra'][k] for k in EXTRA_FIELDS]] for r in rows],
        limits=[
            'Accepted asynchronous snapshots; changed reads were rejected.',
            'Repeated state does not count native invocations or presented frames.',
            'Controller tick base is independently captured, but its association with each retained body result is not established.',
            'No active-pawn marker was observed; only one snapshot has an active-controller marker.',
            'Ordinary unscoped AK movement, turns, crouch and jump only.',
        ])
    out = REPO / 'docs/evidence/reaudit-motion-clock-fixture.json'
    out.write_text(json.dumps(fixture, separators=(',', ':'), allow_nan=False) + '\n')
    decoded, metadata, sha = BASE['load_fixture'](out)
    assert len(decoded) == len(rows) and metadata['sourceSnapshotSha256'] == EXPECTED
    assert all(decoded[i]['extra']['bodyClock'] == rows[i]['extra']['bodyClock'] for i in range(len(rows)))
    print(json.dumps(dict(rows=len(rows), bytes=out.stat().st_size, sha256=sha)))


if __name__ == '__main__':
    main()
