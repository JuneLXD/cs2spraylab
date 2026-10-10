"""Export portable camera results without native addresses or player identity."""
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REPORTS = REPO.parent / 'native-audit/reports'
def read(name):
    return json.loads((REPORTS / name).read_text())
native = read('reaudit-camera-native.json')
anchors = read('reaudit-camera-anchor-clocks.json')
replay = read('reaudit-camera-production-before.json')
resolver = read('reaudit-attack-history-resolution.json')
video = read('reaudit-camera-video-fit.json')
result = {
    'baseline': replay['baseline'], 'productionChange': False,
    'binarySha256': {r['side']: r['sha256'] for r in native['results']},
    'nativeArithmetic': {**replay['oracle'], 'explicitClientAnchors': sum(len(r['setters']) for r in native['results']),
                         'decay': native['decay'], 'decaySource': native['decaySource']},
    'demoAnchors': {key: anchors[key] for key in ['totalShots', 'nonInitialShotPairs', 'summary', 'old14ShotFixture', 'limitations']},
    'recordings': [{k: v for k, v in r.items() if k != 'shots'} for r in replay['recordings']],
    'anchorRanges': [dict(demo=r['demo'], shots=r['shotCount'],
                         cameraMinusScheduleMs=[min(s['cameraMinusSchedule'] for s in r['shots']) * 1000,
                                                max(s['cameraMinusSchedule'] for s in r['shots']) * 1000],
                         clockComparisons=r['summary']) for r in anchors['recordings']],
    'resolver': {k: resolver[k] for k in ['resolved', 'conditionalInference', 'missingNativeState', 'trainerBoundary', 'limits']},
    'video': {k: v for k, v in video.items() if k != 'series'},
    'replayLimitations': replay['limitations'],
    'sourceReportSha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                          for p in [REPORTS / n for n in ['reaudit-camera-native.json', 'reaudit-camera-anchor-clocks.json',
                              'reaudit-camera-production-before.json', 'reaudit-attack-history-resolution.json', 'reaudit-camera-video-fit.json']]},
}
output = REPO / 'docs/evidence/reaudit-camera-clocks.json'
output.write_text(json.dumps(result, indent=2) + '\n')
print(output)
