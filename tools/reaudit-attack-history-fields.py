"""Bounded ELF proof linking command-history protobuf tags to resolver inputs.

Requires retained native-audit/python packages. Reads only the installed server;
never starts a game, bridge, or analysis service. Output stays in native-audit.
Addresses and native object layout are intentionally confined to this probe and
its local evidence, not application source or user-facing documentation.
"""
import hashlib
import json
import mmap
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
sys.path.insert(0, str(ROOT / 'python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile

SERVER = ROOT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
EXPECTED_SHA = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
cs = Cs(CS_ARCH_X86, CS_MODE_64)
cs.detail = True

with SERVER.open('rb') as handle:
    elf = ELFFile(handle)
    segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz'])
                for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
    data = mmap.mmap(handle.fileno(), 0, access=mmap.ACCESS_READ)
    digest = hashlib.sha256(data).hexdigest()
    assert digest == EXPECTED_SHA, 'Current-hash addresses must be re-established for another build'

    def offset(address):
        return next(b + address - a for a, b, c in segments if a <= address < a + c)

    def address(file_offset):
        return next(a + file_offset - b for a, b, c in segments if b <= file_offset < b + c)

    def read(start, size):
        assert 0 < size <= 0x3000
        pos = offset(start)
        return data[pos:pos + size]

    def refs(value):
        needle, pos, found = struct.pack('<Q', value), 0, []
        while (pos := data.find(needle, pos)) >= 0:
            found.append(address(pos))
            pos += 8
            assert len(found) < 128
        return found

    def discover(name, parser, table, self_register, fields):
        mangled = f'{len(name)}{name}'.encode() + b'\0'
        pos = data.find(mangled)
        assert pos >= 0 and data.find(mangled, pos + 1) == -1
        name_address = address(pos)
        matches = []
        for name_ref in refs(name_address):
            # RTTI stores its name pointer after its own virtual-table pointer.
            for rtti_ref in refs(name_ref - 8):
                values = struct.unpack('<18Q', read(rtti_ref, 18 * 8))
                if parser in values:
                    matches.append(dict(rtti=hex(name_ref - 8), vtable=hex(rtti_ref + 8),
                                        parserSlot=values.index(parser) - 1))
        assert len(matches) == 1, f'RTTI-linked parser must be unique: {name}'
        result = dict(message=name, rttiLink=matches[0], parser=hex(parser), fields=[])
        for number, wire, field_name, member_offset in fields:
            displacement = struct.unpack('<i', read(table + number * 4, 4))[0]
            entry = table + displacement
            instructions = list(cs.disasm(read(entry, 0x50), entry))
            first = instructions[0]
            assert first.mnemonic == 'cmp' and first.operands[1].imm == number * 8 + wire
            stores = [i for i in instructions if i.mnemonic == 'mov' and
                      i.operands[0].type == 3 and
                      cs.reg_name(i.operands[0].mem.base) == self_register and
                      i.operands[0].mem.disp == member_offset]
            assert stores, f'No tag-to-member store: {field_name}'
            result['fields'].append(dict(name=field_name, protobufTag=number,
                                         wireType=wire, memberOffset=hex(member_offset),
                                         branch=hex(entry), store=hex(stores[0].address)))
        return result

    entry = discover('CSGOInputHistoryEntryPB', 0x143d000, 0x81b2ec, 'rbx', [
        (4, 0, 'render_tick_count', 0x60), (5, 5, 'render_tick_fraction', 0x64),
        (6, 0, 'player_tick_count', 0x68), (7, 5, 'player_tick_fraction', 0x6c),
    ])
    command = discover('CSGOUserCmdPB', 0x143d6b0, 0x81b404, 'r12', [
        (6, 0, 'attack1_start_history_index', 0x3c),
        (7, 0, 'attack2_start_history_index', 0x40),
    ])
    # Four independent member accesses share the same embedding displacement:
    # attack 1, attack 2, repeated-history count, repeated-history storage.
    command['resolverEmbeddingChecks'] = {
        'attack1': [0x3c, 0x4c], 'attack2': [0x40, 0x50],
        'historyCount': [0x20, 0x30], 'historyStorage': [0x28, 0x38],
    }
    assert {b - a for a, b in command['resolverEmbeddingChecks'].values()} == {0x10}
    expected_reads = {
        0x1497d20: 'rax, dword ptr [rax + 0x4c]',
        0x1497920: 'rax, dword ptr [rax + 0x50]',
        0x1497933: 'eax, dword ptr [rcx + 0x30]',
        0x149793c: 'rdx, qword ptr [rcx + 0x38]',
        0x1497949: 'edi, dword ptr [rbx + 0x68]',
        0x149794f: 'xmm0, dword ptr [rbx + 0x6c]',
        0x14979fc: 'esi, dword ptr [rbx + 0x60]',
        0x1497a06: 'xmm0, dword ptr [rbx + 0x64]',
    }
    for location, operands in expected_reads.items():
        assert next(cs.disasm(read(location, 16), location)).op_str == operands

    evidence_names = ['select', 'resolver', 'pair-compare', 'pair-arithmetic',
                      'pair-subtract', 'pair-increment', 'pair-constructor',
                      'pair-from-ticks', 'current-time-pair', 'tick-domains',
                      'entry-parser', 'usercmd-parser', 'protobuf']
    evidence = {}
    for name in evidence_names:
        path = ROOT / 'reports' / f'reaudit-attack-history-{name}.json'
        assert path.exists(), f'Run retained inspection/schema probe first: {path.name}'
        evidence[path.name] = hashlib.sha256(path.read_bytes()).hexdigest()
    report = {
        'method': __doc__, 'serverSha256': digest,
        'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        'fieldProof': [entry, command], 'evidenceSha256': evidence,
        'resolved': [
            'Generated parser wire-tag stores identify the exact player/render tick and fraction members read by the resolver.',
            'Primary and secondary paths select their corresponding attack-start history indices. Invalid or out-of-range indices enter the calculated/history fallback.',
            'The exact-history path converts the selected player clock into the weapon context, normalizes it, then clamps it between current-time pair minus three ticks and current-time pair plus one tick.',
            'The selected entry render-time pair is separate from the first output pair passed to recoil.',
            'The calculated candidate is next-attack pair plus one tick plus the cached timing difference, normalized as a tick pair.',
            'The caller refreshes that timing difference as resolved first pair minus current-time pair minus one tick, represented as a float number of ticks.',
            'The fallback searches a 32-entry history ring. Its interpolated and last-history paths retain the calculated first pair and resolve the separate render pair and pose. No-history paths can replace or bound the first pair.',
        ],
        'conditionalInference': [
            'When the shot-time current pair equals the shot schedule, and the calculated candidate is retained, the caller/cache recurrence preserves the initial camera-anchor minus schedule difference across held shots. This explains the constant per-burst demo differences without fitting a constant.',
            'The recurrence alone does not establish which branch each recorded shot took or the player command-history entry that set the initial difference.',
        ],
        'missingNativeState': [
            'For every shot: primary/secondary attack-history index, input_history count and selected entry player/render tick pairs.',
            'Current-time tick/fraction and weapon/prediction tick-domain conversion state at resolver entry and camera sampling.',
            'Resolver status (exact/interpolated/last/no-history), cached timing difference before and after, and original next-attack pair.',
            'If fallback selected: ordered history-ring player/render pairs, ring indices/count, and any clamp or stale-history branch.',
            'Client-side history construction from physical input and render/prediction frames, to map trainer DOM timestamps to comparable native history.',
        ],
        'trainerBoundary': {
            'input': 'src/range/input-clock.ts uses one monotonic DOM/render clock.',
            'trigger': 'src/range/simulation.ts pressTrigger/start retain held state and scheduled nextShot; there is no corresponding command input_history or attack-start index.',
            'camera': 'src/range/simulation.ts passes processing time to viewPunch.add while scheduled processingDelay is used by recoil recovery.',
            'decision': 'Preserve production behavior. Two native clocks are established, but the live trainer-to-native command-history mapping is missing. No fitted offset or schedule-only camera correction is justified.',
        },
        'limits': [
            'This is bounded static inspection of one installed server hash, not native resolver execution or per-shot branch telemetry.',
            'Client history generation and nonfinite/malformed protobuf inputs are outside this probe.',
            'The earlier pair-from-seconds artifact name was provisional: that helper only increments the integer tick; pair-increment is its corrected artifact.',
        ],
    }
    out = ROOT / 'reports/reaudit-attack-history-resolution.json'
    out.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'serverSha256': digest, 'provedFields': 6,
                      'resolverMemberChecks': len(expected_reads), 'output': str(out)}))
