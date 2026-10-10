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
The later `native-reload-clock.md` verifies the held gate and imports separate
empty-reload markers. The normal partial-reload measurements below are not proof
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
- The recorded crouch/stand transitions retain 25 amount/speed samples in
  `src/range/native-duck-fixture.json`. Replaying from each transition's first
  sample at 64 Hz agrees within 0.000001; the existing 128 Hz implementation
  stays within 0.003 of the native duck amount. Four regression cases retain
  that comparison. Initial key-edge timing and full camera height animation
  are not established by this partial-trajectory replay. No crouch-rate tuning
  was justified, so the movement constants are unchanged.
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

## Damage camera composition correction

The combined getter at `0x1515920` returns physical punch; the camera at
`0x152bf3b` and `0x152bf47` scales its pitch, yaw and roll by 0.45. Duel had
applied damage punch at full scale before adding the correctly scaled weapon
recoil. The camera now uses 0.45 for both. The shot ray and the existing damage
recovery model are unchanged. A browser regression injects a known damage
angle and independently checks all three camera axes against the retained
physical shot angles. This verifies camera composition, not a new native
measurement of the complete damage-recovery trajectory.

## Movement and accuracy rules read from the server (seventh pass)

Recorded on October 9, 2026 from the installed Linux `libserver.so` (client
2000927, SHA-256 `0109636a2dfc2a2ec3dee2ead2fd45322b179a111013dbfb14d5cd91855a19d0`),
decompiled with REA 6.1.0 and Ghidra 12.1.4. Convar names lead only to the
static initializers that register them; the code that uses a convar is found
through references to the registered object. Decompiled functions and the
query helpers are retained in `../native-audit/rea/`.

Rules the trainer already matched, now with code evidence instead of demo
agreement: ground friction (`max(speed, sv_stopspeed) * sv_friction * surface
friction * dt`, ground only), air acceleration (wish speed capped by
`sv_air_max_wishspeed`, uncapped wish speed in the gain), the continuous
`1 - 0.66 * duckAmount` crouch factor, duck-speed thresholds 1.5 and 0.75 with
the 0.8x, 3/s and 6/s rates and the `sv_timebetweenducks` cooldown, the accuracy
baseline (stand, crouch under FL_DUCKING, stand + jump x `weapon_air_spread_scale`
in the air), snap-up and `ln(10)/recovery` exponential decay of the accuracy
penalty, the recoil index decaying as `10^(-2t)` only after
`last shot + cycle + 1/64 s` with a snap to zero at or below 0.1, the movement
term remapped over 34%..95% of the mode's max speed with the 0.25 power unless
walking, and the airborne term interpolated on `sqrt(|vz|)/sqrt(sv_jump_impulse)`
and clamped to `[0, 2 * initial]`. The stamina convars are still registered but
only the `sv_legacy_jump` path uses them; the default modern jump applies the
landing-velocity factors already in the trainer.

Two rules differed and are now implemented:

- `WalkMove` clamps horizontal speed to the current max speed on every ground
  tick after acceleration. The trainer only did so after a first landing, so
  walking, crouching or being tagged at full speed bled speed off through
  friction instead of cutting it at once. The landing factor now only lowers
  that cap.
- The modern jump clamps the start speed to 1.1x the weapon's max speed unless
  `sv_enablebunnyhopping` is set, and restores the pre-landing velocity on a
  bunnyhop only when it exceeded the max speed. The trainer had no 1.1x limit.

Also aligned: Duel no longer buffers a fire press released before the weapon is
ready; like the range and the native item post-frame, a shot fires at readiness
only while the trigger is still held, and a released tap during a shell reload
neither interrupts it nor queues a shot.

Landing inaccuracy: the server weapon class's landing hook (reached through
the class vtable, since Ghidra left it undefined) adds the current mode's
`inaccuracy_land` times the landing speed in units/s to the accuracy penalty,
which then recovers normally. The trainer imported the field but never applied
it; both simulations now call `WeaponRecovery.land()` from the same landing
detection that drives the camera dip. For an AK-47 a normal jump lands with
about 0.073 of penalty, roughly half the airborne term.

Damage now truncates each hit's health damage and armor loss to whole points.
This was not read from the binary; it follows the game's displayed values
(AK-47 chest on Kevlar: 27 damage, 4 armor; M4A4 23; AWP 112; AK-47 at 500
units 35), which only the per-hit truncation reproduces.

Bullet spread sampling, read from the server's shared bullet routine (the one
that consults `weapon_accuracy_shotgun_spread_patterns`), matches the trainer's
`sampleShotSpread`/`shotDirections` exactly in structure: per shot it draws the
inaccuracy radius, the inaccuracy angle, the spread radius and the spread angle
in that order, radii uniform without a square root; the R8 alternate fire maps
both radii through `1 - r^2`; the Negev squares the radius three, two or one
times for recoil index 0, 1 or 2 before `1 - r`; the offset is
`cos/sin(angle) * radius * inaccuracy + cos/sin(angle) * radius * spread`.
Shotguns with patterns enabled (the native default) take the spread pair from
the pattern table at `floor(recoilIndex) * pellets + pellet` and redraw the
inaccuracy pair per pellet; with patterns disabled the inaccuracy pair is
drawn once per shot and only the spread pair per pellet. The two debug
convars that force the angle upward or ignore inaccuracy are off. Only the
random stream's seed (derived from the user command) and float-exact
`sinf/cosf` remain unreproduced, which affects individual shots, not the
distribution.

CS2 also registers `sv_turning_inaccuracy_*` and `sv_strafing_inaccuracy_*`
terms (both registered with default 0, so the inaccuracy getter adds nothing),
a `weapon_accuracy_stack_boost_limit` penalty for players standing on
teammates and a `weapon_land_dip_amt` view effect; none applies to the
trainer's defaults.

## Dynamic crosshair (eighth pass, client)

