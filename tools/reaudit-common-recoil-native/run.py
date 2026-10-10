"""Reproduce the bounded current-native recoil proof in a new local directory.

Run this process under the documented systemd memory/CPU cap. Children run
serially and inherit the scope. Existing output paths are never overwritten.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from _common import DEFAULT_ROOT, REPO

HERE = Path(__file__).resolve().parent
ORIGINAL_NATIVE_SHA = '78cb88141a756e7fab98891a69a0c65108997d53e3947852de9381b3413327d8'


def sha(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(1 << 20), b''):
            value.update(block)
    return value.hexdigest()


def original_files(directory):
    names = ('read-cache-builder.py', 'read-current.py', 'read-rng.py',
             'read-inputs.mjs', 'emulate-current.py', 'native-inputs.json',
             'native-tables.json', 'trainer-comparison.json')
    paths = [directory / name for name in names]
    for stage in ('current', 'arithmetic', 'rng'):
        paths.extend(sorted(p for p in (directory / stage).iterdir() if p.is_file()))
    return {str(path.relative_to(directory)): sha(path) for path in paths}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=DEFAULT_ROOT)
    parser.add_argument('--output', type=Path, required=True, help='NEW local run directory')
    parser.add_argument('--portable-report', type=Path,
                        help='Optional NEW sanitized JSON output; local copy is always written')
    args = parser.parse_args()
    root, output = args.root.resolve(), args.output.resolve()
    portable = args.portable_report.resolve() if args.portable_report else None
    assert not output.exists(), 'Refuse to overwrite a retained run directory'
    assert portable is None or not portable.exists(), 'Refuse to overwrite portable evidence'
    original = root / 'native-audit/reports/core-shooting-next/common-recoil-table'
    assert sha(original / 'native-tables.json') == ORIGINAL_NATIVE_SHA
    originals_before = original_files(original)
    tools_before = {p.name: sha(p) for p in sorted(HERE.iterdir()) if p.is_file()}
    output.mkdir(parents=True, exist_ok=False)
    environment = dict(os.environ, PYTHONDONTWRITEBYTECODE='1')
    stages = []
    for name in ('read-cache-builder.py', 'read-current.py', 'read-rng.py',
                 'read-inputs.mjs', 'emulate-current.py'):
        command = ['node' if name.endswith('.mjs') else sys.executable,
                   str(HERE / name), '--root', str(root), '--output', str(output)]
        log = output / (name + '.log')
        with log.open('x') as stream:
            result = subprocess.run(command, stdout=stream, stderr=subprocess.STDOUT,
                                    env=environment, check=False)
        stages.append({'stage': name, 'exitCode': result.returncode, 'logSha256': sha(log)})
        print(json.dumps(stages[-1]), flush=True)
        assert result.returncode == 0, f'{name} failed; inspect its retained log. No retry.'
    assert tools_before == {p.name: sha(p) for p in sorted(HERE.iterdir()) if p.is_file()}
    assert originals_before == original_files(original), 'Original proof changed during replay'
    from summarize import summarize
    evidence = summarize(root, output, original, tools_before, originals_before, stages)
    raw = json.dumps(evidence, indent=2, allow_nan=False) + '\n'
    # Addresses, disassembly and machine operands stay in the local raw outputs.
    assert '0x' not in raw and '/home/' not in raw
    local = output / 'portable-evidence.json'
    local.write_text(raw)
    if portable is not None:
        portable.parent.mkdir(parents=True, exist_ok=True)
        with portable.open('x') as stream:
            stream.write(raw)
    print(json.dumps({'result': 'pass', 'tableEntries': evidence['tableEntries'],
                      'packagedReplayMatchesOriginal': True,
                      'portableReportSha256': sha(local), 'output': str(output)}), flush=True)


if __name__ == '__main__':
    main()
