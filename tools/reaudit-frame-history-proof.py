"""Current native bindings for the read-only presented/input history capture.

Stream both full artifact hashes, then inspect only named bounded byte ranges.
This proves layouts and native producers, not observation of a live callback.
"""
import hashlib
import json
import runpy
import struct
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
AUDIT = REPO.parent / 'native-audit'


def main():
    sys.path.insert(0, str(AUDIT / 'python'))
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    from elftools.elf.elffile import ELFFile
    helper = runpy.run_path(str(REPO / 'tools/reaudit-frame-history-capture-fields.py'))
    cs = Cs(CS_ARCH_X86, CS_MODE_64)
    cs.detail = True
    out = AUDIT / 'reports/reaudit-frame-history-proof'
    out.mkdir(parents=True, exist_ok=True)
    artifacts, ranges, checks = [], [], []

    for side, relative, expected in [
        ('client', 'game/csgo/bin/linuxsteamrt64/libclient.so', helper['CLIENT_SHA256']),
        ('engine', 'game/bin/linuxsteamrt64/libengine2.so', helper['ENGINE_SHA256']),
    ]:
        path = REPO.parent / 'cs2-game' / relative
        digest = hashlib.sha256()
        with path.open('rb') as source:
            while chunk := source.read(1024*1024): digest.update(chunk)
        assert digest.hexdigest() == expected, 'Rebind changed native artifact'
        artifacts.append(dict(side=side, sha256=expected, wholeArtifactHashVerified=True))
        with path.open('rb') as source:
            segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in ELFFile(source).iter_segments() if s['p_type'] == 'PT_LOAD']

            def read(a, n):
                assert 0 < n <= 8192
                v, o, _ = next(s for s in segments if s[0] <= a and a+n <= s[0]+s[2])
                source.seek(o+a-v)
                raw = source.read(n)
                assert len(raw) == n
                return raw

            def q(a): return struct.unpack('<Q', read(a, 8))[0]
            def instruction(a, text):
                i = next(cs.disasm(read(a, 15), a))
                assert i.mnemonic + ' ' + i.op_str == text, (hex(a), i.mnemonic, i.op_str)
                checks.append(dict(side=side, address=hex(a), instruction=text))
                return i
            def rip(a, text, target):
                i = instruction(a, text)
                operands = [o for o in i.operands if o.type == 3 and cs.reg_name(o.mem.base) == 'rip']
                assert len(operands) == 1 and i.address+i.size+operands[0].mem.disp == target

            if side == 'client':
                assert q(0x4513600-8) == 0x450d688
                assert read(q(0x450d688+8), 13) == b'10CCSGOInput\0'
                assert q(0x44bcb30-8) == 0x44bc198
                assert read(q(0x44bc198+8), 27).split(b'\0')[0] == b'24CCSPlayer_CameraServices'
                assert q(0x467cb20) == 0x4934440
                rip(0x1b06c50, 'lea r15, [rip + 0x2e43409]', 0x494a060)
                instruction(0x1b06c57, 'mov rdi, r15')
                instruction(0x1b06c5a, 'call 0x1ae6110')
                rip(0x1ae6121, 'lea rax, [rip + 0x2a2d4d8]', 0x4513600)
                instruction(0x1ae613b, 'mov qword ptr [rbx], rax')
                for a, text in [
                    (0x1b08b40, 'cmp byte ptr [rdi + 0xbbd], 0'),
                    (0x1b1f71a, 'call 0x1b08b40'),
                    (0x1b08c27, 'mov r8d, dword ptr [rbx + 0xbc8]'),
                    (0x1b08c53, 'mov edi, dword ptr [rbx + 0xbd8]'),
                    (0x1b08c59, 'cmp r8d, edi'),
                    (0x1b08c3a, 'lea rax, [rax + rax*2]'),
                    (0x1b08c3e, 'shl rax, 5'),
                    (0x1b08c42, 'add rax, qword ptr [rbx + 0xbd0]'),
                    (0x1b08ccd, 'mov qword ptr [r12], rax'),
                    (0x1b08cde, 'mov qword ptr [r12 + 8], rax'),
                    (0x1b08d4f, 'mov dword ptr [r12 + 0x50], eax'),
                    (0x1b08e25, 'mov dword ptr [rbx + r12*4 + 0xbc0], r9d'),
                    (0x1b08dac, 'mov byte ptr [rbx + rsi + 0xbbe], dil'),
                    (0x1b08bfa, 'mov dword ptr [rbx + 0xbe0], edi'),
                    (0x1b08df1, 'mov dword ptr [rbx + 0xbe4], r15d'),
                    (0x1b08feb, 'mov dword ptr [rbx + 0xbe8], r15d'),
                    (0x19327b1, 'mov r15, qword ptr [rbx + 0x12b0]'),
                    (0x198eb48, 'mov edi, dword ptr [rdi + 0x10c]'),
                    (0x198eb65, 'ucomiss xmm0, dword ptr [rax + 0x34]'),
                    (0x198ebc8, 'movss xmm0, dword ptr [rax + 0x3c]'),
                    (0x198eba2, 'mov esi, dword ptr [rax + 0x44]'),
                ]: instruction(a, text)
                selected = [('input-registration', 0x1b06c50, 0x2b), ('input-constructor', 0x1ae6110, 0xe0),
                            ('read-frame-input', 0x1b08b40, 0x850), ('create-move-entry', 0x1b1f6f0, 0x40),
                            ('prediction-clock', 0x198eb40, 0x90), ('camera-sampler', 0x1521ac0, 0x95)]
            else:
                assert q(0x9ccc58+0x568) == 0x4f70b0
                assert q(0x9bb820) == 0x3842d0
                rip(0x388280, 'movsxd rdx, dword ptr [rip + 0x6797c9]', 0xa01a50)
                rip(0x3882a9, 'lea rax, [rip + 0x6797b0]', 0xa01a60)
                rip(0x3842e1, 'mov edx, dword ptr [rip + 0x67d769]', 0xa01a50)
                rip(0x384344, 'lea rax, [rip + 0x67d715]', 0xa01a60)
                for a, text in [
                    (0x3882a5, 'lea rdx, [rax + rax*4]'),
                    (0x3882b0, 'lea rax, [rax + rdx*8]'),
                    (0x3842e7, 'movsd qword ptr [rbx + 0x28], xmm0'),
                    (0x3842ec, 'cmp edx, 9'), (0x384308, 'lea ecx, [rdx + 0xa]'),
                    (0x38430d, 'lock cmpxchg dword ptr [rip + 0x67d73b], ecx'),
                    (0x384315, 'jne 0x3842f1'), (0x384317, 'add edx, 1'),
                    (0x38436a, 'xchg dword ptr [rax], ecx'),
                    (0x3a0339, 'mov dword ptr [rcx + 0x10], r12d'),
                    (0x3a034f, 'mov qword ptr [rcx + 0x14], rbx'),
                    (0x3a0353, 'movq qword ptr [rcx + 8], xmm0'),
                ]: instruction(a, text)
                selected = [('presented-copy', 0x388280, 0x50), ('publisher', 0x3842d0, 0x9e),
                            ('snapshot-construction', 0x3a02d0, 0x95)]
            for name, address, length in selected:
                raw = read(address, length)
                ranges.append(dict(side=side, name=name, address=hex(address), bytes=length, sha256=hashlib.sha256(raw).hexdigest()))
                (out / f'{side}-{name}.txt').write_text('\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(raw, address))+'\n')
    report = dict(artifacts=artifacts, ranges=ranges, instructions=checks, decoder=helper['self_test'](),
                  probeSha256=hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
                  helperSha256=hashlib.sha256((REPO/'tools/reaudit-frame-history-capture-fields.py').read_bytes()).hexdigest(),
                  limits=['Stable polling is not a native invocation trace or an atomic cross-object snapshot.',
                          'Presented callback publication is not physical scanout.',
                          'Sampled prediction state is not assumed to be the state used by an earlier published frame.',
                          'Input array is captured before or after possible serialization/reduction; phase is not inferred.',
                          'Camera pointer/fields reuse caller and private-native proofs in reaudit-viewmodel-native.py and reaudit-camera-native.py.'])
    (out/'report.json').write_text(json.dumps(report, indent=2)+'\n')
    portable = {k:v for k,v in report.items() if k not in ['ranges', 'instructions']}
    portable.update(ranges=[{k:v for k,v in r.items() if k != 'address'} for r in ranges],
                    instructionAssertions=len(checks), method='Current full artifact hashes, exact instructions and native type/storage bindings; no target execution.')
    (REPO/'docs/evidence/reaudit-frame-history-bindings.json').write_text(json.dumps(portable, indent=2)+'\n')
    print(json.dumps(dict(artifacts=artifacts, boundedRanges=len(ranges), bytes=sum(r['bytes'] for r in ranges), instructionAssertions=len(checks), decoder=report['decoder'])))


if __name__ == '__main__': main()
