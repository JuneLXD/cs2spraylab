"""Hash-bound static movement/body clock proof; no game execution.

Default verifies the whole client hash. --bounded-only checks retained exact
ranges but explicitly does not re-establish the full artifact digest.
"""
import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / 'native-audit'
CLIENT_SHA256 = 'eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1'
RANGES = [
 ('body-context-tick', 20487232, 144, 'cb73524306111e4c278c68b26fb31a4eaf547bc27c06c31db4cf26114c0ff739'),
 ('body-tick-provider', 25114048, 192, 'fd8f3b3bef56d916715f2c08076d17d91d91cbe410a9d13e4becc9290eee7a94'),
 ('game-rules-tick', 26559056, 576, 'fcc1b80308f693123fe113cdd624cb24a270ac5a583b00a1ae29c1eedb383553'),
 ('game-rules-default-tick', 26559600, 144, '4645e6f7f4523622a40799f6366969b2c35b1e2ae07e49acee251314d2a3917c'),
 ('movement-command-to-post', 24781920, 2976, '895b576f792904ac499c88a5d0bc22be0df2a1555b82b3ee22814bd764e34d36'),
 ('movement-command-clock-tail', 24784616, 624, '4db08dd012809391cf3cb9ff8ff28f8395ee61affd8428b0f9de6bd54d80f4d4'),
 ('movement-controller-getter', 24913856, 256, '4d96b78308e9cea6ad95025dc0ca0b6aaaf897fbe2b8f854adadd1b0c1bbcb49'),
 ('controller-tick-getter', 23204064, 272, 'f9eb9598dcbb410ecaa80871edc610cca43c6ae22a21f276ab7578a9bfdb9e10'),
 ('processed-command-publish', 24734160, 800, '57f8a8b980fde94490a1309313f49af6945b79c08eb0bb86316383eb3722fb15'),
 ('cs-command-wrapper', 22812976, 512, '0a6364d191eac250b6138648312d2a9a81b2c4dc5e19b5639d0ff647ed642176'),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bounded-only', action='store_true')
    args = parser.parse_args()
    sys.path.insert(0, str(ROOT / 'python'))
    from elftools.elf.elffile import ELFFile
    from capstone import Cs, CS_ARCH_X86, CS_MODE_64
    path = ROOT.parent / 'cs2-game/game/csgo/bin/linuxsteamrt64/libclient.so'
    if not args.bounded_only:
        digest = hashlib.sha256()
        with path.open('rb') as source:
            for chunk in iter(lambda: source.read(1024*1024), b''):
                digest.update(chunk)
        assert digest.hexdigest() == CLIENT_SHA256
    with path.open('rb') as source:
        elf = ELFFile(source)
        segments = [(s['p_vaddr'], s['p_offset'], s['p_filesz']) for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD']
        def read(a, n):
            assert n <= 4096
            v, o, z = next(s for s in segments if s[0] <= a and a+n <= s[0]+s[2])
            source.seek(o+a-v)
            raw = source.read(n)
            assert len(raw) == n
            return raw
        def q(a): return struct.unpack('<Q', read(a, 8))[0]
        cs = Cs(CS_ARCH_X86, CS_MODE_64)
        instructions = {}
        for name, a, n, digest in RANGES:
            raw = read(a, n)
            assert hashlib.sha256(raw).hexdigest() == digest, name
            instructions.update({i.address: f'{i.mnemonic} {i.op_str}' for i in cs.disasm(raw, a)})
        assertions = {
          0x1389c55: 'jmp 0x1954250',
          0x17f35d2: 'movss xmm0, dword ptr [rax + 0x50]',
          0x17f35ec: 'call 0x2f032a0',
          0x17f35ff: 'seta al',
          0x195426a: 'mov rax, qword ptr [rax + 0x218]',
          0x1954278: 'mov r12d, dword ptr [rcx + 0x44]',
          0x1954288: 'cmp byte ptr [rdi + 0x38], 0',
          0x195428e: 'mov eax, dword ptr [rdi + 0x34]',
          0x19542ae: 'sub r12d, dword ptr [rbx + 0x30]',
          0x19542e8: 'cmp r12d, eax',
          0x19542ed: 'sub eax, dword ptr [rdi + 0x30]',
          0x17a24bc: 'movss xmm0, dword ptr [rbx + 0x30]',
          0x17a2500: 'mov dword ptr [rbx + 0x50], 0',
          0x17a2507: 'cvttss2si edx, xmm0',
          0x17a2520: 'mov dword ptr [rbx + 0x44], edx',
          0x17a25eb: 'mov qword ptr [rax], rdi',
          0x17a25dd: 'lea rax, [rip + 0x317d10c]',
          0x17a26f1: 'call 0x17a1f60',
          0x17a270c: 'call qword ptr [rax + 0x160]',
          0x17a27e4: 'call qword ptr [rax + 0xf8]',
          0x17a288e: 'mov qword ptr [rax], 0',
          0x17a2901: 'movss dword ptr [rbx + 0x50], xmm4',
          0x17a2906: 'mov qword ptr [rbx + 0x30], rax',
          0x17a290d: 'mov dword ptr [rbx + 0x44], eax',
          0x17a2c25: 'call 0x16210e0',
          0x17a2bb2: 'lea rax, [rip + 0x2f2e5c7]',
          0x17a2c45: 'mulss xmm0, xmm1',
          0x17a2c63: 'mov dword ptr [r14 + 0x50], 0',
          0x17a2c93: 'mov dword ptr [r14 + 0x44], ecx',
          0x17a2d50: 'call 0x17a2460',
          0x17a2d8a: 'mov qword ptr [r14 + 0x30], r15',
          0x17a2d97: 'mov dword ptr [r14 + 0x44], eax',
          0x17a2d9f: 'movss dword ptr [r14 + 0x50], xmm3',
          0x17a2fcb: 'call 0x16210e0',
          0x17a2fd3: 'lea esi, [rax + 1]',
          0x17a2fd6: 'call 0x16210d0',
          0x16210e0: 'mov eax, dword ptr [rdi + 0x838]',
          0x17c27c4: 'mov ecx, dword ptr [rax + 0x1444]',
          0x17c27cf: 'mov rsi, qword ptr [rip + 0x2ef492a]',
          0x1796b90: 'mov eax, dword ptr [r13 + 8]',
          0x1796b98: 'mov dword ptr [r15 + 0x188], eax',
          0x15c19a0: 'jmp 0x17a2ae0',
          0x15c19b0: 'jmp 0x17969d0',
        }
        for a, expected in assertions.items(): assert instructions[a] == expected, (hex(a), instructions.get(a))
        classes = [(0x446eea8, '13C_CSGameRules'), (0x44bf148, '26CCSPlayer_MovementServices'),
                   (0x44bd1c8, '19CCSPlayerController')]
        for vt, name in classes:
            assert q(vt-16) == 0
            assert read(q(q(vt-8)+8), len(name)+1) == (name+'\0').encode()
        for vt, slot, target in [(0x446eea8, 0x218, 0x1954470), (0x44bf148, 0x108, 0x15c19a0),
                                  (0x44bf148, 0xf8, 0x15c19b0), (0x44bf148, 0x160, 0x15c22c0)]:
            assert q(vt+slot) == target
        fields = [(0x4639a00, 'm_nTotalPausedTicks', 0x30), (0x4639a20, 'm_nPauseStartTick', 0x34),
                  (0x4639a40, 'm_bGamePaused', 0x38), (0x46739c0, 'm_nTickBase', 0x838),
                  (0x4641800, 'm_hController', 0x1444), (0x4678000, 'm_nLastCommandNumberProcessed', 0x188)]
        for descriptor, name, offset in fields:
            assert read(q(descriptor), len(name)+1) == (name+'\0').encode()
            assert struct.unpack('<I', read(descriptor+16, 4))[0] == offset
        for a, value in [(0xaffdb8, 1/64), (0xaffeb8, 64), (0xaffe14, .5)]:
            assert struct.unpack('<f', read(a, 4))[0] == value
    result = dict(clientSha256=CLIENT_SHA256, wholeArtifactHashVerified=not args.bounded_only,
      provenance='Static current-client bytes, RTTI, vtables and schema; no invocation count or live capture.',
      ranges=[dict(name=n, bytes=z, sha256=h) for n,a,z,h in RANGES],
      assertions=dict(instructions=len(assertions), classes=len(classes), virtualTargets=4, schemaFields=len(fields), constants=3),
      findings=[
       'The context-zero body timer uses C_CSGameRules pause accounting, not a CPrediction tick override.',
       'The ordinary command wrapper seeds time from the owner controller tick base, clears fractional time, invokes the inner movement wrapper, then restores globals.',
       'The inner wrapper recomputes tick as trunc(float32(float32(currentTime*64)+0.5)), clears fraction, invokes postprocessing, then restores globals.',
       'The visible normal branch invokes the body postprocess once after its subtick movement routine; mode3 bypasses that branch.',
       'The processed-command field is published after the body postprocess. Polling that field cannot count body calls.',
      ], limits=[
       'No claim that a sampled restored clock is the clock consumed by retained body state.',
       'Controller tick base and scoped activity markers have not yet been captured beside body state.',
       'Upstream scheduling, repeated prediction passes, mode meanings and resets remain unbound.',
       'Only normalized finite fractions and controller tick bases below 2^23 are reconstructed by the prepared capture helper.',
      ])
    out = ROOT/'reports/reaudit-body-clock/static-proof.json'
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(result, indent=2)+'\n')
    (Path(__file__).resolve().parents[1]/'docs/evidence/reaudit-body-clock.json').write_text(json.dumps(result, indent=2)+'\n')
    print(json.dumps(result))

if __name__ == '__main__': main()
