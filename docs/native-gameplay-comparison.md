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

## Remaining limits

Native aim-punch fields in this build describe decay anchors, not the current
camera recoil angle. They cannot be fitted directly to video as instantaneous
punch values. The native camera multiplies the doubled punch returned by its
sampler by 0.45, confirming the existing camera fraction; complete recovery
trajectories still need a video comparison. The weapon fraction remains an
estimate.
The extracted native hitboxes still need bone-transform and trace validation
before replacing analytic runtime hit shapes. The retained recordings provide
references for that work; neither recording a 60 Hz video nor decoding a
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
