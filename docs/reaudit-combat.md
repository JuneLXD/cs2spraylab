# Combat re-audit, 2026-10-09

Baseline: `c488943`. This pass reparsed original demos, freshly exported current
weapon data and SAS model blocks, and refreshed the server accuracy/spread and
penetration decompiles before comparing earlier documentation. The installed
client is SHA-256 `eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1`;
server `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The two new AK demos were recorded from this install after the host reboot.

The concrete correction is scheduled recoil: a held shot is processed on a
64 Hz tick, while its recoil impulse belongs to its exact scheduled command
time. The live engines previously used the processing time for both. The
existing idealized recoil tests called the recovery model at exact 100 ms
intervals and therefore did not catch the live scheduling error.

Fresh six-shot and eight-shot AK replays now compare the rendered punch at each
processing tick with native anchors sampled to that same time:

| Capture | Before maximum aim-punch error | After maximum error |
| --- | ---: | ---: |
| `native_reaudit_recovery_001.dem`, held shots, ticks 461–493 | 0.235337° | 0.00000215° |
| `native_reaudit_shooting_001.dem`, held shots, ticks 556–601 | 0.338199° | 0.00000239° |

`WeaponRecovery.fire(processingDelay)` now samples carried angle and velocity
at the scheduled time, anchors the impulse there, then samples its state at the
processing time for rendering. Both engines sample bullet recoil at the same
schedule, and next-shot guides use that schedule too. `lastShot` also retains
that schedule. The correction leaves shot event ticks and cadence unchanged.
The native fixture contains the fresh six-shot burst; both the direct recovery
test and the actual `DuelWeaponState` path are checked against it.

## Evidence and reproduction

The portable summary is [reaudit-combat-summary.json](evidence/reaudit-combat-summary.json).
It includes all 35 weapon timing/control rows, primary and alternate bench
schedules, reload phase events, spread distributions, native source hashes,
and before/after recoil errors. Full per-tick and all-weapon accuracy/damage
grids remain under `../native-audit/reports/reaudit-combat/`.

Tools retained in the repository:

- `tools/reaudit-combat-native.py`: parse original demos, retain original SHA-256,
  omit player identity, and optionally regenerate the native recoil fixture.
- `tools/reaudit-combat.mjs`: compare freshly exported vdata with runtime stats;
  exercise the actual weapon state, reload state, accuracy, spread, damage and
  penetration implementations; compare native rows and live recoil replays.
- `tools/reaudit-combat-hitboxes.mjs`: compare fresh native capsule bind
  transforms against the target and six shipped agents without replacing the
  older provenance fixture.

From the repository, export `scripts/weapons.vdata_c` from the installed
`pak01_dir.vpk` with Source2Viewer into
`../native-audit/reports/reaudit-combat/weapons.vdata`. Export the SAS model's
`MDAT` blocks into `sas-mdat.txt` in the same directory. Then run:

```sh
python3 tools/reaudit-combat-native.py --write-recoil-fixture
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 node tools/reaudit-combat.mjs ../native-audit/reports/reaudit-combat/trainer-current.json
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 node tools/reaudit-combat-hitboxes.mjs ../native-audit/reports/reaudit-combat/sas-mdat.txt
PYTHONPATH=../native-audit/python python3 tools/verify-native-fire-readiness.py ../cs2-game/game/csgo/bin/linuxsteamrt64/libserver.so
```

The bench's first positional argument is its output file. Preserve the original
`trainer-before.json`; later output files automatically compare against it.
The initial baseline report measured both parameter sets but its alternate
action-grid setup attempted a transition before time zero. The corrected
current probe activates each alternate action at time zero; do not read the
old action grid as proof of burst/scoped mode behavior.

Fresh static evidence is retained in `../native-audit/rea/out/`:
`reaudit-combat-accuracy-update.c`, `reaudit-combat-accuracy-recovery.c`,
`reaudit-combat-inaccuracy.c`, `reaudit-combat-spread-sample.c`, and
`reaudit-combat-penetration.c`. These are recovered pseudocode, not execution
traces. The server session binding was retained before reboot in
`reaudit-movement-session.json`. The ordinary-primary/R8 readiness arithmetic
was separately rerun as bounded emulation of the current hash-pinned server:
20 windup and 42 comparison cases passed.

## Inventory

“Matched” below is restricted to the named data/branch/capture. “Approximated”
means the implemented behavior has a known boundary or measured discrepancy.
“Unverified” means this pass did not establish the native behavior, even when
an earlier report asserted it. No combat row claims that a static resource
comparison verifies the whole running game.

| Mechanic | Native rule / primary evidence | Trainer before → after | Status | Implementation commit |
| --- | --- | --- | --- |---|
| Per-weapon primary/alternate stats | Current `scripts/weapons.vdata_c`, 35 weapons, 2,730 scalar/array/control comparisons | 0 differences → 0 differences | Matched data | `c488943` |
| Weapon speed and tagging parameters | Same export; 108 large/small/held-speed values across 36 definitions | 0 differences → 0 differences | Matched data | `c488943` |
| Ready first press | Primary tick/ratio comparator accepts command time at or after deadline; emulated current server | Immediate simulated ready press, unchanged | Matched comparator; physical latency unverified | `c488943` |
| Held automatic cadence | Fresh AK burst anchors advance by 0.1000000015 s; emitted shot ticks alternate 6/7 | Same tick schedule before/after | Matched AK capture; remaining weapons' cycles matched as data | `c488943` |
| Released early tap | Fresh shooting capture's X11 timestamps differ from intended timing, and serialized FIRE is stale during part of the capture | Released pending tap is dropped, unchanged | Unverified exact native edge schedule | `c488943` |
| Early held tap | Fresh AK second sequence fires at original 100 ms due time | Queued held shot uses original schedule, unchanged | Matched captured behavior; exact subframe edge still unverified | `c488943` |
| Held through reload | Fresh AK reload starts at tick 398, next held shot tick 556, scheduled 584.6073 s; vdata lock 2.466667 s | Preserves held trigger and locks until deadline, unchanged | Matched captured trigger continuity | `c488943` |
| Held through deploy | Fresh AK deploy tick 891; first held shot tick 955, one second later | One-second AK deploy lock, unchanged | Matched captured continuity | `c488943` |
| Deploy times, all weapons | Current vdata deploy duration | All values equal; unchanged | Matched data; per-weapon live gate unverified | `c488943` |
| Glock/FAMAS bursts | Current vdata burst flag/cycle/interval; current action bench exercises mode transition and emissions | Three-round autonomous burst model; unchanged | Matched data, native burst execution unverified | `c488943` |
| R8 primary windup | Current server bounded initialization preserves command fraction and adds 13 ticks | 203.125 ms, unchanged; 20 native emulation cases pass | Matched arithmetic; complete charge/animation chain unverified | `c488943` |
| R8 alternate fire | Current alternate stats; fresh server spread sampler uses `1-r²` | Same alternate cycle/distribution, unchanged | Matched data/distribution branch; native trigger schedule unverified | `c488943` |
| Reload lock and insertion | Current vdata lock; imported clip insert events; fresh AK capture | Separate insert and attack deadline; unchanged | Matched exported lock, animation event coverage in animation audit | `c488943` |
| Silent reload | Native gated clock was not independently emulated in this pass | Per-phase windows and half-speed held clock; AK measured lock 4.172391 s; unchanged | Unverified current whole runtime path | `c488943` |
| Shell loading/interruption | Current data identifies Nova/XM1014/Sawed-Off single shells; MAG-7 uses magazine | Start 0.5 s, finish 0.2 s estimates; Nova first shell at 0.966667 s, empty completion 4.433336 s; unchanged | Approximated; native phase deadlines still needed | `c488943` |
| Recoil pattern seed/parameters | Current vdata seeds/angles/magnitudes; fresh AK native impulse anchors | Parameters identical, AK six-shot impulses verified; unchanged table generator | Matched data and AK sample; current all-weapon table emulation unverified | `c488943` |
| Recoil suppression/smoothing | AK first six native impulse anchors reproduce trainer table; historical Windows table fixture is another artifact | Four-shot suppression and automatic smoothing retained | Matched AK sample; broad native rule still partial | `c488943` |
| Aim-punch decay and velocity decay | Fresh native anchor-to-anchor carry in both captures, `PunchRecovery` comparison | Native carry error ≤0.000000478°; unchanged decay math | Matched sampled current native trajectories | `c488943` |
| Recoil time anchor in actual engines | Fresh AK native anchors use exact command schedule | Maximum sampled live error 0.338199° → 0.00000239° | Matched sampled trajectory after fix | `e85f59a` |
| Between-spray recovery | Fresh isolated shots after two-second rest reset native angle to zero | Same zero angle after long rest; retained velocity/index model | Matched long-rest sample; short-pause index timing approximated | `c488943` |
| Aim punch versus camera-only punch | Native aim-punch anchors available; separate view-punch field needs its own renderer comparison | Bullet punch ×2, camera view-punch separate; scheduling fix applies aim punch | Partially matched; presentation audit owns camera composition | `c488943` |
| Recoil-follow settings | Client setting lookup and frame presentation handled in response audit | No combat settings change | See response audit | `c488943` |
| Stand/crouch/air baseline | Fresh server accuracy-update selects native stand, duck flag, or stand+jump×air scale; current runtime air scale 1 | Same formulas and data; unchanged | Matched static branch; stance transition timing partial | `c488943` |
| Running/walking velocity mapping | Fresh GetInaccuracy remaps 34–95% mode speed; run quarter-power, walk linear | Bench samples 0/.34/.52/.75/.95/1; same results | Matched arithmetic structure | `c488943` |
| Jump/fall/landing accuracy | Fresh GetInaccuracy uses square-root vertical-speed interpolation; landing hook evidence retained from earlier pass | Same jump curve and linear landing addition; unchanged | Jump structure matched; fresh landing hook/runtime recovery unverified | `c488943` |
| Fire accuracy and tick order | Fresh recovery demo all eight shots fit add-fire-then-full-tick decay within 1.23e-9; exact-boundary shots in shooting capture retain the full increment until next tick | Existing continuous advance-then-fire is up to 0.000726484 high on AK shot ticks; unchanged | Approximated, measured remaining discrepancy | `c488943` |
| Recoil-index decay | Fresh first decay multiplies by 10^(-2/64); server update uses complete tick after strict readiness threshold | Continuous partial-threshold decay; one-step differences +0.015401/+0.054248/+0.060028 in fresh recovery capture | Approximated; remaining tick-order work | `c488943` |
| Reload accuracy penalty | Current vdata `m_flInaccuracyReload` is zero for all 35 weapons; native update contains reload addition | No separate reload penalty, unchanged | Matched current zero data; nonzero custom value unsupported | `c488943` |
| Ladder / stacked-player accuracy | Native baseline has ladder and stacking branches; current trainer lacks those accuracy inputs | No ladder/boost accuracy state | Not present | `c488943` |
| Recovery curves and transition index | Current vdata stand/crouch/final/bullet-transition fields; fresh non-shot stationary decay agrees to numerical noise outside resets | Exponential excess decay and integer index transition, unchanged | Matched captured ordinary decay; full air/duck transitions unverified | `c488943` |
| Scope / zoom-level inaccuracy | Current mode arrays and zoom FOV/time lists; each current zoom state bench uses alternate stats | Every zoom level uses its weapon alternate baseline, unchanged | Matched data/application; all live zoom timing unverified | `c488943` |
| First-shot spread distribution | Fresh server sampler draws uniform radius, angle, radius, angle | 100k draws mean radius 0.500794, squared radius 0.333824 | Matched structural distribution; command seed and native trig parity unverified | `c488943` |
| R8/Negev distribution shape | Fresh native radius branches; R8 `1-r²`, Negev early repeated squaring | Means 0.666176; Negev indices 0/1/2/3: 0.888933/0.799892/0.666176/0.500794 | Matched sampled transformed distribution | `c488943` |
| Shotgun pellet spread | Fresh shared bullet routine redraws inaccuracy per pellet with patterns; shares it without patterns; current session patterns enabled | Same branch structure and 64-entry pattern lookup | Matched structure; current RNG table bytes and command seeds unverified | `c488943` |
| Damage base/range | Current vdata damage/range/rangeModifier/armor ratio/head multiplier | Zero data differences; AK chest 36 at zero range, 35 at 500 units | Matched data; native damage execution remains unverified | `c488943` |
| Armor/helmet/hitgroup/integer loss | No controlled new native victim-damage fixture in this pass | AK chest Kevlar 27 health/4 armor; helmet head 111/16; leg ignores armor; unchanged | Approximated; native arithmetic/truncation not independently confirmed | `c488943` |
| Penetration ordinary material branch | Fresh native per-surface routine uses squared thickness/24, inverse modifier, damage loss, `(3/power)×1.25×3`; thin glass/grate 3/.05 | Same ordinary arithmetic; all eight material grids measured, unchanged | Matched structure; material/trace approximation remains | `c488943` |
| Penetration special flags / mixed surfaces | Native includes special surface-flag cases and minima across multiple intersected materials | Axis-aligned/convex trainer solids and limited material groups | Approximated; flag branch not represented | `c488943` |
| Ricochet | No native ricochet rule established by this pass | No outgoing ricochet trajectory | Not present; native applicability unverified | `c488943` |
| Tagging slow/recovery | Current 108 exported parameters match; no fresh hit/velocity capture | AK-held modifier .265846 after one AK hit; second .218235; .418235 after 0.5 s grounded | Matched data; current native state formula/recovery unverified | `c488943` |
| Zeus | Current damage/range data, 30-second configured recharge claim retained | 500 base generic falloff, no hitgroup/armor consumption, range cap; unchanged | Approximated native distance curve; recharge execution unverified | `c488943` |
| Knife | Current tagging/speed export; no native slash/stab/backstab fixture | Source-family ranges 48/32 units, first slash 40, slash25, stab65, backstab180 | Approximated; exact native traces/cone/cooldowns unverified | `c488943` |
| Native capsule definitions | Fresh SAS `MDAT`, 19 capsule endpoints/radii/groups exactly equal retained definitions | Identical before/after | Matched resource geometry | `c488943` |
| Capsule bind-space mapping | Fresh inverse bind matrices compared against target + six agents | Maximum position difference 0.021567 mm; unchanged | Matched sampled exports | `c488943` |
| Posed skeleton/hitbox alignment | Separate fresh native/shipped clip audit, 94 frames across six motions | Maximum capsule endpoint discrepancy 0.230 mm | Matched sampled clip transforms; runtime animation graph approximated | `c488943` |
| Head/neck/body boundaries | Native head radius 4.3 units and neck3.5; neck native group8, separate head capsule | Same capsules; neck mapped to chest effects/armor | Geometry matched; current native group8 damage branch not independently rederived | `c488943` |
| Render-pose versus server-pose time | Trainer captures displayed bone capsules; native authoritative server pose is not recorded here | Displayed pose tracing with fallback analytic zones | Approximated; native server-pose trace comparison absent | `c488943` |

## Earlier claims corrected or not reproduced

1. Tenth-pass “M4A1-S advances by exactly 0.09 s” is incorrectly attributed.
   `native_phase3_m4a1s_001.dem` contains M4A4 entity labels and `weapon_m4a1`
   events, not M4A1-S. Current vdata gives M4A4 0.09 s, M4A1-S 0.1 s.
2. Correct idealized recoil arithmetic did not establish correct live-engine
   scheduling. The old native anchor test explicitly advanced by the exact
   native shot intervals; it bypassed the 64 Hz processing delay. The fresh
   actual-weapon test exposed and now pins the corrected path.
3. “Accuracy already matches” needs a tick-order qualification. Snap-up and
   exponential formulas agree; continuous partial-tick recovery does not
   reproduce the native shot-tick snapshot or first recoil-index decay.
   Exact-boundary and fractional scheduled shots differ, so multiplying every
   fire impulse by a constant decay factor would introduce another error.
4. A fixture called “installed native” may belong to a different artifact.
   Existing all-weapon table emulation pins Windows DLLs; the older Linux
   punch-emulation script pins a previous client hash. Neither was relabeled as
   current or rerun after bypassing its hash guard. Fresh demos independently
   confirm the sampled current AK arithmetic only.
5. The existing hitbox verifier's whole-report equality fails after a fresh
   export because provenance changes. Its numerical geometry checks pass;
   this audit retains both dump hashes and compares capsule geometry directly.
6. The new early-tap capture does not conclusively establish native release
   semantics. The first press call itself occupied 49.6 ms; planned 25 ms hold
   became a 74.8 ms call-to-call interval. Also, FIRE is false in serialized
   rows throughout part of a visibly firing held spray. X11 edges and these
   serialized aliases cannot substitute for native subtick input edges.
7. Earlier displayed-damage examples are not a primary executable damage
   fixture. The integer truncation policy is retained as an approximation until
   controlled native health/armor deltas establish it.

## Data still required

- Accuracy/index: integrate native command-time shot ordering with one complete
  64 Hz accuracy update, including exact-boundary shots, air/duck baselines,
  reload index increment/reset and mode changes. The new native per-tick rows
  are sufficient for an isolated AK implementation; broad shipping needs the
  same rule in both engines and a stance/mode matrix. This pass records the
  mismatch rather than shipping a correction that only fits fractional shots.
- Early tap: a capture with native per-command subtick button edges, the due
  tick/ratio, and weapon-fire events; repeat released-before-ready and
  held-until-ready for a semi-auto and an automatic weapon.
- Burst/R8/shell: native demos of both burst weapons, R8 primary/secondary and
  released windup, plus empty and partial Nova/XM1014/Sawed-Off reloads with
  interruptions immediately before/after insertion.
- All-weapon recoil: current Linux table generator/RNG emulation with newly
  established function boundaries, or controlled current native sprays for
  every primary/alternate mode. Keep native command seed derivation separate.
- Damage/tagging: fixed-distance controlled victim health and armor snapshots
  for each hit group, helmet/low-armor cases and shotgun sequential pellets;
  velocity-modifier/stack rows during repeated hits and airborne recovery.
- Penetration: current extracted surface inheritance, native entry/exit trace
  records for material pairs, and the exact meaning of the special flags.
  Ricochet requires evidence of an actual outgoing reflected trajectory.
- Zeus/knife: controlled native distance and hit/miss/back-angle sweeps, fresh
  cooldown events, and recharge deadline observations.
- Posed hitboxes: native server bone matrices and hit traces at the same times
  as drawn standing/walking/crouching/jumping/dying frames. Clip-space agreement
  alone cannot establish client/server timing equivalence.

Validation for the source correction: 152 tests passed across the new native
recoil tests, punch recovery, ballistics/guides, weapon state, and range weapon
actions. Broader repository validation and deployment are recorded in the
main audit pass.

Independent review also covered the gap between a scheduled shot and its processing tick. At AK time0.3046875s with due0.3s, the old guide used current-time punch; its next prediction2.88730812° differed from actual2.90107775°. The corrected guide samples the carried scheduled state. Regression cases at simulation steps13 and39 cover both next predictions.

Camera-only ViewPunch is a separate unresolved boundary: native anchor intervals are100ms, but moving the existing exponential sampler to those schedules still leaves0.0204° mismatch in the six-shot recording. A schedule-only edit would not establish parity; the native clock and decay sampling must be reconciled first. Reports are retained as `reaudit-combat/viewpunch-boundary-review.json` and `guide-boundary-review.json`.

The follow-up [accuracy/index bench](reaudit-accuracy.md) now carries candidate
state across 40,408 accepted native ticks and matches 39,648 bounded server
invocations. It supplies the next integration plan; the production discrepancy
rows above remain accurate until that separate correction is implemented.