Read from `libclient.so` (build 2000930) with REA/Ghidra on 2026-10-09: the crosshair convars are
registered in one client routine (this build's set includes `cl_crosshair_gap`, `cl_crosshair_length`
and `cl_crosshair_thickness` in `cl_crosshair_screen_height` = 1080 reference pixels, `cl_crosshairstyle`
7 by default, and a new `cl_crosshair_dynamic_spread_limit`, default 255, described as "the additional
distance the dynamic elements are allowed to spread out to from the baseline of 128 pixels"). The
crosshair update routine, found through the convar values' readers, does the following every frame for
the dynamic styles:

- Cone = the weapon's current inaccuracy plus its spread (both tangent units), the same sum the
  trainer uses. In the settings preview the cone is animated as |sin(t)| * 0.1 instead.
- Offset = the screen distance, in real pixels, between the projection of the view direction and the
  projection of a direction deviated by that cone, 2000 units ahead at the current field of view. For a
  perspective projection that is cone * (half screen height) / tan(vertical fov / 2), which is what
  `dynamicCrosshairGap` already computed (the CS:GO HUD's 320 px per radian at 640x480 scaled by height).
- The offset is then eased into a soft limit: with limit = spread_limit + 64 (319 px by default) and
  knee = 0.75 * limit, an offset past the knee becomes limit - (limit - knee) * e^(-(offset - knee) /
  (limit - knee)), never exceeds the limit, never drops below the bar thickness when the centre dot is
  on, and is truncated to whole pixels. The trainer now applies the same easing and truncation
  (`crosshair-spread.ts`, default limit 319, a custom limit as a parameter); the dot floor (at most a
  couple of pixels) is not reproduced.
- The crosshair alpha fades toward 20% as inaccuracy plus a weapon term approaches 0.25; the trainer
  does not reproduce this.

Standing with an AK at 1080p the offset is 4 px, running 128 px, so the limit only matters in the air
or deep in a spray. `tools` keep nothing new for this pass; the decompiled routines are in
`native-audit/rea/out/client-*.c`. The client analysis itself took 90 minutes at one core under a 4-hour
cap (the 90-minute cap of the first attempt discarded it, see the memory note).

## Crosshair geometry, scoped sensitivity and viewmodel motion (ninth pass, client)

Read from `libclient.so` (build 2000930) on 2026-10-09 with the convar tracer
(`native-audit/rea/trace.py`: string, registration, the convar object's data pointer, its readers).

Crosshair (the classic bar styles the trainer draws): every value is a whole number of pixels. The
bar thickness t is rounded (at least 1) and split as ceil(t/2) pixels before the centre line and
floor(t/2) after it, for the horizontal bars, the vertical bars and the centre dot (a t-sized
square). The gap g is clamped at 0 and is the distance from the truncated screen centre to a bar's
inner edge: the left bar ends at floor(cx - g), the right starts at ceil(cx + g), the same vertically;
T-style skips the top bar. Outline mode comes from `cl_crosshair_drawoutline` (0, 1 or 2) and the
colour alpha is scaled by the fade factor. When the screen height differs from
`cl_crosshair_screen_height`, the game multiplies length, gap, thickness, split distance and the
dynamic spread limit by the ratio, rounds, keeps at least one pixel (the gap keeps its sign) and
writes the values back. The trainer's import now rescales the same way, no longer pulls the gap in
by one pixel for odd thicknesses, lays the bars out on the odd-thickness split and never draws a
negative gap. Not reproduced: the circle of style 7 (this build's default: classic bars plus a ring
whose radius is the dynamic spread offset), the quadrant and square styles, and the two outline
modes' exact rendering.

Scoped sensitivity: the client multiplies mouse input by max(trunc(current FOV), trunc(target
FOV)) / trunc(default FOV) times `zoom_sensitivity_ratio` (and by `sensitivity`). Zooming in follows
the FOV transition, as the trainer already did; zooming out uses the target of 90 at once, so
sensitivity is back to full while the camera is still widening. `WeaponActions.sensitivityAt` now
takes the larger of the two FOVs.

Viewmodel motion: this build has no bob or sway convars (`cl_bob*`, `cl_viewmodel_shift*`,
`viewmodel_recoil` and `view_recoil_tracking` do not exist in the client), and the viewmodel
animation graphs (`animation/graphs/viewmodel/viewmodel.vnmgraph` with one referenced graph per
weapon) carry only draw, fire, reload, inspect, idle and settle clips with variation and speed-scale
parameters, nothing driven by movement or look input. The AK's graph references a single fire clip,
so there is no fire variation to add. The trainer's clip set matches; its 2 mm walking bob is
below visibility and stays. The weapon's share of the recoil kick remains unverified: the viewmodel
entity has no symbol or convar to find it by. The Duel bots blend the game's locomotion set (`duel-motion.glb`: eight-way run, walk and
crouch cycles, jumps, pistol idles); only the practice range's drill dummy (`target.glb`) is limited
to idle and two run clips. Since 2026-10-09 the bots also play the game's flinch clips on hits and die
as a joint rig that topples and lies down (see `docs/duel-implementation.md`); turn-in-place,
planted-foot transitions and landing clips remain the gaps.

## Server rules: subtick movement, fire timing, footsteps, penetration, movement audit (tenth pass)

Read from `libserver.so` (the install's 2026-10-08 build, same layout as 2000927 for the movement
routines) on 2026-10-09 with the convar tracer on a second bridge, plus the demos recorded earlier
in `native-audit/reports`.

Subtick movement. `DoMovement` walks the command's subtick steps: every button edge carries a
fraction of the 1/64 s tick, and the movement passes run once per sub-interval with that interval's
buttons (`sv_subtick_movement_view_angles` 1 takes the view angles at the fraction too). Both
trainer engines already advance the simulation to each input's timestamp before applying the edge,
so presses and releases take effect at their own time. Nothing to change.

Fire timing. A weapon keeps its next-attack time in seconds; the server compares it, converted to a
tick and a ratio, with the command time. The recorded demos show what that means in play: a held AK
fires on ticks 6 and 7 apart (mean 6.4, exactly 100 ms) while the recorded last shot time advances
by exactly 0.1 s, and the M4A4 by exactly 0.09 s. (The original text mislabeled the demo as M4A1-S;
the independent re-audit resolves its active entity and fire events as M4A4. Current
M4A1-S vdata has a 0.1 s cycle.) So the click fires at its own subtick time, each
following shot is processed on the first tick at or after its exact schedule, the schedule
accumulates by the cycle, and the last shot time is the scheduled one (which is why the recoil-index
decay of the seventh pass tolerates one tick). The trainer now does the same in both engines
(`tickAligned`, 1/64 s): shots after a press land on tick boundaries with the schedule exact, and a
shot more than a tick late for its schedule is scheduled from its own time, as the game's stale
next-attack time is. A reload or a deploy sets the next-attack time to its end, as the game's reload
and deploy sequences do, and the R8 windup end is checked the same way: a trigger held or pressed
early is processed on the first tick at or after that end and scheduled there (a Nova held through
its 0.88 s pump fires on the tick after it and is due again at 1.76 s, not a tick later). The recoil
guides predict the next two shots at those ticks. Before this pass every shot fired at its exact
schedule.

Penetration. The per-surface routine is the trainer's `penetrationLoss` to the term:
(3 / power) * 1.25 * 3 / modifier + damageLoss * damage + thickness^2 / (24 * modifier), with the
same-material branches (glass or grate under 6 units: modifier 3, loss 0.05; wood 3; plastic 2), a
3000-unit limit, four penetrations, at least one damage point left to continue, and modifiers under
0.1 stopping the bullet. A teammate's flesh uses the friendly-fire penetration convar, which the
trainer never needs. Not reproduced: one surface-flag special case (modifier 1/32, loss 1e-5) whose
trigger could not be identified, and the debug-impact record's 1.18 / 2.8 / 0.15 terms, which never
touch damage.

Footsteps (corrected by pass21). The earlier inference that cadence came from animation
cycle length was unsupported. Current native instructions establish a movement countdown,
described in [the footstep re-audit](reaudit-footsteps.md), and the 1.35 m trainer rule has
been replaced. The retained 75/500 u branch belongs to an entity-event listener and does
not establish sound transmission radii. Searches finding no direct server readers for
the audible-threshold/forced-volume convar pointers are bounded negative results, not
proof that those convars have no effect elsewhere. Walk/crouch suppression is established
for the tested normal-ground states; complete client/audio transport remains unverified.

Movement audit. Accelerate matches the fixture-derived function: base max(250, wish speed), the
weapon's speed scale when `sv_accelerate_use_weapon_speed` is on (default 1), 0.34 while ducking,
0.52 while walking, and the 5 u/s taper under the walking cap. One corner case was added: at zoom
level 2 with a walking speed under 110 u/s (AWP, auto-snipers) walking keeps the weapon scale instead
of 0.52. `sv_backspeed` and `sv_condense_late_buttons` have no readers; `sv_bhop_time_window`,
`sv_jump_spam_penalty_time`, `sv_timebetweenducks`, `sv_ladder_scale_speed`, the walkable and
standable normals and `sv_jump_impulse` are read where the trainer's rules expect them; the weapon
encumbrance convars do not exist (weapon speed is vdata). The numeric defaults are not in the
binary's static data (registration passes an empty descriptor and the objects live in
zero-initialised memory), so the values the trainer uses remain those of the public defaults and the
earlier fixtures, not a reading from this build.

## Movement integration order (eleventh pass, 2026-10-09)

The current server SHA-256 is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
`tools/verify-native-air-movement.py` executes bounded native arithmetic without
launching CS2: 54 air samples and 12 ground pre/post-move samples are retained in
`src/range/native-air-movement-fixture.json`. The saved `AirMove` and `WalkMove`
callers establish where those helpers run relative to the collision move.

- Air acceleration applies `min(total gain, uncapped acceleration budget / 2)`
  before movement and the remainder afterward. Near the 30 u/s wish cap, all
  remaining gain can fit before movement, so averaging old and final velocity
  is incorrect for air movement.
- Ground movement clamps final velocity to the stance/weapon/landing cap,
  then uses the midpoint between initial and final velocity for displacement.
  The other half of the friction/acceleration correction is applied afterward.
- Modern jump restores pre-landing horizontal velocity only when it exceeded
  the weapon cap (or auto-bhop is explicitly enabled), before applying new air
  gain. The trainer restored even slower landing velocity and overwrote new gain.

`tools/probe-movement-feel.mjs` writes reproducible trajectories, retained in
`../native-audit/reports/movement-feel-before.json` and `movement-feel-after.json`.
First-step distances below use an AK and 1/128 s:

| Case | Trainer before, units | Trainer after, units | End speed, u/s |
| --- | ---: | ---: | ---: |
| Accelerate from rest | 0.072174 | 0.036087 | 9.238281, unchanged |
| Release from 215 u/s | 1.611450 | 1.645569 | 206.265625, unchanged |
| Counter-strafe from 215 u/s | 1.539276 | 1.609482 | 197.027344, unchanged |
| Switch from running to walk | 1.611450 | 1.276563 | 111.8, unchanged |
| Air strafe from rest | 0.157471 | 0.078735 | 20.15625, unchanged |

A 50 u/s bunnyhop with a prior landing speed of 100 or 215 used to become 100
or 215 u/s; it now stays 50. A prior 250 u/s landing still restores to the AK's
236.5 u/s jump cap. The 34% accuracy threshold stays at 78.125 ms under opposite
input and 203.125 ms after release; release stops at 382.8125 ms and acceleration
reaches 215 u/s at 570.3125 ms. No friction or acceleration constants were tuned.

Status: matched for bounded dry-ground/air integration arithmetic and the
statically traced restore rule. Collision response, moving supports and full
native tick-by-tick trajectories are not established by these helper fixtures.
`../native-audit/audit-movement-demo.py` measures that the demos' `velocity_X/Y`
aliases describe the preceding position interval (mean component error 0.00128
u/s, versus 3.32 u/s for the same interval). Correctly aligned interval speeds
cross 34% at 203.125 ms in both releases and 78.125 ms in the reversal, exactly
the trainer's probe values. The first pass's apparent 15.625 ms discrepancy
came from that parser lag. Native release stops in a 375 ms interval versus
382.8125 ms in the trainer; this is within half a native tick. Available fields
do not supply direct horizontal velocity: these remain interval averages and
sampled button edges, not proof of instantaneous/subtick parity. No stop-time
correction is warranted. Crouch amount/rates remain verified;
the camera eye-height smoothstep remains unverified.

## Held input through reload and deploy (twelfth pass, 2026-10-09)

The current server's item post-frame dispatcher checks the primary-button
predicate, then ordinary primary readiness, then dispatches the attack. The
button predicate accepts a held current-command button; a failed readiness
check does not consume it. The next ready command therefore needs no new
press. The predicate also has a command-transition fallback, so this static
trace does not prove that every within-command press/release is discarded.
The source chain is retained in
`../native-audit/reports/feel-audit-20261009/trigger-dispatch-evidence.json`.

The range previously ended an attempt on reload/deploy and forgot held input;
presses during a magazine reload or deploy were also discarded. Physical
`pressTrigger()` now keeps that input separate from training `start()` and
reconsiders it when the weapon becomes ready. Releasing, pausing, resetting or
reconfiguring clears it. Configured practice bursts still stop at their limit.

`tools/audit-trigger-continuity.mjs` writes the before/after measurements in
`../native-audit/reports/feel-trigger-{before,after}.json`:

| AK case | Before | After |
| --- | --- | --- |
| Press during / hold through magazine reload | No resumed shot | Shot at 2.468750 s, readiness 2.466667 s |
| Press during / hold through deploy | No resumed shot | Shot at readiness, 1.000000 s |
| Hold through empty auto-reload | No resumed shot | Shot at 2.578125 s, readiness 2.5682295 s |
| Release before readiness | No shot | No shot |

The held-fire fix matches the static dispatcher rule. Timing uses the existing
tenth-pass tick schedule; it is not a new native measurement of these exact
reload/deploy scenarios. A fresh early press's effect on the native *subsequent*
schedule remains unverified. The previously cited postpone-fire comparator is
R8-specific, not the generic primary readiness check. The new readiness fixture
keeps those comparators separate and does not claim to resolve that scheduling
question. The prepared native capture protocol includes the missing cases.

## R8 windup (thirteenth pass, 2026-10-09)

The current server's revolver initializer adds thirteen 64 Hz ticks to the
command tick/ratio pair, retaining the fraction. Ordinary primary readiness
and R8 postponed readiness compare distinct deadlines against that same
command representation. `tools/verify-native-fire-readiness.py` runs these
bounded native instruction paths from the hash-pinned current server and
retains 20 initialization plus 42 readiness cases in
`src/range/native-fire-readiness-fixture.json`.

The trainer's explicitly estimated 200 ms windup is now 13/64 s = 203.125 ms.
The shared action controller applies it in both engines; releasing before the
deadline cancels the windup, and alternate fire retains its immediate path.
Status: matched for deadline arithmetic, not the full revolver animation or
physical input-to-command latency. These readiness comparisons do not settle
whether a fresh early press changes the subsequent native firing schedule.

## Follow-recoil presentation (fourteenth pass, 2026-10-09)

The current client SHA-256 is
`eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1`.
The HUD follow-recoil caller samples predictable weapon punch at presentation
time, adds it to input angles and projects through the current camera. It does
not add the separate damage punch to that target direction, although damage
still moves the camera. Its pixel block ceilings projected coordinates and
keeps each axis at the truncated center when within one pixel of the center.
The static source chain is retained in `../native-audit/reports/client-feel-evidence.json`.

`tools/verify-native-follow-crosshair.py` verifies 12 direction cases and 30
pixel cases from the native instructions in
`src/range/native-follow-crosshair-fixture.json`. Both renderers now use the
same render-time recoil sample as the camera, instead of the preceding
simulation sample, and apply that pixel conversion. Range guides use that
displayed sample too. `tools/probe-follow-crosshair.mjs` measures a deterministic
240 Hz AK magazine at 1920 x 1080: the old stale sample diverged by up to
0.323450 degrees / 4.011252 pixels; including pixel snapping, the largest total
correction is 4.669296 pixels. The sample mismatch is now zero.

Status: matched for the bounded direction/pixel arithmetic; applied in the
trainer's existing CSS HUD viewport. Full native framebuffer/DPR/stretching
equivalence is not established. The native verifier supplies view angles and
projection inputs and substitutes math imports, rather than running CS2.

No new evidence justifies changing the 0.45 camera scale or estimated 0.22
weapon fraction. The exact `view_recoil_tracking` name is absent in the current
client, while `weapon_land_dip_amt` registration has no identified direct
value readers in bounded client/server searches. Indirect readers remain
possible. The client eye getter consumes interpolated view offsets, but the
crouch setter curve was not traced. Those weapon/camera effects remain
unchanged pending a controlled recording with world and weapon landmarks.

## Current weapon data and AUG reload (fifteenth pass, 2026-10-09)

A fresh Source 2 Viewer export of installed build 2000930's
`scripts/weapons.vdata_c` has SHA-256
`46e7a84b46c620e8daf11c403ee9152a5faa1a033407748b527862aa3147236b`.
`tools/verify-weapon-data.mjs` compares 2,730 values across all 35 runtime
weapons and both authored modes, plus 108 tagging values across 36 weapons.
Only the two AUG reload-lock values differed: 3.766667 s in the trainer versus
3.2 s in the current game. All compared recoil, accuracy/recovery, spread,
speed, cadence, scope, ammo and damage parameters match after that correction.
`docs/native-weapon-data-evidence.json` retains coverage, hashes and differences.

The current AUG reload clip independently lasts 3.2 s and inserts ammo at
frame 42/30 = 1.4 s, replacing the old frame 47/30 = 1.566667 s. Its silent
window remains frames 0..89. Both HD and legacy viewmodels were rebuilt from
the current native clip using the existing Blender retarget pipeline, with 97
samples, 302 reload channels and unchanged mesh/skin/node/clip counts. Maximum
part matrix error is 2.38e-7 and attachment error 1.19e-7, below the existing
1e-4 gate. All other clip durations remain unchanged. Merely scaling the old
animation to 3.2 s would place its insertion pose about 69 ms too early.

Reload foley was refreshed from the same clip: frames 15, 40, 42, 62 and 67;
all cues resolve and the insertion sound occurs at 1.4 s. The public audio
manifest and checked-in timeline agree. `../native-audit/verify-aug-refresh.py`
reproduces structural/animation/audio validation; reports and old-asset backups
are in `../native-audit/reports/aug-refresh-*`. Deploy must mirror the two
gitignored AUG GLBs and the public audio manifest. `tools/build-reload.mjs`
now supports the Linux converter and limits Blender to two threads; this audit
used a checksum-verified portable Blender under `../native-audit/tools/`.

Status: matched for current exported parameters, authored normal reload timing,
animation and cue data. This is not a new live recording of every empty/silent
reload branch. Older recoil-table emulation, binary tagging and cosmetics
audits retain their own original build labels; refreshing vdata does not
retroactively establish current-engine RNG or full damage arithmetic.

The retained `../native-audit/reports/native-server-probe.log` directly reports
acceleration 5.5, weapon-speed scaling enabled, friction 5.2, stop speed 80,
gravity 800 and jump impulse 301.993. This strengthens those defaults beyond
the tenth pass's static-data limitation. Other current-build defaults, including
recoil suppression/smoothing and jump-spam thresholds, still need an explicit
runtime/config source. None was changed from an unverified assumption.

## Runtime settings and independent benches (sixteenth pass, 2026-10-09, ongoing)

This re-audit starts at `c488943`; passes 1–15 are claims to test. New native
runtime evidence is retained in [the settings ledger](evidence/reaudit-runtime-settings.json),
including current binary hashes, original query-log hash and the exact unavailable
command names. The user approved an offline CS2 session, then explicitly rebooted
the host during setup. The queries survived; that initial session produced no demo.
Both REA bridges were restored and analysis restarted sequentially from the installed
server/client artifacts. Saved decompiles and fresh asset exports survived.

Live queries independently establish current values: ground acceleration 5.5,
weapon-speed acceleration enabled, friction 5.2, stopspeed 80, air acceleration 12,
air wish cap 30, gravity 800, jump impulse 301.99338, modern jump, bhop window
1/128 s, spam penalty 1/64 s, duck cooldown .4 s, ladder factor .78, walkable and
standable normal .7, subtick movement view angles enabled, air spread scale 1,
and patterned shotgun spread enabled. These are current session values; calling
them all factory defaults would overstate this measurement.

`weapon_recoil_scale`, the legacy decay/suppression names, `view_recoil_tracking`,
`weapon_land_dip_amt`, `cl_eye_smooth_*` and `sv_stepsize` return unknown command.
Earlier notes that infer their presence or runtime defaults from binary strings
are not independently reproduced by the current console. This does not establish
that their underlying code or constants are absent. Sensitivity 1, yaw/pitch .022,
zoom sensitivity 1, viewmodel FOV 65 and offsets −.5/1/−2 were retained for footage.

New reproducible benches: `tools/reaudit-movement.mjs`, `tools/reaudit-combat.mjs`,
`tools/reaudit-combat-native.py`, `tools/reaudit-animation.mjs`. Their reports keep
native evidence distinct from trainer behavior; no numerical match is claimed
merely because an existing unit test passes. Before/after findings and status for
the full requested inventory are recorded in the [movement](reaudit-movement.md),
[combat](reaudit-combat.md), [response](reaudit-response.md), and
[model/animation](reaudit-animation.md) inventories. Unverified rows are open work,
not claims of native equivalence.

## Recorded jump and crouch state (seventeenth pass, 2026-10-09)

Fresh approved `native_reaudit_airduck_003.dem` establishes three corrections.
Standing launch is 298.86838 u/s, while fully crouched launch retains 301.99338;
midair crouch/unduck finishes immediately and shifts the origin by ±9 units;
camera-service view/root offsets approach their targets at 90 u/s. The shared
motor now reproduces these rules. Before/after standing apex is 56.9974→55.8255
units; midair-crouch apex is 74.9974→64.8255. Recorded values are 55.81235 and
64.82797 respectively, bounded by demo sampling and position quantization.

The eleven fresh fixture cases change from one pass/ten failures to eleven
passes. Camera checks retain each 64 Hz sample and agree within 0.0001 unit.
Ground friction and acceleration were independently rechecked and left unchanged.
The new lateral capture crosses a slight slope and later obstructed travel, so
it is not evidence for retuning flat-ground stopping constants.
[The movement inventory](reaudit-movement.md) names every source, equation,
before/after result and remaining runtime boundary. Server camera-service state
is not proof of the final client-rendered camera trajectory.

## Scheduled recoil replay (eighteenth pass, 2026-10-09)

Two fresh AK recordings distinguish the scheduled impulse from its processing
tick. Native held-fire anchors advance by 0.1000000015 s while shots are emitted
on 64 Hz ticks. The trainer previously anchored punch at processing time even
though its firing schedule was exact. The recovery model now samples carried
angle and velocity at the scheduled time, applies the impulse there, and samples
forward to the current processing time. Both engines and next-shot guides share
that clock. Cadence is unchanged.

For six held shots in `native_reaudit_recovery_001`, maximum processing-time
punch error changes 0.235337°→0.00000215°. The independent eight-shot
`native_reaudit_shooting_001` changes 0.338199°→0.00000239°.
[The combat inventory](reaudit-combat.md) and
[portable result](evidence/reaudit-combat-summary.json) retain the evidence.
Fresh data comparisons independently match 2,730 weapon parameters and 108
speed/tagging values. This does not resolve the measured fire-penalty/index
update-order discrepancy, all-weapon runtime schedules, or physical early-tap
semantics. The recorded input timestamps do not support treating the intended
25 ms early tap as a precisely delivered 25 ms edge.

## R8 mount and animation imports (nineteenth pass, 2026-10-09)

The first R8 mount check was insufficient: a paired runtime strip showed hanging
arms even though a bind-composed reference matched. The native revolver graph
actually applies `prepare_shoot_revolver` as an additive layer over frame zero
of `shoot1_revolver`. The importer now composes those deltas onto that authored
base and preserves constant weapon-armature channels. Both HD/legacy assets were
rebuilt. An independent DMX-derived reference checks 30 frames and 450 landmarks
per asset: arm/finger position error changes 752.262→0.02743 mm, rotation error
131.139→0.01357°, and sampled weapon-part error 0.97245→0.0001763 mm.

Strengthened runtime tests include arms, hands, fingers and weapon after idle
and fire/cancel. The prior 124.647 mm mount-only conclusion is superseded: it
used the wrong graph base and could not certify the assembled pose. Charge
playback rate remains unverified; the existing mechanical windup and retiming
are retained rather than inferred from these pose measurements.

The wider bench freshly compares 90 world clips and four flinches (419,310
channel samples), 37 absolute view clips (2,206 frames), with additive R8 charge checked separately, and 19 posed hitbox capsules
across six world clips. World durations match exactly; sampled capsule endpoint
conversion error is at most 0.230 mm. The SAS body is simplified from 19,077 to
9,779 vertices. Native clip fidelity does not establish native graph fidelity:
planted transitions, turn-in-place and jump/landing additive layers remain absent;
procedural aim, blending and ragdolls are approximations. The 90 flinch resource
entries contain 45 paired representations, not 90 distinct bullet-hit gestures.
[The full model/animation inventory](reaudit-animation.md) records those limits.

## Accuracy and index update phase (twentieth pass, 2026-10-09)

The full native caller investigation and numeric evidence are in
[reaudit-accuracy.md](reaudit-accuracy.md). Current-hash server instruction
emulation covers 39,648 supplied weapon/mode/stance/boundary cases. The new
production `WeaponRecovery` has zero penalty/index error across that grid.
Original cumulative demo replay covers 22 accepted recordings, 41,584 ticks
and 160 shots; only the already bounded network landing-speed precision
remains above decoded float precision.

Both engines now apply accuracy/index recovery in complete 64 Hz steps,
while continuous aim-punch keeps its scheduled anchors. Fractional shots
precede the pending accuracy step, exact-boundary shots follow it. Mode
changes preserve accumulated penalty and the index gate uses the primary
cycle. Common magazine reloads apply the captured index increment/reset;
R8-specific follow-up is excluded at the user’s request.

Fresh AK recovery penalty error falls from 0.0013072615 to 1.4901161e-8;
index error falls from 1 to decoded float precision. The new independent
recovery_002 recording reaches 5.9604645e-8 penalty and 5.5511151e-16 index
error. Portable tests carry original snapshots cumulatively, exercise both
live engines against fractional/boundary AK bursts and explicit/automatic
reload starts, and check subdivision/prediction invariance.

This does not establish complete native parity. The common caller chain is
read directly, but the full engine scheduler is not emulated. Only two
exact-boundary AK examples are available; burst subshots, shell-reload
cancellation, suppressor/holster transitions and simultaneous stance/landing
shots remain outside runtime coverage. The first two R8 capture attempts decode as AK and are excluded;
R8-specific changes are outside this correction. Final combined validation passes
TypeScript, 2,325 unit cases (only the known missing fallback fixture fails) and
all five targeted Chromium cases; deployment verification follows the batched push.

## Normal-ground footstep cadence (twenty-first pass, 2026-10-09)

The [footstep evidence ledger](reaudit-footsteps.md) replaces the distance accumulator
with the current native movement countdown in both engines. Hash-bound instruction
emulation covers 63 enabled timer/gate/boundary cases plus six sustained sequences.
The native command producer emits one complete 64 Hz segment for unchanged ordinary
input and inserts supplied input edges; there is no unconditional 128 Hz half-tick.
The footstep hook samples velocity and stance before movement.

Both actual engines previously emitted AK steps every 242.1875–250 ms, AWP steps
every 265.625–273.4375 ms and knife steps every 210.9375–218.75 ms. They now emit
every 406.25, 406.25 and 312.5 ms respectively, matching the ordinary-command
native countdown with zero steady interval error. Walking and fully crouched probes
emit no steps. Slow movement preserves the countdown; stopping resets it. Pending
samples are discarded on pose/actor resets and range cancellation.

Timer arithmetic retains native float32 rounding, including fractional expiration
cases where double arithmetic changed whether the command emitted. The focused
run passes 187 cases, including 82 footstep cases and both-engine pre-move/input-edge
checks; TypeScript passes. The portable [before/after report](evidence/reaudit-footsteps.json)
retains all measured events and limits. Full-suite/browser validation is recorded
separately after source freeze.

This establishes ordinary flat dry-ground cadence. Exact native input-fraction
quantization and weapon/jump/landing command inserts, water/ladder rules, special
jump/landing sounds, native client delivery, mixer loudness, occlusion and hearing
distance remain outside complete parity. No mixer constant was tuned from the
old gapped capture.

## Camera sampling and command-history clocks (twenty-second pass, 2026-10-09)

The [camera-clock ledger](reaudit-camera-clocks.md) and portable
[results](evidence/reaudit-camera-clocks.json) supersede the broad inference that
matching the old 14-shot camera fixture established the complete caller clock.
Current client/server instruction execution verifies 512 sampler cases and 72
impulses; four client setter cases preserve the explicit tick/fraction. The
separate native sampling and stored command clocks matter even with correct
float32 decay and impulse arithmetic.

Four original AK demos contain 52 shots/48 pairs. Using the recorded clocks reduces
cumulative anchor discrepancy to 0.000228°; the old fixture's near-coincident
clocks hid the wider differences. Actual ViewPunch class replay at a declared
demo reference clock has maximum 0.499441° discrepancy. A schedule-only candidate
still reaches 0.177648°; supplying both recorded clocks lowers all four replay
maxima below 0.000199°. These are exogenous class inputs, not screen errors.

Current-server resolver instructions and embedded protobuf/generated parsers
identify attack-start history indices and distinct player/render clocks.
Exact-history selection, tick-domain conversion, clamping and cached fallback
explain why camera anchors need not equal firing deadlines. Static evidence
does not identify every demo shot's runtime branch or establish a browser input
mapping. Production camera behavior is deliberately unchanged pending that data.

Continuous Recovery002 yields 386 scene-rotation measurements. With one clock
offset and no amplitude fit, recorded aim plus kick gives 0.09055° two-axis RMS,
versus 0.11085° for aim alone. Maximum residual remains 1.24452°; selected displayed
GameTime/container offsets vary by 49.7 ms. This is partial native presentation
evidence, not a rendered parity claim. No new game launch or Ghidra analysis
was needed; bounded probes and saved matching-hash evidence survived reboot.

## Presented-frame history and weapon recoil (twenty-third pass, 2026-10-09)

The current client/engine [history trace](reaudit-client-history.md) resolves
first-press construction: the first attack-down selects the last successfully
published frame and its captured player clock, which is copied/remapped into
command history. Twenty-four instruction assertions and eleven cross-module
bindings pass across 27 bounded ranges. Prediction phase, publication order and
per-shot resolver branch/cache remain runtime evidence needs. No fitted clock
offset or camera-anchor change is shipped.

The independent [model recoil trace](reaudit-viewmodel-recoil.md) establishes
that the ordinary local HUD uses published camera angles, then adds 0.325 of
the same combined physical punch. Both model entities store world angles.
The trainer replaces .22 local Euler motion with the native world-angle term
converted into its stationary weapon-camera scene; Duel includes damage punch.
108 supplied-state cases / 432 native executions reduce maximum orientation
error 3.29583651° → 0.000014502°. This is isolated recoil orientation, not a full
rendered comparison or correction of the known camera-clock discrepancy.

Current procedural code also contains velocity/air-state bob and smoothed
angle sway. Earlier graph searches did not establish their absence, and the
trainer already contained a 2 mm sine bob. Full bob/sway, crouch/zoom/landing,
projection, clip blending and landmark trajectories remain open. The new probe
retains these boundaries and changes only the evidenced recoil transform
(implementation `5132783`).

Pass 23 validation: TypeScript passes; the full unit suite has 2,327 passes and
only the documented missing fallback-model fixture failure. Both targeted
Chromium cases pass, including actual Range/Duel weapon-root rotations and
Duel damage punch. Native probes and production replay pass all 108 supplied
states. Serial checks used memory/swap/CPU caps; auto-deploy was paused and no
repository edits occurred during the browser run. Logs are retained under
`native-audit/reports/reaudit-viewmodel-*`.

## Airborne weapon motion (twenty-fourth pass, 2026-10-09)

[Pass 24](reaudit-viewmodel-air.md) isolates the native HUD AIR transition:
float32 0.1 per eligible invocation toward 0/2, world vertical −0.4×AIR units
and Source pitch −0.2×AIR degrees. Pitch clamps before physical recoil; original
camera angles remain the inverse/offset basis. Nine native sequences contain
406 frames; the approved new recording independently matches all 944 observed
AIR state transitions. Its video decodes 1,065 frames with maximum 17 ms PTS gap.

Both engines now apply this term in world coordinates. The exact production
transform bench compares 812 engine/frame cases: maximum missing drop falls
20.3200003 mm→0.000000889 mm and orientation error .4000053°→.00001648°.
Native prediction-phase mapping, pause/reset behavior and total rendered
landmarks remain bounded. The existing movement sine and missing-clip kick are
still approximations; this does not certify full bob/sway or animation parity.

Native velocity interpolation and a body orientation distinct from eye angles
prevent a justified whole-bob port yet. Sway capture confirms 1,092 history and
1,106 HUD updates, but phase/caller mapping remains open. No fitted clock or
velocity delay is introduced. The sampler/probes and portable native/live
fixtures are retained for the next audit; R8 remains excluded.

Pass 24 validation: TypeScript passes; 2,338 unit cases pass with only the known
missing fallback-model fixture failure. Both targeted Chromium cases pass,
including 48 AIR frame transitions per engine, world-space placement, recoil
ordering and skipped draws. Serial capped checks ran with auto-deploy paused;
no repository files changed during browser execution.

## Procedural motion inputs (twenty-fifth pass, 2026-10-09)

[Pass 25](reaudit-motion-inputs.md) captures the evaluated velocity caches, scene
orientation and sway clock inputs in the current client. Supplying the selected
velocity cache reproduces captured bob state within native/host trig precision;
raw velocity leaves measurable residuals. The portable numeric fixture and
bounded native replay preserve the comparison. This is native input verification,
not a trainer before/after correction.

Large stationary turns show changing scene yaw with up to35.62460° separation
from aim yaw. Clean evaluated/absolute angles agree, while dirty transitions expose
cache invalidation and refresh. Constant scene yaw in the earlier small-turn
recording did not establish a fixed basis. The scene writer and update law remain
unbound. Sway history/rate and adjacent-frame HUD smoothing replay exactly;
source-angle writer ordering remains unresolved.

The first sequence incorrectly used W/S where the user's movement bindings are
T/G. Its strafing and stationary turns remain valid; forward/back and moving-turn
claims are excluded. Requested frame caps are separate from observed HUD cadence.
Production is unchanged and R8 follow-up remains excluded. Corrected T/G moving
turns are retained separately; all 3,833 native bob comparisons match selected
cache inputs within numerical precision. Validation: TypeScript passes, 2,338
units pass with only the known fallback fixture failure, and both targeted
Chromium cases pass.

## Loaded-shell reload interruption (twenty-sixth pass, 2026-10-09)

[Pass 26](reaudit-shell-reload.md) traces current server class bindings, primary
readiness, action switching and the reload-start attack deadline. Nova,
Sawed-Off and XM1014 may fire a loaded shell after that initial lock while still
reloading; a valid shot switches directly to the shooting action. The .2/.25 s
primary-wrapper literals govern empty-fire retry, not a loaded-shell outro.

The actual Range/Duel bench retains 192 before/after cases. Early held fire
previously occurred at250ms; it now waits until468.75ms for Nova/Sawed-Off and
609.375ms for XM1014. Ready7.8125ms taps previously vanished; they now fire at
the press. There are116 changed first-shot outcomes,44 recovered shots and
zero mismatches across96 paired engine cases. All48 MAG7 controls are unchanged.

The correction applies to reloads that began loaded. Empty-start handling,
intro/insertion/finish durations and later silent-phase behavior retain their
explicit limits. Clip markers and ammo callbacks do not by themselves establish
absolute phase deadlines. The portable proof checks four classes,13 instruction
ranges and45 assertions; no game was launched for this pass.

## Native motion producers (twenty-seventh pass, 2026-10-09)

[Pass 27](reaudit-motion-history.md) binds velocity history to the current
`CInterpolatedVar<CNetworkVelocityVector>` implementation. Private native
execution covers38 bracket cases and six writes: per-ring time offsets,
offset bypass, wraparound, repeated-tick replacement and rewind truncation.
The third consecutive identical-vector write returns false but still records
the new tick. None of these supplied histories activates the three-point path.

The ordinary body-yaw writer is now bound to the movement service's embedded
animation state. It seeds working yaw from the owner pawn's scene angles on
each call, combines source aim with aim punch, dispatches named movement states
and writes that same pawn. Static rules include the70°/69° safety gate,
speed-dependent Move approach and timed stationary turns. The proof binds28
code ranges and schema/type/literal assertions. It does not execute the full
state machine or establish invocation cadence and resets.

Production bob/sway is unchanged. Optional bounded history/body readers extend
the game-only sampler for the next approved capture; they have not been used
live. Ring time-offset producers, prediction ordering, body state clocks/reset
and transform evaluation remain the exact next measurements.

Combined validation: TypeScript passes;2,363 units pass with only the documented
missing fallback-model fixture failure. All four Chromium cases across
trigger-continuity and view-punch pass in53.1seconds. Tests ran serially under
memory/swap/CPU caps, with auto-deploy paused and the repo frozen during browser
execution. No new R8 investigation or behavior change is included.

## Live motion histories and body clocks (twenty-eighth pass, 2026-10-09)

[Pass 28](reaudit-motion-runtime.md) uses the approved AK movement/turn/crouch/
jump capture to replay actual velocity-ring metadata and body state. All 711
samples in the context selecting cache zero match exactly. Eleven apparent
full-window cache mismatches retain a value evaluated one frame earlier while
the ring has changed; their sampled context does not select that cache. This
does not justify fitting a delay or interpolation coefficient.

The isolated native body wrapper/dispatch passes 80 cases and 178 assertions.
All captured Move, Start and airborne yaw projections match exactly. Turn-loop
clock diagnostics remain mixed: raw tick explains some samples and raw tick
plus one explains others. The native caller temporarily supplies controller
tick-base time and later restores globals; last-command publication occurs
after yaw postprocessing. Sampled global time and command numbers therefore
cannot substitute for the writer's active clock or invocation count.

The portable numeric fixture retains 1,614 guarded snapshots without process
addresses. Video has 1,239 decoded frames and no timestamp interval above33ms;
this is recording continuity only. Game/sampler exited zero and owned Steam
stopped. Production bob/sway and body orientation are unchanged pending actual
scoped-clock capture, transition/reset and evaluated-transform comparisons.

## Authored and simulated action clocks (twenty-ninth pass, 2026-10-09)

[Pass 29](reaudit-animation.md#pass-29-action-clocks-evidence-only) compares
AK/AWP/Nova/XM imported clip identity, native graph wiring and actual trainer
action time. All 20 selected clip entries match the current package listing;
older import build labels alone did not prove stale assets. Sixteen fire
samples preserve authored time within 2.78e-17 seconds. Bolt/pump animation
remains part of its native fire clip rather than being compressed to shot cycle.

The trainer maps AK's 2.433333-second reload clip over a 2.466667-second lock:
ammo inserts at 1.100 seconds, while the authored insertion pose arrives
15.069 ms later. Shell phases have larger measured retimes, but native active
phase durations are still unresolved. An injected 250 ms model-loading delay
also compresses draw playback into the remaining deploy time.

These are measured trainer behaviors, not complete native rendered comparisons.
The native reload node has a fixed 1× multiplier, but its current client external
update clock and transition timing are unbound. No production retiming ships
from this pass. The retained probes separate graph constants, imported ranges,
mechanical deadlines and actual trainer animation clocks.

Combined passes28–29 validation: all portable probes and TypeScript pass;
2,363 unit cases pass with only the known missing fallback fixture failure.
Both Chromium view-punch cases pass in27.3seconds. Heavy commands ran serially
under host caps, with deploy paused and edits frozen during browser execution.

## Captured controller clocks and lifecycle (thirtieth pass, 2026-10-09)

The approved `native_reaudit_bob_006` motion window retains 2,589 guarded
snapshots, 1,406 demo ticks and 1,299 video frames with at most 17 ms PTS spacing.
Its optional controller reader is now validated on the live target, but only
one active-controller marker and no active-pawn marker were observed. Numeric
snapshots still have gaps and are not an invocation trace.

Supplying the captured controller seed, without a fitted offset, matches all
372 stationary-turn projections within float32 reconstruction precision,
including 226 unique input/output comparisons. Move 654, Start 25 and air 79 match
exactly. Nine Idle mismatches are four turn-to-idle boundaries; a separate
counterfactual using the preceding observed Loop state matches all nine.
This does not turn sampled post-call state into a consecutive replay.

Current bytes establish constructor initialization and command order:
conditional tick-base increment/store, scoped clock, body postprocessing,
processed-command publication, processing-marker cleanup and clock restoration.
New-instance construction is not a respawn reset policy. A separate registered
transform-history consumer explains the evaluated-local angle path; its
selected record and scheduling still need capture.

All 1,427 selected-cache-zero velocity comparisons are exact. Twenty-one other
cache values match one-frame-earlier evaluations while the selected history
has changed. Full bob/sway remains unchanged pending producer/phase/reset
evidence. [Detailed report and portable probes](reaudit-motion-controller.md).

## First-person graph time and AK reload (thirty-first pass, 2026-10-09)

The current client AG2 worker is now bound through the first-person Arms
callback. Its elapsed-time getter consumes the entity-domain tick, stores it,
clamps negative differences to zero and converts elapsed ticks at 1/64 second.
First initialization contributes one tick; repeated ticks contribute zero.
Forty bounded native cases reproduce this clock with zero error, including
pause accounting. Object lookup is stubbed; domain selection, tick mutation,
clamping and the graph-context delta write execute natively.

AK's ordinary reload path selects an empty entry synchronization ID, with
1× clip nodes and no temporal wrapper. The special outro synchronization ID
and shell-loop conditions do not justify retiming an ordinary AK reload over
its mechanical lock. Exact first-active-sample and transition/render phase
remain unmeasured.

The AK magazine reload now samples authored seconds and holds the clip endpoint
during the final approximately 33.333 ms of its mechanical lock. Actual
`ViewAnimation` event-crossing measurements change the frame-33 pose from
1.1150686147 s to 1.1000000000 s relative to the existing action clock; at the
1.1 s ammo event its clip time changes 1.0851350168→1.1 s. Ammo insertion,
readiness, onset and fade rules are preserved. Other weapon, shell and draw
retimes are not inferred from this correction. [Detailed evidence](reaudit-animation.md).



## Published input and motion histories (thirty-second pass, 2026-10-09)

[Detailed evidence and limits](reaudit-presentation-history.md). This pass
changes probes and documentation only; R8 follow-up remains excluded.

- Two approved AK windows retain 4,861 guarded numeric rows, 2,574 demo ticks
  and 2,406 decoded video frames. Maximum video gaps are 34/33 ms; numeric gaps
  are 110.937/32.314 ms. Game and sampler exit zero; owned Steam stops cleanly.
- All 4,088 input-entry occurrences (2,458 distinct records) match the sampled
  published render/player pairs. Three selected first-press player pairs equal
  their camera anchors. Eight live/demo camera pairs agree exactly after the
  documented carrier conversion and float32 recovery.
- Five held follow-ups preserve the captured burst phase under both cycle-pair
  addition and a conditional native-cache replay. Resolver entry clock and
  exact/interpolated/last/no-history status remain unobserved. The new
  0.139646–0.153806 ms anchor/deadline gaps differ from older recordings;
  ordinary processing still trails deadlines by 1.220696–14.892578 ms.
- Velocity registration/group refresh/typed setter now bind count, offset and
  cache invalidation. Every captured active ring has count one and offset1/64;
  only one ring is enabled, correcting any two-context interpretation of
  prior captures. Other branches and latch scheduling remain partial.
- TransformHistory has its own 96-byte layout and several current-record
  writers. Runtime008 rejects every transform read at an omitted subclass
  gate. Exact inheritance and virtual bindings justify a narrow reader fix;
  those old readouts remain invalid and the fixed reader needs a new live run.
- Retained draw/shell investigation continues under
  `native-audit/reports/animation-draw-shell`: deploy/reload tokens and selected
  graph rates are bound. A candidate immediate graph evaluator forwards a
  separate frame delta, but its concrete receiver/caller remains unbound.
  The pass31 worker clock is one established path, not proof of the sole
  displayed-model clock. Native action onset and shell deadlines remain open.

Tools: `reaudit-frame-history-{proof,capture-fields,report}.py`,
`reaudit-held-anchor-replay.py`, `reaudit-velocity-offset-{proof,capture-fields}.py`
and `reaudit-transform-history-{static,capture-fields}.py`. Portable numeric
fixtures and summaries are under `docs/evidence`; raw locations stay in tools
and local audit artifacts. Full inventory remains 135 rows and incomplete.

Validation: native, synthetic decoder and portable replay checks pass; final
probe/fixture hashes agree. TypeScript passes; full units have 2,367 passes and
only the known missing fallback-model fixture failure. Both Chromium camera
cases pass in 27.1 seconds. Runs were serialized under host caps, with deploy
paused and repository files frozen during browser execution.

## Thirty-third pass: authored draw rate and accepted transform histories

[Detailed report](reaudit-draw-and-transform.md). Ordinary AK/AWP/Nova/XM draw
playback now keeps authored elapsed seconds after late model attachment. The
current immediate Arms caller passes unscaled frame delta under explicit mode/
selector gates; 72 instruction checks, two classes and three virtual targets
bind the path. Four native graphs contain 16 unit-rate draw nodes. A 250 ms
attachment delay changes AK/Nova/XM 1.333333×→1× and AWP 1.245901×→1×. Existing
onset, lifetime, fades and gameplay deadlines are retained; those lifetime and
first-display choices remain independent fidelity limits.

The identical portable before/after probe runs exact historical/current source:
724 lifetime/weight samples agree, with 576 unchanged equipment/pickup controls,
48 interruption controls and 16 pauses. No other action clock is changed.

Approved runtime009 validates 2,602 transform snapshots beside 1,408 AK demo ticks
and 1,325 video frames (maximum video gap 34 ms, numeric gap 109.194113 ms).
Seven-entry histories and selected local records are retained in a 1.87 MB
portable fixture; all rehydrated rows equal raw numeric data. Shared current
records usually differ from complete ring values, so invocation arguments and
writer provenance remain necessary. Runtime008's rejected reads stay invalid.

Retained runtime008 input metadata proves one-entry reduction bypass for all
three selected presses. Current-server held-clock evidence adds a typed deadline
producer and scoped active-weapon callback for ordinary interior deadlines.
Final command presence and live resolver branch/cache remain unobserved; camera
sample and anchor clocks remain separate. R8 follow-up is excluded.

Validation: native/graph/portable probes and TypeScript pass. Full units have
2,373 passes and only the known missing fallback-model fixture failure. Both
Chromium draw cases pass in 15.1 seconds, verifying actual-engine clip time,
hand pose, idle return and preserved ammo/readiness; both existing camera cases
also pass. The initial draw pose check measured fixed bone-local translation;
correcting it to world position required no production change. All heavy jobs
ran serially under host caps with deploy paused and repository edits frozen
during browser runs. Logs use `reaudit-draw-transform-` locally.

## Passes 30–31 integration validation

TypeScript passes. The full unit suite has 2,367 passes and only the documented
missing `public/models/ak47.json` fallback fixture failure. Both Chromium
camera/viewmodel cases pass. The actual Duel reload case verifies authored
seconds, endpoint hold during the lock, held-work continuity, return to idle
and nonoverlapping HUD controls at three viewport sizes. Its initial run
passed the animation assertions and exposed a stale four-group HUD count;
`DuelStage` contains three groups. The corrected test passes in 9.3 seconds.
Production UI behavior was not changed to accommodate the test.

Native/graph/fixture probes pass, and current source/fixture/probe hashes are
consistent. Heavy jobs ran serially under memory/swap/CPU caps with deploy
paused and all repository edits frozen during browser runs. Logs use the local
`reaudit-controller-ak-{typescript,unit,browser,browser-reload}` prefix.

## Re-audit delivery validation

Implementation commits: movement `79832e6`, scheduled recoil `e85f59a`, R8 graph
composition `9b94483`, accuracy/index `fd328d5`, ordinary footsteps `2aba70c`,
weapon recoil rotation `5132783`, airborne weapon motion `4e999d9`,
loaded-shell reload interruption `9095bb0`, AK reload playback `7597b1c`.
The [consolidated inventory](cs2-reaudit.md) retains one row per audited mechanic
with rule/evidence, before/after, status and commit, plus corrected claims and
exact unresolved measurements. Further R8 work is excluded at the user's request.

Passes 20–21 combined validation passed TypeScript and 2,325 unit cases. The only unit
failure is the documented missing `public/models/ak47.json` fallback fixture.
All five Chromium cases across input-timing, trigger-continuity and view-punch
pass, using one worker, memory/swap/CPU caps and a repository freeze. Auto-deploy
was paused for that browser run. Logs are retained as
`../native-audit/reports/reaudit-followup-final-{typescript,unit,browser}.log`.
The previous animation delivery retains four paired strips (77 frames, no
browser errors); no new native-rendering parity is inferred from them.

Production accuracy replay matches 39,648 bounded current-server invocations
and 41,584 accepted demo ticks /160shots, within the documented landing-speed
precision. Both actual engines match the ordinary native footstep timer for
AK/AWP/knife. Special-state accuracy, footstep delivery/loudness and the wider
presentation/animation inventory remain incomplete.

All three follow-up commits are batched into one push. After the deploy service
finishes, `tools/verify-accuracy-release.mjs <short-commit>` verifies the LAN
release header, served AK model/audio hashes, pointer lock and firing/reload.
It writes `../native-audit/reports/reaudit-accuracy-live-release.{json,png}`;
CLAUDE.md and memory retain the resulting release and worktree state.

## Common-weapon reload input (thirty-fourth pass)

The user's narrowed scope prioritizes movement and AK/M4/AWP/common-pistol
behavior. Shotguns, revolvers and less-used weapons are deferred; their unfinished
follow-up is preserved locally. [The reload report](reaudit-common-reload.md)
binds seven current-server weapon classes to the same input dispatcher with
102 instruction and 63 virtual-slot checks. Explicit reload requires the primary
firing deadline to have elapsed; eligible attack inputs take priority.

Both actual trainer engines previously accepted every tested R request 31.25 ms
after firing, including the AWP with 1.455 s of configured cycle. They now drop a
released early R tap and retry a held R with the same readiness/priority rules.
In the fixed 128 Hz bench, held AWP reload begins 1.4609375 s after the shot instead
of .03125 s; direct deadline inputs also pass. All 56 paired cases agree: 14 early taps,
14 held retries and 28 unchanged ready controls. These are trainer sample times,
not a claim about the native scheduler's exact reload-start tick.

Earlier trigger-continuity fixtures forced a manual reload while primary was
held immediately after a shot. That did not establish native reload admission.
Those fixtures now use legal manual/automatic reload starts while preserving
held-fire continuity coverage. Independent player/deploy gates and within-command
press/release mask lifetime remain unverified; other weapon families are unchanged.

## Crouch stance and accuracy (thirty-fifth pass)

[The crouch report](reaudit-duck-accuracy.md) rejects the engines' former
`duckAmount >= .95` stance choice. Five retained native transition samples
contradict it: accuracy uses a separate pawn flag, set at completed crouch and
retained on successful ground unduck until amount <= .75. Current-byte evidence
binds the flag's writers and the baseline/recovery readers. The movement service's
transient `m_bDucked` is also not a substitute.

The shared motor now carries that state, and Range/Duel active and holstered
recovery consume it. Across 168 supplied native stance/accuracy cases, 120 wrong
stance selections and 120 penalty mismatches fall to zero; maximum penalty error
0.0100954175 falls to zero. Nineteen focused regressions cover captured flag paths,
threshold history, both engines and standing pose resets. Earlier accuracy
arithmetic/replay results supplied stance externally and therefore did not
validate this engine conversion. Partial crouch under a blocking ceiling,
fatigue command boundaries and exact input-to-shot timing remain separate limits.

## Common rifle and pistol draw clocks (thirty-sixth pass)

[The draw report](reaudit-common-draw.md) extends the independently checked
ordinary graph path to M4A4, M4A1-S, Glock, USP-S and Desert Eagle. Six current
resource graphs expose 24 unit-rate nodes, with matching draw CRC/size and actual
imported clip durations. With 250 ms late model attachment, the actual controller
previously ran M4 draws at 1.283019343× and pistol draws at 1.333333333×; all now use 1×.

The 1,086-row comparison preserves all action lifetimes/weights, 901 unaffected
controls, 72 interruptions and 24 pause checks. AWP is an unchanged control. This
corrects relative playback rate; action onset, readiness/fade routing and pickup
remain separately bounded. The current Deagle reload resource differs from its
import manifest; no reload asset or timing was changed on the strength of draw
provenance. The draw report retains that exact limit.

## Validation retained from passes 11–15

All three targeted Chromium specs pass: `input-timing`, `trigger-continuity`
and `view-punch` (five cases total). They enter through the real menu and
pointer-lock path. The controlled response harness times DOM pointer dispatch,
the simulated shot and the first renderer submission on the next real rAF.
`../native-audit/reports/feel-response/{duel,guided}.json` retains the samples.
These are CPU/browser observations on the local software-rendered host, not
GPU completion, monitor presentation or physical mouse-to-photon latency.
Separate browser round trips for press/release can become a held spray while
software rendering blocks; the tap test therefore dispatches them as one click.
No production latency constant was tuned from these measurements.

Native arithmetic totals: 66 movement, 62 readiness/windup and 42 crosshair
samples; fresh data checks: 2,730 weapon and 108 tagging values. The full unit
suite passes except the documented missing `public/models/ak47.json` fallback.
TypeScript passes. Every Node check used MemoryMax=8G/MemorySwapMax=0; browser
checks additionally used CPUQuota=400%, one worker and no concurrent repo edits.
Those earlier passes launched no new CS2 process. Approval subsequently arrived;
the independent re-audit above includes approved fresh recordings.

## Remaining limits

Native aim-punch fields in this build describe decay anchors, not the current
camera recoil angle. They cannot be fitted directly to video as instantaneous
punch values. The native camera multiplies the doubled punch returned by its
sampler by 0.45, confirming the existing camera fraction. Camera kick now has
native arithmetic and demo-anchor evidence, plus a limited spray-video check.
Full camera and weapon-model trajectories remain partly verified; the weapon
fraction and coordinate conversion are corrected in pass 23; other procedural motion
and complete rendered trajectories remain open.
Native hitboxes now follow the imported animation in the rendered Duel modes.
Full native animation reconstruction and the range's mesh-height hitgroup
classification remain separate work; neither recording a 60 Hz video nor decoding a
64 Hz demo establishes mouse-to-photon latency or exact Source 2 equivalence.

The resource audit also retains unverified ladder inaccuracy and Negev
firing-movement modifier behavior. Native command/subtick seed derivation,
full viewmodel animation and physical input delivery still require separate
comparisons; the verified components above do not establish complete parity.

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

### Added CPU work

A bounded Node 22 check on this Ryzen 5 7640HS host measured the added
capsule-capture stage at approximately 0.0042 ms for three actors and 0.0246 ms
for sixteen actors (median of 40 blocks of 250 captures after warm-up). Each
actor kept exactly two pose buffers. Player recoil prediction plus camera-kick
sampling measured 0.0028 ms by the same method. These isolated CPU timings
exclude animation, simulation, rendering and browser/OS scheduling; they do
not establish frame rate or physical input latency on this host or the user's
Windows machine. Raw measurements remain in
`../native-audit/reports/fidelity-cpu-cost.json`.

### Final damage-camera validation

- Twelve additional bounded native camera compositions pass; the browser
  confirms pitch, yaw and roll use the native scale while shot angles retain
  their physical values.
- Final full suite: 2,089 pass; the one failure still requires the pre-existing
  missing `public/models/ak47.json` fallback asset. Production build passes.
- Both Chromium camera checks pass after the correction. A fresh-profile visit
  to the built LAN preview loads aim_redline and fires through the UI without
  page errors or failed asset requests.
