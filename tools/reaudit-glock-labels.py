"""Verify the Glock timestamp-label erratum without changing historical evidence."""
import argparse, hashlib, json
from pathlib import Path
p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--original', type=Path, required=True)
p.add_argument('--corrected', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
assert not a.output.exists(), 'Refusing to overwrite evidence'
old, new = [json.loads(v.read_text()) for v in [a.original, a.corrected]]
assert old['fixtures'] == new['fixtures']
scheduled = delayed = 0
for b, n in zip(old['cases'], new['cases'], strict=True):
    assert (b['engine'], b['scenario']) == (n['engine'], n['scenario'])
    assert b['events'] == n['events']
    assert [s['at'] for s in b['shots']] == [s['at'] for s in n['shots']]
    if n['engine'] == 'range':
        for prior, shot in zip(b['shots'], n['shots'], strict=True):
            assert prior['scheduledAt'] == prior['at'] == shot['callbackAt'] == shot['at']
            assert shot['scheduledAt'] <= shot['at']
            scheduled += 1
            delayed += shot['scheduledAt'] < shot['at'] - 1e-9
report = {'method': __doc__, 'cases': len(new['cases']), 'unchangedShotAndEventTraces': len(new['cases']),
          'rangeShotsWithCorrectedLabels': scheduled, 'rangeShotsWithDifferentScheduledTime': delayed,
          'originalProbeSha256': old['scriptSha256'], 'correctedProbeSha256': new['scriptSha256'],
          'files': {str(v): hashlib.sha256(v.read_bytes()).hexdigest() for v in [a.original, a.corrected]},
          'scriptSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
          'boundary': 'Trainer event/schedule labels only; no native scheduler or history claim.'}
a.output.write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps({k: report[k] for k in ['cases','unchangedShotAndEventTraces','rangeShotsWithCorrectedLabels','rangeShotsWithDifferentScheduledTime']}))
