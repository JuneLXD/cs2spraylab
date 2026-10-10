"""Export address-free HUD states from completed, hash-checked capture windows.

Usage: python3 tools/reaudit-bob-cache-fixture.py reaudit-motion-runtime-003 [other-directory ...]
Writes the portable fixture consumed by reaudit-bob-cache-runtime.py.
"""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('capture_directories', nargs='+')
args = parser.parse_args()
repo = Path(__file__).resolve().parents[1]
root = repo.parent / 'native-audit/reports'
fields = ['frame', 'currentTime', 'frameDelta', 'flags', 'storedVelocity',
          'pawnTransform', 'velocityCache0', 'velocityCache1', 'velocityCacheTimes',
          'velocityHistoryFlags', 'interpolationContext', 'velocityInterpolationEnabled',
          'moveType', 'cycle', 'smoothVelocity', 'bob', 'animationBob', 'air']
fixture = {'schemaVersion': 1, 'fields': fields, 'sources': [], 'captures': []}
for directory in args.capture_directories:
    assert Path(directory).name == directory
    capture = root / directory
    manifest = json.loads((capture / 'snapshot-manifest.json').read_text())
    assert fixture.setdefault('clientSha256', manifest['clientSha256']) == manifest['clientSha256']
    fixture['sources'].append({'directory': directory, 'sha256': manifest['sourceSha256']})
    for name, window in manifest['windows'].items():
        digest = hashlib.sha256()
        unique, count = [], 0
        with (capture / window['snapshot']).open('rb') as stream:
            for line in stream:
                digest.update(line)
                count += 1
                row = json.loads(line)
                if row['currentTime'] != row['swayTime']:
                    continue
                values = [row[key] for key in fields]
                if unique and unique[-1][1] == row['currentTime']:
                    unique[-1] = values
                else:
                    unique.append(values)
        assert digest.hexdigest() == window['snapshotSha256']
        assert count == window['rows']
        fixture['captures'].append({
            'capture': name, 'snapshotSha256': window['snapshotSha256'],
            'inputSha256': window['inputSha256'], 'rawRows': count, 'rows': unique,
        })
destination = repo / 'docs/evidence/reaudit-bob-cache-fixture.json'
destination.write_text(json.dumps(fixture, separators=(',', ':')) + '\n')
print(json.dumps({'path': str(destination), 'bytes': destination.stat().st_size,
                  'captures': len(fixture['captures'])}))
