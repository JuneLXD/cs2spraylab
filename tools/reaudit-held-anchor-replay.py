"""Bounded CSV/JSON replay of runtime008 AK command/camera anchor clocks.

No target process, native execution, demo parser, bridge or network is used.
This checks retained raw observations and ordinary finite float32 tick-pair
arithmetic against saved current-hash resolver instructions. Branch telemetry
and the resolver's actual entry clock are not reconstructed by this replay.
"""
import argparse
import csv
import hashlib
import json
import math
import struct
from pathlib import Path

AUDIT = Path(__file__).resolve().parents[2]/'native-audit'
CLIENT_SHA = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
SERVER_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
CAM = 'CCSPlayerPawn.CCSPlayer_CameraServices.'
AIM = 'CCSPlayerPawn.CCSPlayer_AimPunchServices.'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        while chunk := source.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()


def f32(x):
    return struct.unpack('<f', struct.pack('<f', float(x)))[0]


def normalize(tick, fraction):
    assert math.isfinite(fraction) and abs(tick) < 2**24
    whole = math.floor(fraction)
    return dict(tick=tick + whole, fraction=f32(fraction - whole))


def from_ticks(value):
    return normalize(0, f32(value))


def add(a, b):
    return normalize(a['tick'] + b['tick'], f32(a['fraction'] + b['fraction']))


def subtract(a, b):
    return normalize(a['tick'] - b['tick'], f32(a['fraction'] - b['fraction']))


def increment(a):
    return dict(tick=a['tick'] + 1, fraction=a['fraction'])


def seconds(a):
    # Exact rational interpretation of an already-float32 fractional component.
    return (a['tick'] + a['fraction']) / 64


def native_seconds(a):
    return f32(f32(f32(a['tick']) / 64) + f32(a['fraction'] / 64))


def cache_value(anchor, current):
    difference = subtract(anchor, increment(current))
    return f32(f32(difference['tick']) + difference['fraction'])


