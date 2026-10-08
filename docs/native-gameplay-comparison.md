# Native CS2 gameplay comparison

Recorded on October 8, 2026 against client 2000927, Steam build 25738536
(patch 1.41.8.9). Native CS2 ran on the local Linux/Radeon 760M host in an
offline Dust II session, with no bots and normal finite ammunition. Steam
was signed in; the client used its official Linux runtime.

## Method and retained evidence

The capture harness focused only the CS2 window and sent logged X11 key/button
events. FFmpeg recorded that window at 60 Hz. SourceTV demos provided 64 Hz
player/weapon samples, decoded with demoparser2 0.42.0. The checked-in
`native-gameplay-evidence.json` retains source demo hashes, actual game times,
ammo transitions and cancellation observations without player identifiers.
Full recordings, input logs and parsed samples remain in `../native-audit/`.

The test sequences cover standing taps, an AK spray, normal strafes, opposite
direction braking, walking, crouching, jumping, AWP zoom/automatic rescope,
reloads and weapon switches. A mislabeled `native_audit_awp_001.dem` trial
actually held a USP-S: the reported active weapon identifies its reload as
USP-S evidence. A separate `native_audit_awp_002.dem` confirms the AWP.

An initial synthetic relative-mouse experiment did not reproduce reliable
device counts. It is excluded from sensitivity/flick calibration. No result
here measures physical input latency or the user's Windows/4090 system.

## Reload corrections

All times below are seconds after reload begins. "Native sample" is the
first sampled ammo change, not an exact sub-tick event timestamp. Continuous
insertion deadlines use the authored `WPN_RELOAD_ADD_AMMO` event times,
confirmed by the live samples within one 64 Hz tick.

| Weapon | Old insertion | Native sample | Corrected insertion | Full attack lock |
| --- | ---: | ---: | ---: | ---: |
| AK-47 | 2.466667 | 1.109375 | 1.10 | 2.466667 |
| AWP | 3.666667 | 2.015625 | 2.00 | 3.666667 |
| USP-S | 2.20 | 0.906250 | 0.90 | 2.20 |
| Desert Eagle | 2.20 | 0.765625 | 23/30 | 2.20 |

SprayLab now commits ammunition at insertion, while retaining the full attack
lock. Both range and Duel split simulation time at that insertion boundary.
The Deagle cancellation sequence verifies the distinction:

- Holster 0.453125 seconds into a reload: return with the original 4 bullets.
- Holster 0.953125 seconds into a reload: return with a fresh 7-bullet magazine.
- Returning still requires the weapon's deploy time.

The native Deagle HUD starts with three spare magazines and ends with one after
one cancellation before insertion and two partial reloads that insert a
magazine. The implementation now honors `reserveAsClips`: a magazine reload
discards leftover rounds and consumes a whole spare. Internally the trainer
continues to store reserve ammunition in rounds. Shell-fed shotguns keep their
individual-shell behavior. The parser's `total_ammo_left` field returned zero
in this build and was **not** used as reserve evidence.

Unmeasured magazine weapons retain insertion at completion as a fallback.
Empty-reload animation branches and the existing estimated silent-reload speed
still need native measurements; normal partial-reload evidence is not proof
of those cases. Silent mode continues to integrate elapsed work at its preceding
rate, so changing mode cannot move insertion retroactively.

## Movement and firing checks

- Native AK ground speed reaches 215 Source units/second; walking reaches
  approximately 111.79, matching the existing 0.52 walk multiplier.
- Two ordinary strafe releases reach the 34% speed threshold after 0.21875
  seconds in the demo, and stop after 0.390625 seconds. SprayLab's 128 Hz
  probe reaches these after 0.203125 and 0.3828125 seconds. The parser derives
  velocity from positions, with roughly one sample of lag; these differences
  do not justify changing the existing friction constants.
- A native opposite-direction input reaches the same speed threshold in
  0.09375 seconds; the trainer's held-opposite-direction probe reaches it in
  0.078125 seconds. Again the difference is one demo tick. Input release in the
  native sequence prevents interpreting its final stop as an identical held
  input test. This is a consistency check, not complete movement parity.
