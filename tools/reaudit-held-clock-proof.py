"""Verify retained held-fire caller/time-control evidence with a full current server hash check.

This is static evidence checking and small JSON arithmetic. It does not execute
native code, infer a live branch from a fit, or edit the application repository.
Raw instruction locations remain in this local script and evidence directory.
"""
import argparse
import hashlib
import json
from pathlib import Path

AUDIT = Path(__file__).resolve().parents[2] / 'native-audit'
SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(1024*1024): h.update(block)
    return h.hexdigest()


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit-root', type=Path, default=AUDIT)
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    assert digest(args.audit_root.parent/'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so') == SHA
    reports = args.audit_root/'reports'
    out = reports/'reaudit-held-clock'
    checks = {
      'move-data-init.txt': [
        '17873cb: cmp qword ptr [rax + 0x88], 0',
        '17873f6: sub edx, eax',
        '1787409: movq qword ptr [rdi + 0xd4], xmm0',
      ],
      'command-pre-movement.txt':['15d313a: call 0x17c6250'],
      'pre-command-base.txt':['17c63ea: call 0x17c5c50'],
      'movement-deadline-producer.txt': [
        '15d36a9: call 0x17d84c0',
        '15d36c7: mov r15d, dword ptr [rax + 0x44]',
        '15d36d5: call 0x134e910',
        '15d36e2: lea esi, [rax - 1]',
        '15d36ed: movss xmm0, dword ptr [r12 + 0x90]',
        '15d36f7: call 0x22b3680',
        '15d370a: call 0x16416b0',
        '15d3719: cmp eax, dword ptr [rbp - 0x3c]',
        '15d3724: cmp r15d, eax',
        '15d372f: movd xmm0, edx',
        '15d3736: call 0x17c57a0',
        '15d393c: comiss xmm4, dword ptr [rbp - 0x38]',
        '15d3946: je 0x15d3740',
        '15d394c: jbe 0x15d3740',
        '15d3af9: comiss xmm7, xmm3',
        '15d3b02: je 0x15d372f',
      ],
      'insert-remaining.txt': [
        '17c57b2: movsxd r13, dword ptr [rdi + 0x78]',
        '17c57bf: mov rdx, qword ptr [rdi + 0x80]',
        '17c57d5: je 0x17c583e',
        '17c57db: add rbx, 0x18',
        '17c57e9: comiss xmm1, xmm0',
        '17c57ec: jbe 0x17c57d0',
        '17c5804: movups xmmword ptr [rbp - 0x3c], xmm1',
        '17c582d: movss dword ptr [rbp - 0x40], xmm0',
        '17c5837: movups xmmword ptr [rsi], xmm0',
      ],
      'remaining-clock-scope.txt': [
        '17baeff: mov edx, dword ptr [r14 + 0xd4]',
        '17baf3f: test byte ptr [r14], 1',
        '17bae08: cvtsi2ss xmm0, edx',
        '17bae1c: addss xmm0, xmm3',
        '17bae40: movlps qword ptr [r15 + 0x30], xmm0',
        '17bae49: mov dword ptr [r15 + 0x44], edx',
        '17bae5b: movss dword ptr [r15 + 0x50], xmm1',
        '17baf75: call 0x17ba790',
        '17bae9b: mov rdx, qword ptr [rdx + 0x150]',
        '17bafa4: call rdx',
        '17bafb7: jmp 0x17baeab',
        '17baeab: mov qword ptr [r15 + 0x30], r10',
        '17baeb3: mov dword ptr [r15 + 0x44], r9d',
        '17baeb7: movss dword ptr [r15 + 0x50], xmm2',
      ],
      'remaining-callback.txt': [
        '157f2c0: mov rax, qword ptr [rdi + 0x38]',
        '157f2c9: mov rdi, qword ptr [rax + 0xdf0]',
        '157f2d0: jmp 0x15e1420',
      ],
      'remaining-weapon-dispatch.txt': [
        '15e1424: call 0x17d84c0',
        '15e1435: mov rax, qword ptr [rax + 0xd40]',
        '15e143c: jmp rax',
      ],
      'domain-tick.txt': [
        '1993974: mov rax, qword ptr [rax + 0x378]',
        '199397f: mov r12d, dword ptr [rcx + 0x44]',
        '199398d: jne 0x19939d8',
        '199398f: cmp byte ptr [rdi + 0xc8], 0',
        '19939b6: sub r12d, dword ptr [rbx + 0xc0]',
        '19939f0: cmp r12d, eax',
      ],
      'domain-convert.txt': [
        '1993fb9: test edx, edx',
        '1993fe7: sub ebx, dword ptr [r12 + 0xc0]',
      ],
    }
    old_checks = {
      'reaudit-footsteps-prepare-segments-raw.txt': [
        '17c5c6a: mov dword ptr [rdx + 0x60], 0',
        '17c5c71: mov dword ptr [rdx + 0x78], 0',
        '17c5c78: mov dword ptr [rdx + 0x90], 0x3f800000',
        '17c5d6c: mov rax, qword ptr [r14]',
        '17c5d6f: mov rdx, r13',
        '17c5d75: mov rdi, r14',
        '17c5d78: call qword ptr [rax + 0x128]',
      ],
      'reaudit-attack-history-current-time-pair.txt': [
        '17fd2a2: movss xmm0, dword ptr [rax + 0x50]',
        '17fd2ac: call 0x134e880',
        '17fd2bc: call 0x22b49a0',
      ],
      'reaudit-attack-history-next-attacks.txt': [
        '16416b8: mov esi, dword ptr [rdi + 0x1190]',
        '16416be: movss xmm0, dword ptr [rdi + 0x1194]',
      ],
      'reaudit-attack-history-resolver.txt': [
        '14ac0c6: mov edi, dword ptr [rax + 0x38]',
        '14ac0c9: call 0x17fd290',
        '14ac0df: call 0x1496e60',
        '14ac0e8: call 0x22b7270',
        '14ac0f7: call 0x22b4310',
        '14ac10c: addss xmm0, xmm2',
        '14ac223: movss dword ptr [rbx + 0x1390], xmm0',
      ],
      'reaudit-shell-reload/generic-post-frame.txt':[
        '14b4558: jmp 0x14b3fd0',
      ],
      'reaudit-shell-reload/proof-shell-post-frame.txt':[
        '14b4128: mov rsi, r12',
        '14b412e: call 0x14b0360',
      ],
    }
    records, n = [], 0
    for directory, groups in [(out, checks),(reports,old_checks)]:
        for name, expected in groups.items():
            path = directory/name
            lines = {line.split(' ; ')[0] for line in path.read_text().splitlines()}
            for line in expected:
                assert line in lines, (name,line)
                n += 1
            records.append(dict(path=str(path.relative_to(args.audit_root)),
                                sha256=digest(path), checkedInstructions=len(expected)))
    ranges = []
    for path in sorted(out.glob('*.range.json')):
        record = json.loads(path.read_text())
        assert digest(out/(record['name']+'.txt')) == record['listingSha256']
        ranges.append(record)
    assert sum(r['bytes'] for r in ranges) == 12000
    binding = json.loads((out/'movement-class-binding.json').read_text())
    assert binding['serverSha256'] == SHA
    assert binding['name'] == '26CCSPlayer_MovementServices'
    assert binding['slots'] == {'0x118':'0x15d3120','0x128':'0x15d3670',
                                '0x138':'0x15d3b40','0x150':'0x157f2c0'}
    identities = []
    for name in ['reaudit-accuracy-remaining-movement', 'reaudit-accuracy-finish-pawn-caller',
                 'reaudit-accuracy-gun-fire', 'reaudit-accuracy-primary-dispatch',
                 'reaudit-accuracy-gun-primary']:
        path = args.audit_root/'rea/out'/(name+'.json')
        result = json.loads(path.read_text())['structuredContent']
        evidence = result['evidence']
        assert evidence['subject']['digest']['sha256'] == SHA
        code = args.audit_root/'rea/out'/(name+'.c')
        assert code.read_text().strip() == result['result'].strip()
        identities.append(dict(path=str(path.relative_to(args.audit_root)),
                               sha256=digest(path), evidenceId=evidence['evidence_id']))
    oracle_path = reports/'reaudit-footsteps/native-command-segments.json'
    assert json.loads(oracle_path.read_text())['binarySha256'] == SHA
    previous_path = reports/'reaudit-held-anchor-replay.json'
    previous = json.loads(previous_path.read_text())
    held = [s for s in previous['shots'] if not s['selectedFirstPress']]
    assert len(held) == 5
    assert all(0 < s['schedule']['fraction'] < 1 for s in held)
    result = dict(method=__doc__,serverSha256=SHA,probeSha256=digest(Path(__file__)),
      wholeArtifactHashRecomputedThisPass=True, freshlyReadCodeBytes=12000,
      currentByteRanges=[{k:v for k,v in r.items() if k not in ('address','start','end','rawLocations')} for r in ranges],
      currentMovementClassBinding=dict(name=binding['name'],serverSha256=SHA,typedSlots=['preMovement','deadlineProducer','postMovement','remainingCallback']),
      checkedInstructions=n, retainedInstructions=records, retainedReaIdentities=identities,
      priorCommandOracle=dict(path=str(oracle_path.relative_to(args.audit_root)),sha256=digest(oracle_path)),
      heldCaptureRelation=dict(path=str(previous_path.relative_to(args.audit_root)),sha256=digest(previous_path),
        interiorHeldShots=len(held),deadlineFractions=[s['schedule']['fraction'] for s in held],
        limitation='Static ordinary-path applicability; this does not observe which branch each live invocation took.'),
      rule={
        'ordinaryCommandWindow':'The unflagged command initializer uses global end tick G and start tick G-1, with a full-tick interval.',
        'deadlineProducer':'Preprocessing clears both lists, sets its interval limit to one, and calls the typed CS movement override. That override gets the active weapon next-primary pair and inserts its fraction if start < deadline <= end in the movement time domain.',
        'insertion':'The remaining list has ordered 24-byte records. Fraction-only deadline insertion zeroes button/action payload, preserves the supplied float fraction, and skips an exact duplicate.',
        'clockScope':'For each remaining record, normalize startTick+fraction, install global currentTime, delta, tick and fraction, apply any button edge, then invoke the typed per-fraction callback once at the final record of each distinct fraction. Restore all saved globals afterward.',
        'typedCall':'The per-fraction callback gets the owner pawn weapon services, obtains the active weapon, and tail-calls weapon post-frame. The ordinary gun wrapper reaches common attack readiness, primary attack and GunFire, which captures the resolver current pair before resolving history.',
        'resolverCurrent':'The current pair reads global fraction plus the weapon identity time-domain tick. Nonzero domains or missing domain object use the global tick. Default domain-zero conversion subtracts its stored integer adjustment, with a separate gated clamp branch.',
        'interiorDeadlineConclusion':'For ordinary one-tick processing, matching movement/weapon time domains and an eligible interior next-primary deadline, the resolver current pair is the next-primary pair. This is a caller/time-control result, not a fitted offset.',
        'cache':'Candidate = Normalize(nextPrimary + oneTick + FromTickFloat(cache)). Cache after resolution = FloatTicks(Normalize(resolvedAnchor - (entryCurrentPair + oneTick))). Recompute each shot; do not hard-code the observed cache or phase.',
      },
      readiness={
        'closed':'The ordinary interior held-deadline clock has a native producer, typed caller and scoped-time consumer chain. It can replace the earlier unsupported assumption for that bounded path.',
        'notAProductionPatch':'The final serialized-command player-pair presence flag, actual live resolver status, and pre/post cache were not sampled. First-press trainer clock mapping and delayed/no-history cases remain separate.',
        'nextUsefulEvidence':'A callback-bound trace of resolver entry current pair, next-primary pair, selected history status and pre/post cache would establish live branch applicability. It should retain command identity and final selected protobuf player-pair presence rather than infer them from polling.',
      },
      limits=[
        'The current full server hash is verified. The retained inspection read 12,000 bounded bytes plus movement RTTI/table words; its ranges and current-hash REA identities are reported separately.',
        'The preprocessing virtual call is retained in the earlier footstep disassembly and was exercised by its current-hash supplied-command oracle. This pass reread the initializer prefix and typed override, not that virtual instruction itself.',
        'No native execution or live invocation trace was performed here. The prior oracle had no weapon and stubbed time-domain helpers; it supports caller reachability, not held-shot runtime branches.',
        'Interior deadline fractions are covered by the clock conclusion. Exact zero/end-boundary, overdue or newly reset deadlines, special command flags, domain disagreement and active clamp states are not generalized.',
        'The camera sampler reads its own current-time accessor while the recoil anchor comes from command history. A proved held deadline clock does not collapse these two clocks or justify a constant camera delay.',
        'Source mapping/count<=4 proves ordinary reduction cannot drop the sole captured entry. It does not prove final command association or the unobserved player-field presence gate.',
        'R8 is excluded. This clock proof does not change production behavior.',
      ])
    destination = args.out or out/'portable-proof.json'
    destination.write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps(dict(checkedInstructions=n,freshCodeBytes=12000,typedMovementSlots=4,
                         retainedReaIdentities=len(identities),interiorHeldShots=len(held),
                         report=str(destination))))


if __name__ == '__main__':
    main()