def carrier(row, tick_name, fraction_name):
    raw_tick = int(row[tick_name])
    assert raw_tick % 2 == 0, 'This fixture expects the retained doubled demo tick carrier'
    return dict(tick=raw_tick // 2, fraction=f32(row[fraction_name]))


def static_evidence(reports):
    retained = json.loads((reports / 'reaudit-attack-history-resolution.json').read_text())
    assert retained['serverSha256'] == SERVER_SHA
    references = []
    for name, expected in retained['evidenceSha256'].items():
        path = reports / name
        assert digest(path) == expected, f'Changed retained resolver evidence: {name}'
        references.append(dict(name=name, sha256=expected))
    checks = {
        'select': [
            '1496f3b: call 0x16416b0',
            '1496f52: call 0x22b7270',
            '1496f57: movss xmm0, dword ptr [r14 + 0x1390]',
            '1496f67: call 0x22b3080',
            '1496f88: call 0x22b3c90',
            '1497924: test eax, eax',
            '1497926: js 0x1497010',
            '1497933: cmp eax, dword ptr [rcx + 0x30]',
            '1497936: jge 0x1497010',
            '1497022: mov qword ptr [r15], rax',
            '1497520: mov qword ptr [r15 + 0xc], rax',
            '1497798: mov dword ptr [r15 + 0x3c], 1',
            '14978bb: mov qword ptr [r15 + 0xc], rax',
            '14978ea: mov dword ptr [r15 + 0x3c], 2',
            '149717b: mov dword ptr [r15], ebx',
            '149780c: mov qword ptr [r15], r12',
            '1497d20: movsxd rax, dword ptr [rax + 0x4c]',
        ],
        'resolver': [
            '14ac0c9: call 0x17fd290',
            '14ac0df: call 0x1496e60',
            '14ac0e8: call 0x22b7270',
            '14ac0f7: call 0x22b4310',
            '14ac100: cvtsi2ss xmm0, eax',
            '14ac10c: addss xmm0, xmm2',
            '14ac223: movss dword ptr [rbx + 0x1390], xmm0',
        ],
        'pair-increment': ['22b7275: add eax, 1'],
        'pair-arithmetic': [
            '22b3ca9: add r12d, dword ptr [rsi]',
            '22b3cac: addss xmm0, dword ptr [rsi + 4]',
        ],
        'pair-subtract': [
            '22b432a: subss xmm0, dword ptr [rsi + 4]',
            '22b4332: sub r12d, dword ptr [rsi]',
        ],
    }
    count = 0
    for name, expected in checks.items():
        path = reports / f'reaudit-attack-history-{name}.txt'
        lines = path.read_text().splitlines()
        for line in expected:
            assert any(v == line or v.startswith(line + ' ;') for v in lines), line
            count += 1
        references.append(dict(name=path.name, sha256=digest(path)))
    return dict(serverSha256=SERVER_SHA, savedInstructionChecks=count, retainedEvidence=references,
                limitation='Retained current-hash disassembly rechecked; no fresh binary hash or native execution in this analysis.')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit-root', type=Path, default=AUDIT)
    p.add_argument('--capture', default='native_reaudit_history_001')
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    reports = args.audit_root / 'reports'
    out = args.out or reports / 'reaudit-held-anchor-replay.json'
    runtime = reports / 'reaudit-motion-runtime-008'
    csv_path = reports / args.capture / 'ticks.csv'
    events_path = reports / args.capture / 'weapon_fire.json'
    snapshot = runtime / f'{args.capture}-snapshot.jsonl'
    launch_path = runtime / 'launch.json'
    launch = json.loads(launch_path.read_text())
    assert launch['clientSha256'] == CLIENT_SHA
    native = static_evidence(reports)
    rows = {int(row['tick']): row for row in csv.DictReader(csv_path.open())}
    events = json.loads(events_path.read_text())
    changes, selected, previous, latest_edge = [], [], None, None
    snapshot_rows = 0
    for line in snapshot.open():
        row = json.loads(line)
        snapshot_rows += 1
        h = row['extra']['frameHistory']['fields']
        header = bytes.fromhex(row['extra']['frameHistory']['guardBlocks'][3][1])
        assert len(header) == 48
        index = h['primaryAttackIndex']
        if 0 <= index < len(h['inputEntries']):
            entry = h['inputEntries'][index]
            key = (entry['frame'], entry['player']['tick'], entry['player']['fraction'])
            if key != latest_edge:
                latest_edge = key
                selected.append(dict(player=entry['player'], render=entry['render'], frame=entry['frame'],
                                     monotonic=row['monotonic'], inputReadDisabled=bool(header[1])))
        anchor = h['cameraAnchor']
        if previous is not None and anchor != previous:
            changes.append(dict(anchor=anchor, storedPunch=h['cameraStoredPunch'], monotonic=row['monotonic'],
                                primaryAttackIndex=index, inputCount=h['inputCount'],
                                sampledGlobalTick=h['sampledGlobalTick'], predictionTick=h['sampledPredictionTick'],
                                sampledGlobalFraction=h['sampledGlobalFraction'], sampledCurrentTime=h['sampledGlobalCurrentTime'],
                                inputReadDisabled=bool(header[1])))
        previous = anchor
    assert len(events) == len(changes) == 8 and len(selected) == 3
    cycle = from_ticks(f32(f32(.1) * 64))
    shots = []
    for index, (event, live) in enumerate(zip(events, changes)):
        row = rows[event['tick']]
        assert row['active_weapon_name'] == 'AK-47'
        assert int(rows[event['tick']-1]['active_weapon_ammo']) - int(row['active_weapon_ammo']) == 1
        camera = carrier(row, CAM+'m_nCsViewPunchAngleTick', CAM+'m_flCsViewPunchAngleTickRatio')
        assert camera == live['anchor'], 'Demo/live association must match both raw pair components'
        next_attack = carrier(row, 'next_primary_attack_tick', 'next_primary_attack_tick_ratio')
        schedule = subtract(next_attack, cycle)
        first_press = [e for e in selected if e['player'] == camera]
        if not first_press:
            assert shots and abs(seconds(next_attack)-seconds(shots[-1]['nextAttack'])-f32(.1)) < 1e-7
            # The prior saved next-attack pair is the stronger held deadline input.
            schedule = shots[-1]['nextAttack']
        aim = carrier(row, AIM+'m_predictableBaseTick', AIM+'m_predictableBaseTickInterpAmount')
        punch = json.loads(row[CAM+'m_vecCsViewPunchAngle'])
        shots.append(dict(ordinal=index, demoTick=event['tick'], cameraAnchor=camera, nextAttack=next_attack,
                          schedule=schedule, scheduleSource='after-shot next pair minus cycle' if first_press else 'preceding shot next pair',
                          selectedFirstPress=bool(first_press), selectedFrames=[e['frame'] for e in first_press], live=live,
                          cameraMinusScheduleMs=(seconds(camera)-seconds(schedule))*1000,
                          processingMinusScheduleMs=(float(row['game_time'])-seconds(schedule))*1000,
                          lastShotFloat32=f32(row['last_shot_time']), scheduleFloat32=native_seconds(schedule),
                          aimMinusCameraMs=(seconds(aim)-seconds(camera))*1000,
                          networkPunchQuantizationMax=max(abs(a-b) for a,b in zip(punch,live['storedPunch']))))
    # Observed full-auto run is independently identified by unmatched press
    # anchors between two recorded selected press anchors, not by a fitted delay.
    cache = None
    replay = []
    simple = None
    for shot in shots:
        if shot['selectedFirstPress']:
            predicted = shot['cameraAnchor']
            simple = shot['cameraAnchor']
            cache = cache_value(predicted, shot['schedule'])
            shot['derivedCacheUnderScheduleClock'] = cache
            continue
        assert cache is not None
        before = cache
        predicted = add(increment(shot['schedule']), from_ticks(before))
        simple = add(simple, cycle)
        cache = cache_value(predicted, shot['schedule'])
        replay.append(dict(demoTick=shot['demoTick'], predicted=predicted, observed=shot['cameraAnchor'],
                           pairExact=predicted == shot['cameraAnchor'],
                           errorMs=(seconds(predicted)-seconds(shot['cameraAnchor']))*1000,
                           simpleCyclePairExact=simple == shot['cameraAnchor'],
                           simpleCycleErrorMs=(seconds(simple)-seconds(shot['cameraAnchor']))*1000,
                           cacheBefore=before, cacheAfter=cache,
                           sampledPrimaryAttackIndex=shot['live']['primaryAttackIndex'],
                           sampledInputReadDisabled=shot['live']['inputReadDisabled']))
    result = dict(method=__doc__, clientSha256=CLIENT_SHA, serverEvidence=native,
                  inputs=[dict(path=str(path.relative_to(args.audit_root.parent)), sha256=digest(path))
                          for path in [csv_path, events_path, snapshot, launch_path]],
                  probeSha256=digest(Path(__file__)), snapshotRows=snapshot_rows, selectedPresses=selected,
                  shots=shots, conditionalHeldCacheReplay=replay,
                  summary=dict(demoShots=len(shots), liveCameraChanges=len(changes), demoLiveRawPairExact=len(shots),
                               firstPressAnchorMatches=sum(s['selectedFirstPress'] for s in shots),
                               heldPairs=len(replay), conditionalCachePairExact=sum(s['pairExact'] for s in replay),
                               conditionalCacheMaxErrorMs=max(abs(s['errorMs']) for s in replay),
                               cycleIncrementPairExact=sum(s['simpleCyclePairExact'] for s in replay),
                               cycleIncrementMaxErrorMs=max(abs(s['simpleCycleErrorMs']) for s in replay),
                               cameraMinusScheduleMs=[min(s['cameraMinusScheduleMs'] for s in shots),max(s['cameraMinusScheduleMs'] for s in shots)],
                               processingMinusScheduleMs=[min(s['processingMinusScheduleMs'] for s in shots),max(s['processingMinusScheduleMs'] for s in shots)],
                               lastShotFloat32MatchesSchedule=sum(s['lastShotFloat32']==s['scheduleFloat32'] for s in shots),
                               maxDemoLivePunchDifference=max(s['networkPunchQuantizationMax'] for s in shots)),
                  staticRule={
                      'candidate': 'Normalize(nextAttack + oneTick + FromTickFloat(cachedDifference))',
                      'cacheRefresh': 'FloatTicks(Normalize(resolvedAnchor - (resolverCurrentPair + oneTick)))',
                      'validHistory': 'A valid selected attack index reads the selected player pair, converts tick domain, and clamps it; render pair is separate.',
                      'heldFallback': 'Invalid or out-of-range selected index enters candidate/history search. Interpolated and last-history branches keep candidate for the recoil anchor while choosing pose/render history.',
                      'exceptions': 'No-history/stale-history paths can replace/bound the first pair; exact-history bounds and conversion remain applicable.',
                      'conditionalNoHistoryExclusion': 'In the retained no-history comparison, candidate <= current selects current + one tick. If the resolver current pair equals the measured deadline, the observed slightly earlier anchor therefore requires a candidate-preserving path instead. That current-pair assumption is not direct runtime telemetry.',
                  },
                  conclusions=[
                      'All eight live anchor tick/fraction pairs equal the demo carriers after doubled integer decoding and float32 decimal recovery.',
                      'All three observed first-press camera anchors equal their selected published player pairs; this is a polling association backed by the native field/caller chain.',
                      'The five held follow-ups preserve the captured burst history phase. The conditional cache replay uses observed weapon deadlines as resolver current pairs; it is not per-shot resolver branch telemetry.',
                      'The new per-burst phase differs from earlier multi-millisecond captures, ruling out a universal fitted correction.',
                  ],
                  trainerNeeds=[
                      'A saved per-present player clock and frame identity associated with the first press; an event timestamp alone is not the native saved frame clock.',
                      'Separate camera sampling time and stored recoil-command anchor, with an independently retained per-burst cached timing difference.',
                      'Equivalent command consumption/reduction and clamp handling for early press, delayed processing, stale/no history, reload/deploy and tick-domain conversion.',
                      'Evidence linking the trainer render/input phases to that native clock before a live behavior change.',
                  ],
                  missingRuntime=[
                      'Resolver entry current pair and tick-domain conversion state, actual serialized attack index/entry after reduction.',
                      'Cached timing difference before/after each shot and resolver exact/interpolated/last/no-history status.',
                      'The global/predicted time at the exact camera sampler call, not a later stable poll.',
                  ],
                  limits=[
                      'Only one stationary AK tap/burst/reload/tap capture, eight shots; no early/deferred attack or special weapon coverage.',
                      'CSV float32 values are recovered, not a fresh demo parse. Original demo hash is recorded separately when present.',
                      'Ordinary finite float32 pair model, not native resolver emulation or a full malformed/nonfinite tick-pair implementation.',
                      'Polling may miss intermediate writes and cross-object snapshots are not atomic.',
                  ])
    demo = args.audit_root.parent / 'cs2-game/game/csgo' / f'{args.capture}.dem'
    if demo.exists():
        result['originalDemo'] = dict(bytes=demo.stat().st_size, sha256=digest(demo), reparsed=False)
    out.write_text(json.dumps(result, indent=2, allow_nan=False)+'\n')
    print(json.dumps(dict(output=str(out), summary=result['summary'], replay=replay), indent=2))


if __name__ == '__main__':
    main()
