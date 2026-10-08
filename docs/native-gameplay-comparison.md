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
  `m_flFOVRate = 0.1`. The trainer currently changes FOV instantly. The
  transition curve and sensitivity during that transition remain unverified.
- Native console confirms sensitivity 1, zoom sensitivity ratio 1 and
  yaw/pitch scales 0.022. Physical mouse-count delivery remains a separate
  check on the user's Chrome setup.

## Remaining limits

Native aim-punch fields in this build describe decay anchors, not the current
camera recoil angle. They cannot be fitted directly to video as instantaneous
punch values. The trainer's camera/viewmodel fractions remain estimates.
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