- Native AK `last_shot_time` advances by 0.10 seconds through the recorded
  spray, within floating-point precision, matching the imported firing cycle.
- AWP automatic rescope occurs 1.453125 seconds after each sampled shot,
  consistent with the 1.455-second imported cycle. Its manual scope change
  sets FOV 40 then 10 and `m_flFOVRate = 0.05`; automatic rescope sets
  `m_flFOVRate = 0.1`. The scope comparison below now verifies the transition curve and
  sensitivity arithmetic independently of physical mouse-count delivery.
- Native console confirms sensitivity 1, zoom sensitivity ratio 1 and
  yaw/pitch scales 0.022. Physical mouse-count delivery remains a separate
  check on the user's Chrome setup.

## Scope comparison (second pass)

`native-scope-evidence.json` retains all FOV changes from an offline sequence
covering AWP, SSG 08, G3SG1, SCAR-20, AUG and SG 553. The native weapon-fire
events identify the weapon; this parser version leaves the active weapon name
empty for five of those guns. Primary and secondary deadline fields are kept
as raw values, without assuming that their serialized tick representation is
an ordinary timestamp.

The installed Linux `libclient.so` has SHA-256
`99ae5b5724e869de64cc810d7ade089fb18d2fe08dcb8d88982af39f951d1d12`.
`tools/verify-native-fov.py` emulates only bounded scalar arithmetic from that
hash-pinned image, without loading the client, importing native functions or
calling an operating system. It requires pyelftools 0.32 and Unicorn 2.1.4.
The generated `src/range/native-fov-fixture.json` is checked by unit tests.

The ordinary camera transition is `start + (target - start) * t² * (3 - 2t)`.
Forty-five arithmetic samples cover its boundaries and intermediate points.
An independent native AWP video recorded at `host_timescale 0.05` agrees:
37 changing frames fit that curve with 0.325-degree RMS error and a 1.0006-second
real-time duration (the expected duration is 1 second). The linear fit has
0.772-degree RMS error. Scene-feature scaling measures the image; the arithmetic
fixture establishes the exact curve. Repeated frames at the start were excluded
from the fit. Capture launch time is not assumed to equal video timestamp zero.

AUG and SG 553 use 100 ms scope-in and 125 ms scope-out, confirmed by the live
FOV-rate fields and their authored iron-sight speeds of 10 and 8. Their rendered
FOV takes a separate path: a linear sight amount goes through `Bias(amount, .2)`,
equivalent to `amount / (4 - 3 * amount)`. Scope-out reverses that amount rather
than applying the scope-in curve to a reversed pair of FOVs. Seven emulated
samples verify the bias helper at `0x23bc270`; its caller at `0x14dd633` feeds
the rendered FOV calculation at `0x14de8b0`. A corrected slow-motion AUG
capture independently fits this curve at 0.134-degree RMS error on scope-in
(33 changing frames, fitted duration 2.0056 seconds versus expected 2) and
0.135 degrees on scope-out (38 changing frames, 2.5089 seconds versus 2.5).
An earlier capture held a USP-S after same-frame inventory commands; it is
explicitly excluded from the AUG comparison.

The four sniper rifles use 50 ms manual transitions. Manually cycling back out
first advances the integer starting FOV 70% toward 90 degrees: AWP starts its
10-to-90 transition at 66, the other three start their 15-to-90 transition at 67.
The live camera fields and the zoom setter at `0x148dbf0` agree. Shot-triggered
unzoom does not use that jump. AWP and SSG 08 automatically resume their prior
zoom with a 100 ms transition once the firing cycle completes. This comparison
uses the native default `cl_sniper_delay_unscope = false`.

Zoom-button readiness is separate from firing readiness. The secondary action
at `0x149f68a` sets zoom and then schedules a 300 ms secondary cooldown; it does
not add a primary-fire lock. Native shots fired while the camera was still
zooming. The firing helper at `0x148f970` advances both attack clocks by the
firing cycle, preserving a secondary deadline still ahead after a recent zoom.
SprayLab now reproduces that distinction, including repeated zoom after a shot.

