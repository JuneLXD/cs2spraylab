"""Compare measured native scene rotation with recorded native punch states.

Only one constant video/game clock offset is searched. No angle, recoil share,
decay rate, FOV, time scale or per-shot offset is fitted. Run after
reaudit-camera-replay.mjs and native-audit/measure-reaudit-camera.py.
"""
import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'native-audit/python'))
import numpy as np

REPORTS = ROOT / 'native-audit/reports'
observed_path = REPORTS / 'reaudit-recovery002-camera.json'
predicted_path = REPORTS / 'reaudit-camera-native-prediction.json'
observed = json.loads(observed_path.read_text())
predicted = json.loads(predicted_path.read_text())
rows = [r for r in observed['samples'] if r['inliers'] >= 100]
times = np.array([r['t'] for r in rows])
native_times = np.array([r['time'] for r in predicted['samples']])
results = []
best_series = []
for rotation in range(3):
    actual = np.array([[r['rotations'][rotation][k] for k in ('pitch', 'yaw')] for r in rows])
    for model, keys in [('recorded-aim-and-camera', ('pitch', 'yaw')),
                        ('recorded-aim-only', ('aimPitch', 'aimYaw'))]:
        values = np.array([[r[k] for k in keys] for r in predicted['samples']])
        def estimate(offset):
            angles = np.stack([np.interp(times + offset, native_times, values[:, axis]) for axis in range(2)], axis=1)
            angles -= np.array([np.interp(observed['referenceAt'] + offset, native_times, values[:, axis]) for axis in range(2)])
            return angles
        def error(offset):
            return float(np.sqrt(np.mean((actual - estimate(offset)) ** 2)))
        offsets = np.arange(232., 234., .001)
        offset = min(offsets, key=error)
        fine = np.arange(offset - .001, offset + .00101, .00005)
        offset = float(min(fine, key=error))
        delta = actual - estimate(offset)
        norms = np.linalg.norm(delta, axis=1)
        result = dict(model=model, fx=rows[0]['rotations'][rotation]['fx'], fy=rows[0]['rotations'][rotation]['fy'],
                      offsetGameMinusVideo=offset, frames=len(rows), rms=error(offset),
                      pitchRms=float(np.sqrt(np.mean(delta[:, 0] ** 2))),
                      yawRms=float(np.sqrt(np.mean(delta[:, 1] ** 2))),
                      maxAngularError=float(norms.max()), p95AngularError=float(np.quantile(norms, .95)))
        results.append(result)
        if rotation == 0:
            best_series.append(dict(model=model, samples=[dict(videoTime=float(t), gameTime=float(t + offset),
                observedPitch=float(a[0]), observedYaw=float(a[1]), predictedPitch=float(p[0]), predictedYaw=float(p[1]))
                for t, a, p in zip(times, actual, estimate(offset))]))
report = dict(
    video=observed['video'], referenceVideoTime=observed['referenceAt'],
    measuredTimeRange=[float(times.min()), float(times.max())],
    observedSha256=hashlib.sha256(observed_path.read_bytes()).hexdigest(),
    predictionSha256=hashlib.sha256(predicted_path.read_bytes()).hexdigest(),
    fit='One constant game-minus-video clock offset, 1ms coarse / 0.05ms fine search; no amplitude fitting.',
    authoritativeIntrinsics=dict(fx=360, fy=360, width=960, height=540),
    minimumInliers=min(r['inliers'] for r in rows),
    maxHomographyResidualPixels=max(r['residual'] for r in rows),
    manualHudClockChecks={
        'method': 'GameTime read manually to 0.0001s from retained full frames; rounded observations, not a fitted correction.',
        'samples': [dict(videoTime=t, displayedGameTime=g, offset=g-t,
                         image=f'reaudit-camera-clock-{t:.3f}.png')
                    for t, g in [(3., 236.3714), (3.317, 236.6387), (5.35, 238.7100), (6.083, 239.4496)]],
        'offsetRangeMs': 49.7,
        'interpretation': 'Continuous container timestamps do not imply equally spaced native game frames. One constant offset leaves frame-timing error.'},
    results=results, series=best_series,
    limitations=[
        'The fitted clock offset does not measure input-to-photon latency or sample-exact AV synchronization.',
        'The video contains quantized display frames, while the demo contains replicated states; client prediction and render interpolation are not reconstructed.',
        'The two alternative intrinsics are diagnostics, not candidate FOV values to tune.',
        'This is a native scene-rotation comparison. It does not measure the trainer screen, weapon motion or rendering parity.',
        'RMS values include unresolved frame-clock mismatch and are not a tolerance for declaring visual parity.',
    ])
(REPORTS / 'reaudit-camera-video-fit.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: v for k, v in report.items() if k != 'series'}, indent=2))
