"""Export concise scene findings; retain full transition traces locally by hash."""
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
ROOT = REPO.parent / 'native-audit/reports/reaudit-scene-orientation'


def stats(source):
    return {key: source[key] for key in ('rows', 'uniqueFrames', 'uniqueTicks',
            'durationSeconds', 'dirtyCounts', 'unique', 'ranges', 'changes', 'counts')} | {
        'maxima': {key: value['value'] for key, value in source['maxima'].items()}}


for source_name, destination in [
    ('runtime-analysis-bindings-amended.json', 'reaudit-scene-runtime.json'),
    ('runtime-analysis-corrected-movement.json', 'reaudit-scene-moving-runtime.json'),
]:
    raw = (ROOT / source_name).read_bytes()
    report = json.loads(raw)
    report['fullReport'] = 'native-audit/reports/reaudit-scene-orientation/' + source_name
    report['fullReportSha256'] = hashlib.sha256(raw).hexdigest()
    report['exportNote'] = 'Repeated per-sample traces remain in the hash-bound full report; this summary preserves numerical findings.'
    if isinstance(report.get('terminalStatus'), dict):
        report['terminalStatus'].pop('ownedGamePid', None)
    for capture in report['captures']:
        for key in ('allSamples', 'cleanAbsoluteCacheSamples', 'measuredMovingSamples'):
            capture[key] = stats(capture[key])
        for segment in capture['inputSegments']:
            value = segment.pop('stats')
            maximum = value['maxima']['sourceVsSceneWrappedAngleDegrees']
            segment['summary'] = {
                'rows': value['rows'], 'changes': value['changes'],
                'horizontalSpeedRange': value['ranges']['horizontalSpeedUnitsPerSecond'],
                'maxSourceSceneDegrees': maximum['value'] if isinstance(maximum, dict) else maximum,
            }
            if isinstance(maximum, dict):
                segment['summary']['maxSourceSceneSample'] = maximum['sample']
    (REPO / 'docs/evidence' / destination).write_text(json.dumps(report, indent=2) + '\n')
    print(destination)