The native sensitivity routine at `0x1860300` samples current camera FOV,
truncates it to whole degrees, clamps it to at least 10 degrees, divides by the
default FOV, and applies the zoom sensitivity ratio. At the default FOV it uses
normal sensitivity and bypasses that ratio. Thirty emulated samples verify
those branches. Both browser modes now apply this changing scale at the input
event's simulation time. This validates the angular calculation, not physical
DPI, operating-system input processing or mouse-to-photon latency.

## Recoil recovery (third pass)

`tools/verify-native-recovery.py` emulates the complete recovery sampler at
`0x15147a0` from the same hash-pinned client. It supplies a preallocated cache,
base angles, impulse velocities and times. Only math imports are substituted
with host math rounded to float32; installed `libtier0.so` forwards these
functions to libm. No engine, allocator or operating-system call runs.
The 72 checked-in samples cover fractional times, the 128-step cache, its
exponential tail, the angle clamp and the 1/32-degree cutoff. Typical samples
agree within 0.00001 physical degrees; deliberately extreme angles near
89 degrees use a 0.00012-degree tolerance for floating-point differences.

Recovery now samples a cache anchored to the last firing impulse. Previously,
each input update integrated a partial recovery step, so the angle depended on
how often simulation time was flushed. The new path generates full 128 Hz
samples and interpolates their quaternions with the native polynomial blend.
Velocity is evaluated analytically from its original impulse. Updates at
64, 128, 240, 500, 1,000 and 8,000 Hz now preserve the same recoil curve.
This is a timing-partition regression, not a physical USB polling-rate test.

The firing routine at `0x1515420` samples the carried angle at command time
plus one 64 Hz tick, but samples velocity and stores its new anchor at command
time plus half a tick. Thus a new impulse carries an angle sampled 1/128 second
ahead of the velocity. The sanitized `native-recoil-anchor-fixture.json`
retains all 14 predictable angle/velocity anchors from the AK tap/spray demo.
Every consecutive native angle carry matches independently within 0.000002
degrees; a complete trainer replay agrees within 0.00001 raw angle degrees and
0.00003 velocity units. The demo's doubled integer-tick decoding is normalized
only for these anchors, corroborated by the native routine and 100 ms cadence.
These base fields are not instantaneous camera angles.

The physical small-angle cutoff now reaches zero instead of leaving tiny
residual recoil through long bolt/pump cycles. Static spray previews and
imported-capture impulse fitting use the same sampler as live firing. Prediction
clones the cache, so guidance cannot advance or rebase live recoil state.

## Animated hitboxes (fourth pass)

The player's bullet and Zeus traces in Duel, Aim Botz, Reflex and aim_redline
now use all 19 extracted `cstrike` capsules, attached to the actual exported
bones. The renderer captures world-space endpoints after rendering and publishes
them with the displayed actor generation. This follows the displayed animation
even when distant animation sampling is throttled. Two pose buffers per actor
keep the preceding frame intact without allocating capsules every frame.

`tools/verify-native-hitbox-space.mjs` reconstructs native bone transforms from
inverse-bind matrices in all embedded MDAT mesh blocks. It compares those
transforms with the GLB node hierarchies for the target and six agent exports.
All 133 bone comparisons agree: maximum position error is 0.0000216 metres,
and the local transformation is the 0.0254 unit scale to within 0.0000165.
No additional axis swap or rotation belongs on the local capsule endpoints.
Source and exported asset hashes, native endpoints and measured errors are
retained in `native-hitbox-space-fixture.json`.

The neck's native hitgroup 8 maps to the same damage/flinch branch as chest
hitgroup 2 in server routine `0x15464f0`. Offline emulation of the armor predicate
at `0x1596040` verifies 36 armor/helmet/group combinations, including Kevlar
protection on the neck without a helmet. `tools/verify-native-hitgroups.py`
and `native-hitgroup-evidence.json` pin those results to server SHA-256
`0109636a2dfc2a2ec3dee2ead2fd45322b179a111013dbfb14d5cd91855a19d0`.
The trainer therefore reports neck hits in its existing chest category.

