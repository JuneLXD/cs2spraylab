# Native presentation follow-up, October 8

This pass follows the approved order in `fidelity-roadmap.md`. It is a browser
implementation of selected native inputs, not a complete Source 2 renderer.

## Weapon effects

Decoded installed build 2000927 particle definitions are retained outside the
repository in `../native-audit/fx-resources`. `native-fx-data.json` records their
decoded hashes and the subset used at runtime. `tools/build-native-fx.mjs`
rebuilds the profiles and texture metadata from those inputs.

- AK-style trails use the authored 20,500 Source units/s cosmetic speed;
  pistols and sniper rifles retain their own speeds and trail limits. Their
  physical shots and damage remain instantaneous.
- AUG, SMG and machine-gun resources use rope renderers rather than the moving
  trail initializer. Their distance-controlled lifetimes are extracted separately.
- Rifle vent flames use the authored 28–30 ms life, 3–6-unit radius envelope,
  25 ms fade and limited rotation. A separate brief glow and 200 ms smoke puff
  replace the previous uniform 45 ms flash.
- Native muzzleflashx, muzzleflash4, particle_glow_04 and a smoke1 sheet frame
  supply the textures. Additive-to-alpha conversion works in linear RGB, then
  encodes straight RGB back to sRGB, avoiding the excessive brightness caused
  by multiplying normalized sRGB values by a linear alpha.
- Fixed pools retain a minimum first rendered presentation at low frame rates.
  Cosmetic variation does not consume shot RNG. Gameplay endpoints remain copied
  separately from the moving visible segment.
- Fresh/missing tracer settings use the CS2 option. Explicit `every` and `off`
  preferences are preserved; practice beams retain their old behavior.

Source 2 Viewer's [MoveBetweenPoints implementation](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/ValveResourceFormat/Particles/Initializers/MoveBetweenPoints.cs)
and [trail renderer](https://github.com/ValveResourceFormat/ValveResourceFormat/blob/master/Renderer/Particles/Renderers/RenderTrails.cs)
were used to interpret exported fields. These are an independent renderer's
implementations, not proof of exact Valve-engine behavior.

Limitations: native shaders, bloom/lighting, all particle children, exact random
seeds, some control-point/distance modifiers and native attachment metadata are
not reproduced. Barrel positions still use animated mesh anchors. Non-rifle
flame envelopes and the common suppressed-flame treatment remain approximations.
Smoke is a reduced single-puff representation. The 60 Hz retained native video
is a visual reference, not enough to fit every sub-frame particle duration.

## Weapon and opponent motion

The first-person projection now applies the selected resolution's pixel stretch
to the weapon, matching the existing world/crosshair stretch. The viewport's
portrait/ultrawide crop policy remains. Muzzle-to-world projection uses the
actual updated camera, preserving the visible barrel's alignment.

When native firing clips are available, the renderer omits the additional
procedural shot translation/rotation. Physical recoil and verified camera punch
are unchanged. AWP/SSG fire clips run on their authored timeline instead of being
compressed to the gameplay fire interval. The AWP audio's bolt markers remain
0.6/0.866667 seconds on its 1.6-second clip clock. New shots can interrupt a clip;
the animation never controls permission to fire.

Opponent direction reversals blend only directional locomotion weights over
100 ms. Stance still uses the currently displayed duck amount, and native
capsules still follow the final displayed skeleton. The decoded native
`worldmodel_locomotion.vnmgraph` includes 100 ms plant/turn entries, but this
reduced blend does not implement that graph's planted-foot states, IK, or root
motion. It is a presentation improvement, not a verified full native transition.
Generic bob and the 0.22 weapon recoil fraction remain estimates.

## Movement and actions

`counterstrafe-evidence.test.ts` retains the native demo's AK release/reversal
thresholds with the one-64-Hz-sample uncertainty of position-derived velocity.
No acceleration/friction tuning was justified. Existing event-time input tests
continue to cover short strafes and shots around movement changes.

Long reload updates now timestamp shell insertion/completion at each crossed
phase deadline. Additional live M4A4 measurements validate normal partial and empty reload
insertion at frame 41/30 seconds. Its attack lock remains 3.066667 seconds.
`native-reload-followup-evidence.json` records the demo hash and observed
deadlines. The held mismatch was subsequently corrected using the installed gate,
fresh normal/empty markers and new live tap/hold/release recordings. See
`native-reload-clock.md` for evidence, errors and the remaining shell estimates.
The M4A1-S attempt was rejected after the demo identified an M4A4; its retry
froze before verified recording, so no M4A1-S timing was changed.

## Map and impacts

`tools/import-map.mjs ../maps/redline.vpk --game ../cs2-game --keep` rebuilt
aim_redline using the installed stock dependencies. The GLB changed from
5,702,096 bytes / 5 textured materials to 21,402,428 bytes / 154 textured
materials, with 257 textures and 149 meshes. Collision/spawns are byte-identical:
SHA-256 `620cca9d53d2b3f868817c73db58ea7615e051df97899fa2a6a64f78accc25db`.
The prior model is backed up outside the repo. The shipping-container layered
tint shader exports an excessively dark multiplicative factor without its
color-replacement layers; its fallback keeps the original base texture untinted.
This improves visibility but is not an exact material-shader reproduction. These assets remain local and
git-ignored, following the existing deployment asset workflow.

Surface contacts carry their existing ballistic normal into presentation.
Four pools use decoded native concrete, metal, wood and glass decal textures.
Size, 20-second retention, and the browser material are presentation choices;
native decal normal/height projection is not reproduced. Coarse imported-map
collision can still differ slightly from visible mesh surfaces. Flesh/training
markers retain their prior behavior. Existing material-specific impact audio
is preserved.

## Frame diagnostics

The performance meter reports gameplay frame-interval p95, with p99, maximum
interval and main-thread work in its tooltip. Clicking saves up to 2,048 samples
as JSON, including after pausing. Real frame intervals are recorded separately
from capped physics time, so long stalls are not hidden by that cap.

These are browser render intervals, not GPU duration, display scanout or physical
input latency. A 4090/Windows comparison requires running the preview on that
PC; software WebGL on this host is a functional test only.

## Validation

- Final unit run: 2,109 passed, one known baseline failure because the original
  archive lacks `public/models/ak47.json`. TypeScript and the production build pass.
- Twelve Chromium checks pass: barrel/tracer projection, immediate hits,
  suppression, practice beams, surface decals, spatial audio, frame-report export,
  input timing, animated hitboxes, scope transitions and camera kick.
- Fresh production-preview visits through `http://192.168.0.18:5190` load and fire
  without page errors or failed asset requests. The final screenshot confirms
  textured crates, warehouse surfaces and readable shipping containers.
- Eight effect/impact assets match their recorded hashes. The final map SHA-256
  is `eb4abc1204e0c1330f99bf7e94afa0f0edb2732665acbdbe7ad90697b0f27f13`.
- The valid M4A4 recording and timing evidence are available on the LAN comparison
  page at `http://192.168.0.18:5191`. No public deployment was performed.

The map download increased from 5.7 to 21.4 MB and carries more draw calls.
The user subsequently reported stable 500 FPS and 2.1 ms frame time on the 4090 in Chrome, including firing. This is user-reported browser timing, not physical latency.
