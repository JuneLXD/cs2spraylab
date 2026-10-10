"""Decode retained runtime008 serialization metadata and bind its native path.

Streaming JSON arithmetic and retained current-hash disassembly only. No game,
native execution, demo parsing, bridge, binary scan, repository edit or network.
Raw member locations remain in this local probe/layout artifact.
"""
import argparse
import collections
import hashlib
import json
import struct
from pathlib import Path

AUDIT = Path(__file__).resolve().parents[2] / 'native-audit'
EXPECTED_CLIENT = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
NAMES = ('native_reaudit_history_001', 'native_reaudit_bob_007')


def sha(path):
    h = hashlib.sha256()
    with path.open('rb') as source:
        while block := source.read(1024*1024):
            h.update(block)
    return h.hexdigest()


def check_instructions(directory):
    report_path = directory / 'report.json'
    report = json.loads(report_path.read_text())
    assert report['artifacts']['client']['sha256'] == EXPECTED_CLIENT
    checks = {
        'client-read-frame-input.txt': [
            '1b08b40: cmp byte ptr [rdi + 0xbbd], 0',
            '1b08b47: je 0x1b08b50',
            '1b08b49: ret ',
            '1b08cae: pcmpeqd xmm0, xmm0',
            '1b08cba: movups xmmword ptr [r14 + 0x50], xmm0',
            '1b08cd5: mov dword ptr [r12 + 0x54], 0xffffffff',
            '1b08d4f: mov dword ptr [r12 + 0x50], eax',
        ],
        'client-create-move.txt': [
            '1b1f71a: call 0x1b08b40',
            '1b1f731: mov ebx, dword ptr [r15 + 0xbc8]',
            '1b1f7c2: cmp dword ptr [rbp - 0x100], 4',
            '1b1f7c9: jle 0x1b202b0',
            '1b1f7cf: mov rax, qword ptr [rip + 0x2e2b4c2]',
            '1b1f7d6: movzx eax, byte ptr [rax + 0x58]',
            '1b1f7e2: je 0x1b202b0',
            '1b1f80a: mov dword ptr [rax + 0x58], 1',
            '1b1f833: mov dword ptr [rax + 0x58], 0',
            '1b1f9f6: mov dword ptr [r15 + 0x5c], eax',
            '1b1fa10: cmp edx, -1',
            '1b1fa13: je 0x1b1fb88',
            '1b1fa7f: call 0x1ae61f0',
            '1b1fa91: mov dword ptr [r15 + 0x54], eax',
            '1b1fdb8: mov r8d, dword ptr [rax + 0x54]',
            '1b1fdc7: mov dword ptr [rax + 0x4c], r8d',
            '1b200e7: mov dword ptr [r14 + 0x5c], eax',
            '1b200f9: cmp ecx, -1',
            '1b200fc: je 0x1b20230',
            '1b20169: call 0x1ae61f0',
            '1b2017b: mov dword ptr [r14 + 0x54], eax',
            '1b202b7: mov ecx, dword ptr [rax + 0xbc8]',
            '1b202e3: mov dword ptr [r12 + 0x30], esi',
            '1b20311: call 0x1ae61f0',
            '1b20322: sub eax, 1',
            '1b20325: mov dword ptr [rbx + 0x54], eax',
            '1b20338: cmp dword ptr [r15 + 0xbc8], r14d',
            '1b2049b: mov r8d, dword ptr [rax + 0xbc0]',
            '1b204b7: mov dword ptr [rax + 0x4c], r8d',
            '1b205b2: mov edx, 0x60',
            '1b205b7: call 0xc7c410',
            '1b205de: mov dword ptr [rax + 0xbc8], edx',
            '1b205e6: mov dword ptr [rax + 0xbc0], 0',
            '1b20a38: mov byte ptr [rbx + 0xbbd], 0',
            '1b20a3f: mov qword ptr [rbx + 0xbc0], 0xffffffffffffffff',
            '1b20a4a: mov dword ptr [rbx + 0xbc8], 0',
        ],
        'client-frame-serialization.txt': [
            '1ae621a: mov eax, dword ptr [rdi]',
            '1ae622b: mov dword ptr [rbx + 0x60], eax',
            '1ae6241: movss dword ptr [rbx + 0x64], xmm0',
            '1ae6246: cmp byte ptr [rdi + 0xca], 0',
            '1ae624d: je 0x1ae6273',
            '1ae624f: mov eax, dword ptr [r12 + 8]',
            '1ae625f: mov dword ptr [rbx + 0x68], eax',
            '1ae6262: movss xmm0, dword ptr [r12 + 0xc]',
            '1ae626e: movss dword ptr [rbx + 0x6c], xmm0',
        ],
    }
    files, total = [], 0
    for name, expected in checks.items():
        path = directory / name
        lines = path.read_text().splitlines()
        for instruction in expected:
            assert instruction in lines, instruction
            total += 1
        files.append(dict(name=name, sha256=sha(path), checkedInstructions=len(expected)))
    return dict(clientSha256=EXPECTED_CLIENT, sourceReportSha256=sha(report_path),
                checkedSavedInstructions=total, files=files,
                boundedRangeBindings=[{k:v for k,v in r.items() if k != 'address'} for r in report['ranges'] if r['file'] in checks],
                limit='Current-hash retained ranges and instructions; no fresh binary read or native execution in this probe.')


