"""Create the small, numeric pistol selector fixture from retained proof/replay.

The replay's matched table indices are inverse reconstructions, not recorded
native command seeds. They are suitable for a conditional recovery test only.
"""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--proof', type=Path, required=True)
p.add_argument('--replay', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists(), a.output
proof = json.loads(a.proof.read_text())
replay = json.loads(a.replay.read_text())
keys = ['weapon', 'tick', 'elapsed', 'inferredPreShotIndex', 'actualAngle',
        'actualVelocity', 'priorAngle', 'priorVelocity', 'reconstructedTableIndex',
        'matchingTableIndices', 'tableMatchError']
records = []
for r in replay['recordings']:
    # Keep all rifle controls as well as the pistol observations.
    records.append({'demo': r['demo'], 'sha256': r['sha256'], 'header': r['header'],
                    'samples': [{k: s[k] for k in keys} for s in r['samples']]})
result = {'method': __doc__, 'serverSha256': proof['artifactHashes']['server'],
          'proofSha256': hashlib.sha256(a.proof.read_bytes()).hexdigest(),
          'replaySha256': hashlib.sha256(a.replay.read_bytes()).hexdigest(),
          'generatorSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'selectionCases': proof['cases'], 'recordings': records}
a.output.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'selectionCases': len(result['selectionCases']),
                  'anchorCases': sum(len(r['samples']) for r in records)}))
