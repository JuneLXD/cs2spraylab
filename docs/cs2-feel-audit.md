# CS2 feel audit — October 9, 2026

Baseline `8980fd7`. Five evidence-backed changes continue the previous ten
verification passes. No live CS2 session was launched; the prepared recording
plan awaits the requested permission. Detailed rules and boundaries are in
[passes 11–15](native-gameplay-comparison.md#movement-integration-order-eleventh-pass-2026-10-09).

## Before and after

Distances below are Source units; one integration step is 7.8125 ms. “Matched”
applies to the specified arithmetic or data, not complete Source 2 equivalence.

| Mechanic | Game rule and evidence | Trainer before | Trainer after | Status | Commit |
| --- | --- | --- | --- | --- | --- |
| Ground starts/stops | WalkMove uses midpoint velocity for displacement; native pre/post helpers, 12 emulated cases | First AK start step 0.072174 u | 0.036087 u; final speed unchanged | Matched, bounded arithmetic | `bd6de30` |
| Walk/stance transition | Cap final speed before computing midpoint displacement; same server path | Full-speed→walk step 1.611450 u | 1.276563 u, ending at 111.8 u/s | Matched, bounded arithmetic | `bd6de30` |
| Air acceleration | At most half uncapped acceleration budget before movement, remainder after; 54 native cases | First AK air-strafe step 0.157471 u | 0.078735 u; final 20.15625 u/s unchanged | Matched, bounded arithmetic | `bd6de30` |
| Bunnyhop restoration | Modern jump restores prior landing momentum only above weapon cap, before new air gain; native control flow | Prior 100/215 u/s landing restored despite current 50 u/s; new air gain overwritten | Remains 50 u/s; above-cap landing restores to 236.5 u/s AK limit, then gains air acceleration | Matched, static rule | `bd6de30` |
| Counter-strafe / release accuracy | Correctly aligned demo position intervals cross 34% at 78.125 / 203.125 ms | Same trainer times; comparison appeared 15.625 ms slow due to parser lag | Same times, corrected evidence alignment | Matched at sampled-interval resolution | `bd6de30` |
| Held fire through reload/deploy | Item dispatcher retries held current-command input when primary readiness succeeds; native call-chain ledger | Five transition cases dropped fire | All five resume; AK reload readiness 2.466667 s → shot 2.468750 s; released tap stays dropped | Matched held-input rule; precise new native schedule unverified | `ecea7bb` |
| R8 windup | Native initializer adds 13 ticks and preserves command fraction; 62 native deadline/readiness cases | Estimated 200 ms | 203.125 ms in both engines | Matched deadline arithmetic | `70cb9a0` |
| Follow-recoil direction | Client samples predictable weapon punch at presentation time; 12 native direction cases | Previous simulation sample, plus damage in Duel target | Current displayed recoil; damage remains in camera projection | Matched bounded composition | `738912f` |
| Follow-recoil pixels | Client ceilings coordinates with per-axis 1 px deadband; 30 native pixel cases | Fractional placement, up to 4.011 px stale-sample error in 240 Hz AK probe | No sample-age mismatch; native pixel conversion in CSS viewport | Matched arithmetic; framebuffer/DPR parity unverified | `738912f` |
| AUG reload lock / insertion | Current weapons.vdata: 3.2 s; current reload clip: frame 42/30 | 3.766667 / 1.566667 s | 3.2 / 1.4 s | Matched exported data | `c21158e` |
| AUG animation / sounds | Same current native clip; 97 samples, cue frames 15/40/42/62/67 | Old animation and cue timeline | Both viewmodel variants rebuilt; insertion sound at 1.4 s; attachment error ≤1.20e-7 | Matched authored clip data; runtime IK remains approximated | `c21158e` |
| Weapon parameters | Fresh primary/alternate export, all 35 weapons; 2,730 values plus 108 tagging values | Two AUG reload values stale; all others equal | All compared values equal; old independent audit provenance preserved | Matched data, not every engine branch | `c21158e` |

The release/counter-strafe comparison remains bounded by 15.625 ms position
intervals and sampled button edges. Release-to-rest is 375 ms in the native
interval table versus 382.8125 ms in the trainer, within half a native tick.
No friction/acceleration tuning is justified by that difference.

## Perceived response

The repaired headless harness uses actual menu entry, pointer lock, DOM input,
simulation and the first renderer submission on a real rAF. A recorded run on
this software-rendered host measured:

| Mode | Handler to simulated shot | Handler to render start | Handler to render submission |
| --- | ---: | ---: | ---: |
| Duel | 0.8 ms | 5.2 ms | 18.9 ms |
| Range | 0.8 ms | 11.6 ms | 44.3 ms |

These are single-run CPU observations, not percentiles, GPU completion,
compositor delay, physical mouse-to-photon latency or the user's PC performance.
There is no comparable before run from the previously broken UI fixture, and
no production latency tuning is attributed to these numbers. The unchanged
input path passes between-frame movement and no-future-time-debt assertions.
Raw samples: `../native-audit/reports/feel-response/{duel,guided}.json`.

## Remaining evidence needs

| Area | Current status | Exact data needed |
| --- | --- | --- |
| Viewmodel recoil share / tracking | Estimated 0.22 model share unchanged; camera 0.45 already verified. Exact `view_recoil_tracking` name absent in current client | Fixed-FOV/settings native AK/M4 taps and spray with simultaneous world/model landmarks, demo punch anchors and frame timestamps, or a traced model-transform consumer |
| Landing weapon dip / crouch eye curve | Existing verified camera pitch/accuracy retained; weapon dip and extra camera smoothing unverified | Ordinary jump and higher drop with world/model landmarks and demo contact velocity; stationary crouch/stand transitions with eye/view-offset samples |
| Early trigger scheduling | Held retry verified; exact native schedule after an early press unverified | Commands before/after cycle, reload and deploy boundaries; button/subtick edges, next-primary tick/ratio, weapon-fire ticks and last-shot times; held and released variants |
| Jump spam / bhop window | Existing logic/defaults retained; new restore gate verified | Runtime convar values plus actual command/subtick edge timing bracketing spam/landing thresholds; external X11 sleeps alone are insufficient |
| Full movement/collision/stairs | Integration helpers matched; full collision/step trajectories unverified | Controlled flat-ground, wall, slope and known-height step runs with position and direct velocity/command fields; current demo velocity aliases are lagged position differences |
| Footsteps / silence / loudness | 1.35 m cadence and 54% threshold remain approximated | Native run/walk/crouch and deceleration on one fixed surface, position/state samples plus explicit game-output audio or reliable footstep events; fixed listener and mixer gains. Existing wrapper records video only |
| Convar defaults | Retained server log proves acceleration 5.5, weapon-speed scale on, friction 5.2, stop speed 80, gravity 800, jump impulse 301.993; others not freshly verified | Runtime queries or authoritative current cfg assignments for air cap/acceleration, jump windows, suppression/smoothing and remaining defaults |
| Random stream / recoil suppression | Imported weapon seeds/statistics match; prior recoil/recovery emulation retained | Current-build command/subtick seed derivation and float math/table rerun with runtime suppression/smoothing defaults; no new distribution tuning shipped |
| Ladder / Negev movement modifier | Unverified activation paths retained | Native ladder-fire and sustained Negev movement state/accuracy samples or complete current reader/control-flow traces |
| Damage / hitboxes | Prior native capsules, armor selectors and penetration preserved; complete damage arithmetic not re-established | Native current-build falloff/armor/headshot damage traces across ranges; animated lag compensation and bot analytic hitboxes remain separate. Knife/backstab and Zeus falloff retain explicit approximations |
| World animation | Existing imported flinch/death work reused; turn-in-place, planted-foot and landing transitions remain unverified | Authored graphs/clips plus timed state/transition captures before importing and blending new clips |
| Physical input and framebuffer | Sensitivity/FOV arithmetic already verified; device/display latency and CSS-to-native pixel parity unverified | Controlled raw mouse-count test on user's browser; synchronized physical input/display measurement; matched native/browser resolution, stretch and DPR captures |

Prepared protocol and four sequences:
`../native-audit/feel-capture/feel-capture-plan.json`. Launching CS2 still requires
the user's approval because it takes the GPU and foreground focus. Nothing in
this report treats elapsed waiting time as that approval.

## Validation and reproduction

- TypeScript passes; full unit suite: 2,204 pass, one documented missing fallback
  asset failure in `src/lib/modelAssets.test.ts` (`public/models/ak47.json`).
- Five Chromium cases pass across `input-timing`, `trigger-continuity` and
  `view-punch`. No concurrent browser suites or repository edits during a run.
- Native arithmetic: 66 movement + 62 readiness/windup + 42 crosshair samples.
  Weapon/tagging comparison: 2,730 + 108 values. AUG animation/audio: 48 focused
  tests plus native bake/structure validation.
- Every Node command used `MemoryMax=8G`, `MemorySwapMax=0`; browser runs also
  used `CPUQuota=400%`. Portable Blender used two threads and a CPU cap.

Reproduce trainer probes with `tools/probe-movement-feel.mjs`,
`tools/audit-trigger-continuity.mjs` and `tools/probe-follow-crosshair.mjs` under
the memory cap. Native verifiers accept the installed server/client paths and
use `PYTHONPATH=../native-audit/python`; their hashes prevent silent comparison
against another build. Current exports use `tools/verify-weapon-data.mjs`.
Local native reports, capture preparation, scripts and backups survive under
`../native-audit/`; raw entity offsets are confined to analysis scripts/artifacts.
