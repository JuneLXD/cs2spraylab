# Native procedural weapon recoil, pass 23

Baseline `9391437`. The current client adds **0.325 of combined physical aim
punch** to the weapon model's incoming world angles. The normal local-player
path supplies the already composed camera angles, which include camera-only
kick and 0.45 of physical punch. SprayLab's separate weapon scene previously
used an unmeasured 0.22 local Euler rotation and omitted damage punch.

The correction uses the native share and converts the resulting world rotation
into the stationary weapon camera's coordinate system. Range and Duel use the
same helper; Duel supplies both weapon and damage punch. The existing camera
composition, bullet direction and accuracy rules are preserved. This pass does
not fix the separate [camera timestamp problem](reaudit-camera-clocks.md).

## Primary evidence and coordinate frame

[The native probe](../tools/reaudit-viewmodel-native.py) is pinned to client
SHA-256 `eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1`.
It verifies 24 instructions and five pointer/vtable bindings. The retained
bounded ranges establish this ordinary first-person chain:

1. `CViewRender` invokes the client-mode view setup into its main view. The
   player's camera-service dispatcher writes that view's origin and angles.
   Its composition adds camera-only kick and 0.45 of combined physical punch.
2. The renderer publishes those main-view angles. The ordinary local HUD-model
   update reads that same published value and forwards it to
   `C_CS2HudModelArms::UpdateAndSetupView`.
3. Its procedural transform calls the same combined aim-punch sampler used by
   the camera, multiplies all three components by float32 0.325, and adds them
   to the incoming world angles. Both arm and weapon entities receive the
   resulting angles; the native angle-to-quaternion routine creates the stored
   render rotation.

The supplied transform may contain other procedural terms. This proof isolates
recoil; it does not claim the entire model transform consists only of recoil.
Preview, spectator, scoped/handedness transitions and other special paths are
not covered by the ordinary local-player chain.
The brief Duel death-camera transform and the existing missing-clip fallback
kick remain approximations outside this oracle; the fallback retains its Euler
pitch addition after the corrected recoil rotation.

For a stationary camera in a separate weapon scene, the isolated recoil
rotation is `inverse(cameraRotation) * modelWorldRotation`. Subtracting Euler
angles does not reproduce that rotation at steep aim or with roll. Camera-only
kick belongs to both world bases, so it must not become another independent
weapon kick. Source-to-Three quaternion conversion maps `(x,y,z,w)` to
`(-y,z,-x,w)`; the native executed quaternion fixtures verify the axis mapping.

## Before and after

The native probe executes the actual camera/model angle-add instructions and
native `AngleQuaternion` routine in private Unicorn memory. Only `sincosf` is
a host math shim. Six base views, six physical-punch vectors and three camera
kicks produce 108 cases / 432 native executions. Cases include steep up/down
views, different world yaws, roll and zero physical punch. The committed
[portable fixture](evidence/reaudit-viewmodel-native.json) retains exact inputs,
outputs, binary/range digests and explicit exclusions.

[The production replay](../tools/reaudit-viewmodel-replay.mjs) imports the actual
shared helper. Before uses the former engine's XYZ model assignment; after
uses the actual quaternion application. It compares camera-relative rotations
against independently executed native quaternions, with no coefficient fit.

| 108 supplied-state cases | Before | After |
|---|---:|---:|
| Maximum rotation error | 3.29583651° | 0.000014502° |
| RMS rotation error | 1.66290924° | 0.000005254° |

The remaining difference is consistent with native float32 angle/trigonometry
versus Three's double precision. These are isolated orientation errors, not
pixels, full gun landmarks or whole-engine timing measurements. Unit fixtures
cover all 108 cases, and the existing two-engine browser spec additionally
checks actual weapon-root quaternions at steep aim and with Duel damage punch.

Final validation passes TypeScript and both targeted Chromium cases. The full
unit suite has 2,327 passes and only the documented missing
`public/models/ak47.json` fallback-fixture failure. Tests ran serially under
memory/swap/CPU caps with auto-deploy paused and repository edits frozen during
the browser run. Logs are retained as
`native-audit/reports/reaudit-viewmodel-{typescript,unit,browser}.log`.

## Corrected bob claim and remaining work

The native procedural path also contains velocity/air-state motion and smoothed
angle sway outside the animation graph. A graph search with no movement nodes
cannot establish absent bob or sway. SprayLab already adds a 2 mm sine bob in
both engines; the inventory's claim of no deliberate bob was incorrect.
Neither its amplitude nor its clock is corrected here. Full native movement
bob, look sway, crouch/zoom/landing transforms, hand/state blends, model-origin
placement, FOV/projection, animation layers and rendered landmark trajectories
remain open. The native procedural path gives a concrete next trace for them.

The [client history report](reaudit-client-history.md) separately resolves how
an attack press selects the last published frame and its player clock. Runtime
prediction/presentation phase and per-shot resolver state are still required
before replacing the trainer's camera anchor.

## Reproduction

```sh
python3 tools/reaudit-viewmodel-native.py --portable-out docs/evidence/reaudit-viewmodel-native.json
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=200% node tools/reaudit-viewmodel-replay.mjs after
```

Pause automatic deployment and verify its service is inactive before the Node
run. Execute heavy checks serially. Raw instruction ranges and before/after
reports remain under `native-audit/reports/reaudit-viewmodel-*`. The original
before report was captured before editing baseline production code; running
`before` on changed code measures that changed code, not a historical checkout.
