# Procedural motion inputs — pass 25

This pass identifies the live velocity cache consumed by native weapon bob and
confirms that the pawn scene orientation changes independently of aim direction.
It extends sway clock evidence. Production motion remains unchanged: reproducing
native arithmetic from captured inputs does not yet reconstruct those inputs
from the trainer's simulation and pointer events.

## Bob velocity and scene basis

The current client selects stored velocity or an evaluated interpolation cache
using its interpolation mode, stage and packed history flags. In all three
new captures every retained HUD update selects cache zero, whose timestamp
exactly equals the requested interpolation time. The native procedure inverse
rotates that velocity through the pawn's scene quaternion.

`tools/reaudit-bob-cache-runtime.py` executes the existing hash-bound native bob
oracle with each previous captured state. It compares supplying raw velocity
against supplying the selected cache. The portable
[fixture](evidence/reaudit-bob-cache-fixture.json) contains only numeric motion
fields; [results](evidence/reaudit-bob-cache-runtime.json) retain the source and
probe hashes. These are native input-hypothesis comparisons, not trainer
before/after measurements.

| Capture | Native state pairs | Raw-input max bob error | Selected-cache max bob error |
| --- | ---: | ---: | ---: |
| bob002 | 1,304 | .00534630 units | 3.73e-9 units |
| bob003 | 1,282 | .00158559 units | 9.31e-10 units |
| bob004, corrected movement | 1,247 | .26880097 units | 3.73e-9 units |

Cycle, smoothed velocity and AIR match exactly with the selected cache. The
remaining bob/animation-bob residual is at most 7.46e-9 units, consistent with
the oracle's host trigonometric shims. Of these 3,833 pairs, 3,692 have consecutive
captured frame counters; those give the same conclusion. Polling is not a call
trace, and equal-state duplicate invocations can remain invisible.

The scene transform accessor refreshes a dirty absolute cache from evaluated
scene angles, or composes a parent transform. It does not read eye angles in
that bounded cache-rebuild path. Separate local/evaluated angle writers exist;
the ordinary pawn writer and its input ownership remain unbound. See the
[static findings](evidence/reaudit-scene-orientation.json).

The first two captures cover a 211.2° stationary aim-yaw sweep. Scene yaw follows
with a different value; clean-cache aim/scene separation reaches 35.59158° and
35.62460°. Scene yaw also continues changing during some constant-aim holds. See the [scene replay](evidence/reaudit-scene-runtime.json).
Clean evaluated and absolute angles agree exactly; their quaternion agreement
is within .00001°. This contradicts a fixed scene-yaw model but establishes no
universal smoothing formula or animation ownership.

## Sway clocks

The history writer's player-time accessor is distinct from the presented-frame
predicted-tick accessor. Its ordinary controller subtracts an integer tick
offset from global current time; an enabled positive ceiling may clamp that
clock. The source-angle interpolation request has another time selector.
The [static clock report](evidence/reaudit-sway-clock-inputs.json) preserves the
bounded current-byte evidence and remaining branches.

The first two captures have zero controller offset, disabled ceiling, the default
converter and domain zero. All 2,573 coherent single-slot history updates
advance by exactly 1/64 s, replace the oldest slot and use the exact four-tick-old
endpoint. Wrapped angle difference times 16 reproduces every recorded rate.
HUD smoothing reproduces 2,586 of 2,587 transitions exactly; the sole residual
crosses a missing frame and cannot be treated as one invocation. Every adjacent
captured-frame comparison is exact.

Both source-angle cache timestamps remain invalid. Sampled cached angles cannot
be substituted merely because the later context selects a cache. Available raw
angles differ from the written history by at most .000167847°. The phase that
produced the input still matters: sampled later clocks need not equal the earlier
writer timestamp. See [runtime findings](evidence/reaudit-sway-clock-runtime.json).
Sampling every second trainer step is not established as the native equivalent.

## Capture boundaries and next evidence

The three windows contain 4,082, 4,085 and 4,014 guarded numeric samples, plus
1,338, 1,325 and 1,313 demo ticks. The sampler reads only its owned CS2 child's memory,
checks exact entity/owner identity and double-reads the motion/cache fields.
An initial ambiguous pair was validated against the visible player position
and a logged strafe before either recording.

The sequence incorrectly assumed W/S meant forward/back; the user's preserved
bindings map T/G to movement and W/S to inspect/use. Therefore the first two
windows establish strafing and stationary turns, not forward/back or moving
turns. Their valid subsets remain retained. Requested FPS caps also do not prove
different presentation cadence: both windows show approximately 64 Hz HUD state
updates. bob002's video has one 267 ms decoded PTS gap; bob003 has no gap over
50 ms, with a maximum of 33 ms. Neither measures physical display latency.

The corrected bob004 sequence uses T/G. Its video decodes 1,241 frames through
20.683 seconds, with no gap over 50 ms and a maximum 33 ms interval. The console
readback confirms fps_max 30; its HUD cadence still does not establish presentation
frequency. All 1,214 reconstructable history writes and 1,248 HUD smoothing updates
match exactly; 40 multi-slot history transitions are excluded from single-write
replay. The raw-velocity bob residual reaches .26880097 units (6.8275 mm); the
selected-cache replay reduces it to 3.73e-9 units.

The [corrected scene replay](evidence/reaudit-scene-moving-runtime.json) contains
48 source-angle changes during measured movement. Two T-held turning sweeps
reach 213.17 u/s and show maximum source/scene gaps of 7.66° and 3.56°. The larger
gap already exists in the clean local angle, so absolute-cache delay alone does
not explain it. The ordinary scene writer and update formula remain unresolved.
The [corrected sway report](evidence/reaudit-sway-clock-moving-runtime.json)
retains its independent history and HUD checks.

The first session quit with exit 0. After the corrected recording, the sampler
asserted on a null scene node during requested game shutdown, 27 seconds after the
window ended. The complete recording is preserved; the terminal state and source
hash were verified separately, and the actual child exit code was not retained.
The portable sampler now handles an unavailable address as a lifecycle read error.
Both owned game and Steam processes are gone.

Required before a full port: reconstruct the selected velocity interpolation
history; bind the ordinary scene-angle writer and its reset/update rules;
establish source-angle/history invocation ordering from input to presentation;
and compare rendered weapon landmarks after composing clips and procedural
motion. R8 follow-up remains excluded.

## Reproduction

With the installed current-hash client and vendored native-analysis dependencies:

```sh
systemd-run --user --scope --quiet -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-bob-cache-runtime.py
```

`tools/reaudit-motion-window.py` freezes completed capture windows;
`tools/reaudit-bob-cache-fixture.py` exports the numeric portable fixture.
`tools/reaudit-scene-runtime.py` and `tools/reaudit-sway-clock-replay.py` verify
the retained local snapshot hashes and replay scene/clock transitions. The
extended sampler and its bounded field readers are retained under `tools/`.
Launching that sampler still requires game-capture authorization and the host
memory/deploy preflight; replaying saved data does not launch the game.

## Validation

The portable native replay reproduces all 3,833 retained bob pairs within
7.46e-9 units. Static probes verify the current binary hash, 4,381 scene code
bytes/six vtable words and 15 sway-field instruction assertions. Python probes
parse and the exported fixture hash matches its report. TypeScript passes;
2,338 unit cases pass with only the previously documented missing
`public/models/ak47.json` fallback fixture failure. Both Chromium view-punch
cases pass in 25.2 seconds. Checks ran serially under memory/swap/CPU caps with
auto-deploy paused and repository files frozen during browser execution.
No production code or assets changed.