Capsule rays retain entry, exit and the nearest anatomical group. Penetration
uses the full actor chord, preserving the existing policy for gaps between
limbs. Current armor/health and current cover remain authoritative; a displayed
pose cannot hit a new respawn generation. Missing required bones fall back as
a complete actor to the previous analytic shape set. Bot shots and headless
simulation retain analytic shapes; the range retains mesh-based scoring.
Melee hulls and movement collision are unchanged. This matches authored shapes
to the visible imported animation; it does not reproduce Source 2's full
animation graph or network lag compensation.

## Camera shot kick (fifth pass)

The native camera adds two separate firing terms: 0.45 of full physical aim
punch, plus `m_vecCsViewPunchAngle`. The composition at `0x152be73` confirms
that the existing 0.45 camera fraction is correct. SprayLab was missing the
second term, which gives a shot immediate visual impact before slower aim
recoil builds.

At `0x1515609`, each shot multiplies its recoil-table magnitude by 0.055,
then applies sine/cosine of that shot's recoil angle and adds the result to
the decayed camera angle. The getter at `0x1525280` applies `exp(-18 * age)`;
`view_punch_decay` defaults to 18. This component has no 1/32-degree cutoff.
Its time anchor is the firing command, separate from the half-tick offset
on physical aim-punch anchors.

`tools/verify-native-view-punch.py` evaluates these bounded arithmetic paths
from the hash-pinned client. Thirty-six impulse cases and 33 decay cases
match the implementation within 0.0000001 degrees. The sanitized
`native-view-punch-anchor-fixture.json` retains all 14 AK camera anchors from
the tapping/spray demo. A complete replay differs by at most 0.000639 degrees,
including network-angle quantization and native absolute float-clock rounding;
the regression permits 0.001 degrees. The earlier landing kick is excluded
from this firing-only replay.

Both browser engines now add camera kick each shot and sample it at render
time. The state belongs to the actor, so holstering does not clear or freeze it.
Bullets and mouse sensitivity remain independent of this presentation term.
Centered-crosshair guides compensate it; recoil-follow guides and crosshairs
continue to project the actual recoil-only firing direction. Session resets
clear the state. Imported recoil captures use inferred impulses for this term,
so those user-provided profiles do not have the same native evidence.

A secondary image check tracks static scene features through 157 frames of the
native AK spray/recovery video (14.4–17 seconds; stationary reference at 14.2).
Adding camera kick lowers the two-axis RMS difference from 0.29 to 0.15 degrees
with a single fitted clock offset and no fitted amplitude. The result is
similar under both plausible 16:9 and stretched 4:3 camera intrinsics. This
supports the missing component; it does not establish exact rendered-camera
parity. The video has capture/simulation timing differences, and the earlier
tapping frames do not align with the spray under one constant clock offset.
They are excluded from the image fit, while all 14 taps/spray shots remain in
the independently timed demo-anchor check. A reference during the preceding
landing animation also adds a spurious baseline rotation and is excluded.

## Landing camera pitch (sixth pass)

The same camera service carries a brief downward dip on landing. The recorded
normal jump changes its pitch anchor to +0.750153 native degrees at the first
grounded sample, matching a 0.75-degree dip within network quantization.
`native-landing-camera-evidence.json` retains the neighboring ground/fall-speed
fields and source demo hash.

`tools/verify-native-landing-camera.py` evaluates the native landing function
at `0x158b920` with supplied dry, stationary ground. Thirty-two cases verify
the strict >250 units/s threshold, pitch `max(0.75, speed * 0.001)`, and the
1024 units/s upper condition. Landing replaces the previous camera pitch;
it preserves the decayed yaw, then uses the shared exponential camera decay.
The audit stubs sound/roll, impact notification and bookkeeping calls, so it
does not establish those behaviors.

Both simulations trigger the pitch change at the physics contact timestamp,
including an immediate hop after contact. Subsequent grounded steps do not
restart the dip. Small step-downs do not trigger it. Water and actor-supported
landings retain their prior presentation until those branches are verified;
heavy-fall roll is also outside this change. Physical aim and shot directions
are unaffected.

## Remaining limits

