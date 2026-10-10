"""Freeze named input windows from a completed game-only motion capture.

Usage: python3 tools/reaudit-motion-window.py reaudit-motion-runtime-004 native_reaudit_bob_004
Requires a completed sampler; preserves original snapshots and raw source.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capture_directory')
parser.add_argument('names', nargs='+')
parser.add_argument('--verified-terminal-error', action='store_true',
                    help='Use explicit terminal-state evidence after a sampler teardown failure')
args = parser.parse_args()
root = Path(__file__).resolve().parents[2] / 'native-audit/reports'
assert Path(args.capture_directory).name == args.capture_directory
capture = root / args.capture_directory
terminal = None
if args.verified_terminal_error:
    terminal = json.loads((capture / 'verified-terminal-state.json').read_text())
    assert terminal['gameProcessAbsent'] and terminal['recordingCompleted']
    assert not Path('/proc/' + str(terminal['ownedGamePid'])).exists()
else:
    assert json.loads((capture / 'sampler-finished.json').read_text())['exitCode'] == 0
source = capture / 'samples.jsonl'
windows = {}
manifest_path = capture / 'snapshot-manifest.json'
assert not manifest_path.exists(), 'Keep previous manifest; do not overwrite'
for name in args.names:
    assert name.replace('_', '').isalnum()
    raw = (root / (name + '-inputs.jsonl')).read_bytes()
    edges = [json.loads(line) for line in raw.splitlines()]
    snapshot = name + '-snapshot.jsonl'
    windows[name] = {
        'inputSha256': hashlib.sha256(raw).hexdigest(),
        'start': edges[0]['monotonic'] - 1,
        'end': edges[-1]['monotonic'] + edges[-1]['action'].get('wait', 0) + 1,
        'rows': 0, 'snapshot': snapshot,
        'handle': (capture / snapshot).open('xb'), 'hash': hashlib.sha256(),
    }
digest = hashlib.sha256()
try:
    with source.open('rb') as stream:
        for line in stream:
            digest.update(line)
            row = json.loads(line)
            for window in windows.values():
                if window['start'] <= row['monotonic'] <= window['end']:
                    window['handle'].write(line)
                    window['hash'].update(line)
                    window['rows'] += 1
finally:
    for window in windows.values():
        window.pop('handle').close()
for window in windows.values():
    window['snapshotSha256'] = window.pop('hash').hexdigest()
    assert window['rows'] > 20
if terminal:
    assert digest.hexdigest() == terminal['sourceSha256']
manifest = {
    'sourceSha256': digest.hexdigest(), 'sourceBytes': source.stat().st_size,
    'clientSha256': json.loads((capture / 'launch.json').read_text())['clientSha256'],
    'windows': windows,
    'terminalStatus': terminal or {'samplerFinished': True, 'gameExitCode': 0},
}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest, indent=2))
