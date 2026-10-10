"""Selected movement-service input consume body. Current-byte static read only."""
import argparse, hashlib, json, sys
from pathlib import Path
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--root', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
root, output = args.root.resolve(), args.output.resolve()
assert not output.exists(), 'Use a new evidence directory'
sys.path.insert(0, str(root / 'native-audit/python'))
from capstone import Cs, CS_ARCH_X86, CS_MODE_64
from elftools.elf.elffile import ELFFile
expected = 'c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a'
binary = root / 'cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so'
digest = hashlib.sha256()
with binary.open('rb') as stream:
    for block in iter(lambda: stream.read(1 << 20), b''): digest.update(block)
assert digest.hexdigest() == expected
with binary.open('rb') as stream:
    elf = ELFFile(stream)
    at, size = 0x17c3050, 512
    segment = next(s for s in elf.iter_segments() if s['p_type'] == 'PT_LOAD' and s['p_vaddr'] <= at and at + size <= s['p_vaddr'] + s['p_filesz'])
    stream.seek(segment['p_offset'] + at - segment['p_vaddr'])
    code = stream.read(size); assert len(code) == size
cs = Cs(CS_ARCH_X86, CS_MODE_64)
listing = '\n'.join(f'{i.address:x}: {i.mnemonic} {i.op_str}' for i in cs.disasm(code, at)) + '\n'
output.mkdir(parents=True)
(output / 'input-consume-body.txt').write_text(listing)
report = {'method': __doc__, 'serverSha256': expected, 'wholeArtifactHashVerified': True,
    'readerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
    'address': hex(at), 'bytesRead': size, 'codeSha256': hashlib.sha256(code).hexdigest(),
    'listingSha256': hashlib.sha256(listing.encode()).hexdigest(),
    'limits': ['Selected body only. No native execution or input producer/reset lifetime observation.']}
(output / 'current-read.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'bytesRead': size, 'codeSha256': report['codeSha256']}))