def analyze(path):
    counts, metadata, phase = collections.Counter(), collections.Counter(), collections.Counter()
    selected, unique, previous = [], set(), None
    entries = rows = changes_after_serialization = 0
    for line in path.open():
        assert len(line) < 1024*1024
        row = json.loads(line)
        rows += 1
        h = row['extra']['frameHistory']
        fields, guards = h['fields'], h['guardBlocks']
        header = bytes.fromhex(guards[3][1])
        assert len(header) == 48
        primary, _, count = struct.unpack_from('<3i', header, 4)
        pointer = struct.unpack_from('<Q', header, 20)[0]
        assert count == fields['inputCount'] and primary == fields['primaryAttackIndex']
        assert 0 <= count <= 32 and count == len(fields['inputEntries'])
        counts[count] += 1
        decoded = []
        if count:
            blocks = [bytes.fromhex(v) for a,v in guards if a == pointer and len(v) == count*96*2]
            assert len(blocks) == 1
            block = blocks[0]
            for index, entry in enumerate(fields['inputEntries']):
                record = block[index*96:(index+1)*96]
                render_tick, render_frac, player_tick, player_frac = struct.unpack_from('<ifif',record)
                frame, mapped, marker, bucket = struct.unpack_from('<4i', record, 80)
                assert dict(tick=render_tick, fraction=render_frac) == entry['render']
                assert dict(tick=player_tick, fraction=player_frac) == entry['player']
                assert frame == entry['frame']
                entries += 1
                metadata[(mapped, marker, bucket)] += 1
                phase[(bool(header[1]), mapped >= 0)] += 1
                unique.add((frame, player_tick, player_frac, render_tick, render_frac))
                decoded.append(dict(frame=frame, sourceIndex=index, serializedOutputIndex=mapped,
                                    retentionMarker=marker, reductionBucket=bucket,
                                    player=entry['player'], render=entry['render']))
                if primary == index:
                    selected.append(dict(monotonic=row['monotonic'], inputReadDisabled=bool(header[1]),
                                         inputCount=count, **decoded[-1]))
        camera = fields['cameraAnchor']
        if previous is not None and previous != camera and any(v['serializedOutputIndex'] >= 0 for v in decoded):
            changes_after_serialization += 1
        previous = camera
    return dict(name=path.stem, snapshotSha256=sha(path), rows=rows, inputCountRows=dict(sorted(counts.items())),
                inputEntries=entries, uniqueInputEntries=len(unique),
                observedMetadata=[dict(serializedOutputIndex=k[0], retentionMarker=k[1], reductionBucket=k[2], rows=v)
                                  for k,v in sorted(metadata.items())],
                serializationAndEarlyReturnGate=[dict(inputReadDisabled=k[0], appendCompleted=k[1], rows=v)
                                                for k,v in sorted(phase.items())],
                selectedPrimaryRecords=selected, observedCameraChangesWithSerializedInput=changes_after_serialization)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--audit-root', type=Path, default=AUDIT)
    p.add_argument('--out', type=Path)
    args = p.parse_args()
    directory = args.audit_root / 'reports/reaudit-motion-runtime-008'
    binding = check_instructions(args.audit_root / 'reports/reaudit-client-history')
    cases = [analyze(directory / (name+'-snapshot.jsonl')) for name in NAMES]
    assert sum(c['inputEntries'] for c in cases) == 4088
    assert sum(len(c['selectedPrimaryRecords']) for c in cases) == 3
    result = dict(method=__doc__, probeSha256=sha(Path(__file__)), nativeBinding=binding, cases=cases,
                  resolved=[
                      'Every nonempty observed source history has exactly one entry, with serialized output index zero and untouched retention/bucket markers.',
                      'Input-record initialization sets the serialized index to minus one. The observed zero is written by CreateMove only after that source record has passed through the serializer and an output entry has been appended.',
                      'Count at most four bypasses reduction regardless of its control setting. The ordinary path serializes each source record and forwards a valid selected attack index without remapping.',
                      'All three observed primary records are source zero and serialized zero. The reduction setting therefore cannot explain or alter the first-press phase in this capture.',
                      'In the reduced path, selected attack records are explicitly marked for retention and copied through the same serializer; their output indices are then read from per-source mapping fields.',
                      'The serializer copies render tick/fraction directly. Its prediction-state gate controls copying player tick/fraction; no time normalization or averaging is performed by these direct stores.',
                  ],
                  branches={
                      'ordinary': 'Input count <=4 or reduction control false: append every input record and forward the selected source attack index.',
                      'reduced': 'More than four and control true: retain marked primary/secondary entries, choose representatives for other temporal buckets, and use the selected entry output-index mapping.',
                      'regressedPlayerTicks': 'Before reduction, if the last input player integer tick is less than the first, copy the last record to the first, collapse source count to one, and turn any set attack indices into zero.',
                      'invalidIndex': 'Indices beyond source/output count are reset to minus one; malformed negative values other than the sentinel are outside this inspection.',
                      'playerPairGate': 'Prediction flag true copies player fields and sets their protobuf presence bits; the flag value and final outgoing protobuf were not captured.',
                      'cleanup': 'The retained cleanup function clears the input early-return flag, selected indices and source count. Its external caller and the flag-setting site remain outside this proof.',
                  },
                  readiness={
                      'closed': 'Ordinary one-entry serialization/reduction can be removed as the blocker for the three captured first presses.',
                      'stillConditional': 'The final player-pair presence gate is not sampled; selected anchors equal the source player pair, but this is not a final serialized-command or resolver callback trace.',
                      'nextNarrowQuestion': 'Bind the held resolver entry current pair and the timing-cache update to the native time-control caller; this changes two-clock camera implementation readiness more than modeling unused reduction buckets.',
                      'trainer': 'A trainer still needs a separately retained presented player clock and camera sampling clock, with an evidence-backed input/render phase mapping and delayed/no-history boundaries.',
                  },
                  deferredCaptureFields=[
                      'Prediction player-history serialization-enabled byte (bound local layout in reaudit-history-serialization-layout.json).',
                      'Final command history count, selected attack index and selected player-pair presence/value, only after a typed command pointer/caller is proved.',
                      'Resolver current pair, pre/post cached timing difference and exact/interpolated/last/no-history status at the shot boundary.',
                  ],
                  limits=[
                      'Stable read-only polling, not an atomic cross-object or native invocation trace. A disabled input-reader flag does not establish exact CreateMove phase without its setter/caller lifetime.',
                      'Serialized source metadata proves a completed append for that retained record, not all later validation or transport of the final command.',
                      'Runtime008 does not exercise source count >1, reduction, backwards player ticks or invalid attack indices.',
                      'Selected-entry retention is statically bounded; the complete unselected-record representative algorithm is not implemented or emulated.',
                  ])
    destination = args.out or args.audit_root / 'reports/reaudit-history-serialization.json'
    destination.write_text(json.dumps(result,indent=2,allow_nan=False)+'\n')
    print(json.dumps(dict(output=str(destination), instructionChecks=binding['checkedSavedInstructions'],
                         cases=[{k:c[k] for k in ['name','rows','inputCountRows','inputEntries','uniqueInputEntries','observedMetadata','selectedPrimaryRecords']} for c in cases]), indent=2))


if __name__ == '__main__':
    main()
