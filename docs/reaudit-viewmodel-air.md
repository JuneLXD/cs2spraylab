# Native airborne weapon motion — pass 24

Both engines now reproduce the native airborne weapon dip and pitch transition.
This isolates one verified part of procedural motion. Horizontal movement bob,
look sway and complete rendered model parity remain open.

## Rule and primary evidence

The current client HUD procedure reads the pawn's grounded flag. Each eligible
invocation moves its AIR state by at most float32 0.1 toward zero on ground or
two in air. There is no frame-duration multiplier: twenty calls reach the other
endpoint, including supplied zero-duration calls. Construction initializes it
to zero. The procedure subtracts `0.4 * AIR` from world vertical position and
`0.2 * AIR` degrees from Source pitch. At full air this is a 20.32 mm drop and
0.4° pitch change. Its pitch clamp is ±89.999° before the subsequent physical
recoil addition. Incoming camera angles remain the basis for configured offsets.

`tools/reaudit-viewmodel-bob-native.py` binds the installed client by SHA-256 and
executes its bounded ordinary movement procedure in private Unicorn memory.
`tools/reaudit-viewmodel-air-native.py` supplies zero velocity to isolate AIR,
then executes the native recoil addition and quaternion conversion. Nine
sequences retain 406 native frames: takeoff, landing, short jump, 30/60/120 Hz,
zero delta, steep aim, roll, recoil and the pitch boundary. Math-library calls
use host sin/cos rounded to float32; this is not the full native renderer.
The [portable fixture](evidence/reaudit-viewmodel-air-native.json) records its
binary/script hashes and all output transforms.

The approved `native_reaudit_bob_001` offline session supplies independent live
state evidence. A parent process reads only its own CS2 child's numeric motion
state; it never writes memory or samples another process. Unchanged frame/HUD
state guards reject torn model reads. The selected action window retains 945
HUD states and 944 state pairs: every AIR update matches exactly. The
[captured pairs](evidence/reaudit-viewmodel-air-runtime.json) include source
hashes and polling limits. Equal-state duplicate calls can remain invisible;
this is not an atomic engine callback or proof of all lifecycle paths.

The accompanying video decodes 1,065 frames through 17.733 s, with maximum
17 ms PTS interval and no gaps over 50 ms. This establishes recorded frame
availability, not unique rendered game frames or mouse-to-photon latency.
CS2 and the owned Steam session were closed after capture; no audio was needed.

## Measured trainer change

`tools/reaudit-viewmodel-air-replay.mjs` runs the exact model-transform statements
from both engines with supplied frame states. The before path loads their code
and recoil helper from pinned baseline `252a1e7`; the after path loads current
production. All 812 engine/frame comparisons use the same native reference.

| Measurement | Before | After | Status |
| --- | ---: | ---: | --- |
| Maximum isolated model-position error | 20.3200003 mm | 0.000000889 mm | Matched within numerical precision |
| Maximum isolated orientation error | 0.4000053° | 0.00001648° | Matched within float/trig precision |
| Captured AIR transition pairs | Missing behavior | 944/944 exact | Matched sampled state transitions |

The shared state lives with the engine. It is preserved through equipment,
reload and scope changes. Duel clears it for a new simulation or player
generation; this is a trainer lifecycle choice, not proof of native reuse/reset
behavior. Range resets of the existing simulation do not reconstruct this state.
The existing render loop advances it only after a displayed-frame pacing gate;
hidden/skipped draws do not advance it. Paused visible previews still update at
their preview cadence. Native pause/respawn/teleport behavior remains unverified.

The native flag read maps to committed trainer `grounded`, independently of
vertical speed. Exact native prediction phase versus the trainer's 128 Hz
simulation remains a boundary. Model translation is world vertical converted
through the inverse original camera. Model pitch is adjusted/clamped before
the existing .325 physical-punch term; the camera inverse is never air-adjusted.
Camera, crosshair, movement and bullet state receive no AIR feedback. Duel's
death-camera path retains its existing behavior.

The old 2 mm sine movement bob and missing-clip recoil fallback remain separate
approximations. Matching this isolated term does not certify total gun landmarks,
animation graph output, left-hand placement, FOV or projection.

## Other motion findings and exact next evidence

- Stored simulation velocity is not necessarily the bob input. Native velocity
  history can return cached, endpoint, linear or cubic evaluated values. In 121
  grounded changing-speed samples, inferred speed lies between successive
  stored samples; it differs from current stored speed by up to 10.02936 u/s.
  Capture the evaluated cache and its selection/time metadata. No fixed delay
  or interpolation fraction was fitted.
- The captured pawn body yaw stays near 90° while look yaw changes by 3.52°.
  Trainer look yaw cannot substitute for this basis without a verified body
  rotation rule. Retain body-transform writes while turning/moving next.
- [Live sway evidence](evidence/reaudit-look-sway-runtime.json) matches 1,092
  reconstructable history writes and 1,106 HUD smoothing updates exactly in its
  larger observation window. History used an exact endpoint four 64 Hz ticks
  earlier. HUD smoothing uses elapsed global time, not the sampled frame delta.
  Its native interpolation bracket branch was executed separately but not seen
  in this recording. Writer cadence, interpolation input and phase must map to
  trainer input before shipping sway.
- Global time moves backward across 929 observed frame boundaries. These
  prediction/render phases still lack per-shot attack-history/publication
  metadata; the capture does not resolve the earlier camera-anchor mismatch.

Raw instructions, native layouts, caches and full recordings stay in local
`native-audit/reports/reaudit-*` artifacts. Existing REA transports were retained;
no live analysis request was cancelled or restarted. Further R8 work is excluded.

## Reproduction and validation

Pause the deploy timer, confirm its service is inactive and run heavy checks
serially under the host memory cap. These fixture commands never launch CS2:

```sh
systemd-run --user --scope --quiet -p MemoryMax=1G -p MemorySwapMax=0 -p CPUQuota=200% python3 tools/reaudit-viewmodel-air-native.py
python3 tools/reaudit-viewmodel-air-runtime.py
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=200% node tools/reaudit-viewmodel-air-replay.mjs before 252a1e7
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=200% node tools/reaudit-viewmodel-air-replay.mjs after
```

Runtime extraction requires the retained recording. The original capture
sampler is preserved as `tools/reaudit-motion-runtime.py`; launching it requires
the approved game-session workflow and prepared native cfg files. Never
overwrite an earlier capture. Static/velocity/sway probes remain under
`native-audit/reaudit-{bob,look-sway,sway-history,sway-runtime}*`.

TypeScript passes. The full unit suite has 2,338 passes and only the documented
missing `public/models/ak47.json` fallback fixture failure. Both Chromium cases
pass, including all 48 airborne/grounded rendered updates in each engine,
world placement at steep aim, recoil/damage roll, unchanged camera and skipped
draws. Browser execution took 24.9 s; repository files stayed frozen throughout.
All heavy work ran serially with memory/swap/CPU caps and automatic deploy paused.
Logs: `native-audit/reports/reaudit-viewmodel-air-{typescript,unit,browser}.log`.
