"""Read only clip clocks from VRF DMX exports, using the existing Source Tools parser."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / '.local-tools'))
import datamodel

root = Path(sys.argv[1])
rows = {}
for path in sorted(root.rglob('*.dmx')):
    model = datamodel.load(path)
    clip = next(e for e in model.elements if e.type == 'DmeChannelsClip')
    rate = float(clip['frameRate'])
    # VRF's decimal DMX clock introduces a small quantization error around 30 Hz.
    fps = round(rate) if abs(rate - round(rate)) < .002 else rate
    seconds = float(clip['timeFrame']['duration'])
    rows[path.relative_to(root).as_posix()] = {'fps': fps, 'duration': round(seconds * fps) / fps}
print(json.dumps(rows))