Native aim-punch fields in this build describe decay anchors, not the current
camera recoil angle. They cannot be fitted directly to video as instantaneous
punch values. The native camera multiplies the doubled punch returned by its
sampler by 0.45, confirming the existing camera fraction. Camera kick now has
native arithmetic and demo-anchor evidence, plus a limited spray-video check.
Full camera and weapon-model trajectories remain partly verified; the weapon
fraction is an estimate.
Native hitboxes now follow the imported animation in the rendered Duel modes.
Full native animation reconstruction and the range's mesh-height hitgroup
classification remain separate work; neither recording a 60 Hz video nor decoding a
64 Hz demo establishes mouse-to-photon latency or exact Source 2 equivalence.

## Validation of this change

- Production TypeScript/Vite build passes.
- Unit suite: 2,022 pass; the one existing failure requires the missing
  `public/models/ak47.json` fallback asset. New regressions cover insertion,
  reserve consumption, both cancellation sides, long steps, silent-rate
  changes, deploy delay and prevention of shots during the remaining reload.
- Chromium weapon firing/reload/recharge integration passes. The reload
  animation/HUD check also passes, with its AK loadout now explicitly seeded
  and an assertion that inserted ammo remains locked while reloading.
- The local preview is served on all interfaces at port 5190. A separate
  review page at port 5191 exposes selected native videos and sanitized
  measurements, without Steam files or account logs. Both LAN URLs return 200.
- Tests and build ran with MemoryMax=8G and MemorySwapMax=0; browser work also
  used CPUQuota=400%. Nothing was pushed or deployed to the public site.

### Scope validation

- 18 new unit cases cover 82 native arithmetic samples, all six scope cycles,
  quickscoping in both simulations, shot cooldowns, interrupted zoom and holster.
- Full unit run: 2,032 passed, seven existing long-running movement cases hit
  the 5-second timeout under concurrent host load, and the known missing fallback
  asset failed. The three affected movement files then passed all 52 cases with
  one worker; performance assertions were retained. The final scope/weapon-mode/
  changelog run passed 40 cases after the iron-sight correction.
- Production build passes. Chromium tests pass in both Duel and the range for
  the rendered midpoint FOV, firing during scope-in and automatic rescope.
- These tests drive simulation time explicitly; software-rendered browser frame
  times are not presented as measurements of the user's hardware latency.

### Recoil validation

- 11 new tests cover 72 arithmetic samples, all 14 recorded firing anchors,
  six update rates, immutable prediction and out-of-order render sampling.
- Full unit suite: 2,051 pass; only the existing missing fallback model fails.
  One worker and a 30-second case timeout avoided the earlier host-load timeouts.
- Production build and both Chromium input/firing checks pass.

### Hitbox validation

- 22 new/expanded unit cases cover native definitions, seven exported skeletons,
  36 armor cases, rotated rays, tangencies, starts inside, penetrated limbs,
  collateral hits, pose buffering and live generation/cover rules.
- Full suite: 2,073 pass; only the known missing fallback asset fails.
- Chromium real-click checks pass on rendered standing, half-crouched and
  crouched/turned heads, including a target that has moved since that frame.
- Production build passes. Animation buffers are pooled per actor and released
  on rebuild, respawn and engine disposal.

### Camera-kick validation

- 69 emulated arithmetic samples and all 14 native AK camera anchors pass,
  alongside holster/reset, immutable sampling and guide-alignment regressions.
- Full unit suite: 2,079 pass; the existing missing fallback model is the only
  failure. Production TypeScript/Vite build passes.
- Seven Chromium checks pass: event-time input, scope/quickscope/rescope,
  animated hitboxes, and immediate/between-tick camera kick in both engines.

### Landing-camera validation

- 32 native pitch cases pass, plus regressions for replacing shot kick,
  firing during recovery, small step-downs and contact timing in both modes.
- Full unit suite: 2,084 pass; only the existing missing fallback model fails.
- Production build and both Chromium camera/landing checks pass.
- The LAN review page loads all five native clips and six evidence downloads
  in Chromium, with no page errors or horizontal overflow at desktop/mobile sizes.
