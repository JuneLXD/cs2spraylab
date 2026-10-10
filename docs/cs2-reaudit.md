# CS2 independent re-audit: passes 16–38

## Current priority: common weapons and core feel

The user narrowed follow-up work on October 10 to movement and the weapons that
matter most: AK-47, M4A4, M4A1-S, AWP, Glock, USP-S and Desert Eagle. Prioritize
input response, counter-strafe accuracy, recoil/recovery, scope behavior and
reload/draw timing. Shotguns, R8/revolver follow-up and less-used weapons are
deferred. Existing evidence and delivered fixes remain valid within their stated
limits; deferred rows are not requirements for this focused follow-up.

The unfinished empty-shotgun-trigger change is preserved locally under
`../native-audit/reports/deferred-shotgun-pass35/`, with its patch, source files
and hashes. It is absent from the active app and has not been committed or
shipped. Detailed transform/resolver investigation is also lower priority than
measurable input, movement and common-weapon behavior.

Fifteen evidenced corrections follow baseline `c488943`: movement (`79832e6`),
scheduled recoil (`e85f59a`), R8 charge composition (`9b94483`), accuracy/index
ordering (`fd328d5`), ordinary footstep cadence (`2aba70c`), and native weapon
recoil rotation (`5132783`, [pass 23](reaudit-viewmodel-recoil.md)), and
[airborne weapon motion](reaudit-viewmodel-air.md) (`4e999d9`, pass 24), and
[loaded-shell reload interruption](reaudit-shell-reload.md) (`9095bb0`, pass 26),
and [AK reload playback](reaudit-animation.md) (`7597b1c`, pass 31), and
[ordinary draw playback](reaudit-draw-and-transform.md) (`64bbe25`, pass 33).
The focused follow-up adds [common-weapon reload admission](reaudit-common-reload.md)
(`55602f8`, pass 34), [crouch accuracy stance](reaudit-duck-accuracy.md)
(`02cc418`, pass 35), and [M4/pistol draw playback](reaudit-common-draw.md)
(`95788ca`, pass 36). Two further local corrections cover
[Deagle reload events](reaudit-deagle-reload.md) (`c533887`, pass 37) and
[Glock attack clocks](reaudit-glock-timing.md) (`ae2f6cf`, pass 38).
This report covers the requested inventory and identifies the remaining work;
it does not certify complete native parity. The follow-up corrects
[accuracy/index update order](reaudit-accuracy.md) and
[footstep timing](reaudit-footsteps.md). [Camera-clock pass 22](reaudit-camera-clocks.md) confirms native arithmetic and
identifies a remaining command-history mismatch without changing camera timing.
[Client history](reaudit-client-history.md) now establishes the frame-selection
rule; [weapon recoil](reaudit-viewmodel-recoil.md) corrects the separate model transform.
[Motion-input pass 25](reaudit-motion-inputs.md) identifies the consumed velocity
cache and changing scene basis without changing production motion.
[Motion-history pass 27](reaudit-motion-history.md) binds the ordinary body-yaw
writer and executes velocity-history insertion and bracket selection. Their
live clocks and reset rules remain open. [Pass 28](reaudit-motion-runtime.md)
replays captured velocity rings and body dispatch, and identifies the temporary
movement-clock scope. [Pass 30](reaudit-motion-controller.md) measures controller
tick base, narrows turn projections and binds construction/publication order.
[Pass 29](reaudit-animation.md#pass-29-action-clocks-evidence-only) measures
actual action clocks and records the AK reload pose/event mismatch. Pass 31
binds the current first-person graph clock and corrects that narrow retime.
[Pass 32](reaudit-presentation-history.md) captures published/input frame clocks,
first-press camera anchors and velocity-offset producer fields. It also records
the rejected transform reader and its narrowly corrected class gate.
[Pass 33](reaudit-draw-and-transform.md) validates that gate with 2,602 new rows,
binds the concrete immediate Arms caller, corrects four ordinary draw rates,
and establishes one-entry serialization and the ordinary interior held clock.
R8-specific follow-up is excluded at the user’s request.

Current binary/config provenance is retained in
[evidence/reaudit-runtime-settings.json](evidence/reaudit-runtime-settings.json).
The game launch and offline captures were approved. After the user rebooted,
both REA bridge endpoints were restored. A second reboot at 16:30 PDT stopped
the native sessions again; transports are healthy, and saved current-hash evidence
remains available. Bounded current-byte probes continue without new full analysis.
No active Ghidra request is cancelled or restarted.

## Verified behavior and validation

Passes 33–36 are committed locally and await push approval. The LAN still serves
`f0f70ee`; the changes below must not be treated as deployed.

Passes 37–38 are committed on local `audit/common-pistol-clocks`, preserving the six-commit
payload and its asset manifest. TypeScript passes; 2,509 distinct unit cases
pass, with only the known fallback-model fixture absent. All four targeted
Chromium cases pass. [The combined validation record](evidence/reaudit-common-pistol-validation.json)
retains the initial missing-asset failures, corrected render-clock fixture,
focused rechecks and log hashes. No production changes followed the full unit run.

Passes 34–36: TypeScript passes; 2,488 distinct unit cases pass after correcting
three older reload fixtures, with only the known missing fallback model left.
All four targeted Chromium cases pass. [Counts and log hashes](evidence/reaudit-core-validation.json)
retain the full run and focused rechecks; no exact native input latency is inferred.

- Common-weapon reload: both engines reject released early R taps and retry held
  R after the firing cycle, respecting attack priority. All 56 paired cases
  agree. Fixed-step AWP start changes 31.25 ms → 1460.9375 ms for a 1455 ms
  cycle; these are trainer samples, not native scheduling measurements.
- Crouch accuracy: the native stance flag replaces the 95% amount predicate.
  Across 168 supplied native state/accuracy cases, 120 mismatches fall to zero;
  maximum penalty error 0.0100954175 → 0. Both active and carried weapons use it.
- Deagle reload: magazine-removal audio moves 133.333 → 333.333 ms and the silent
  window gains one authored frame. All 42 hearing/browser pairs agree; 78 of
  84 cases are unchanged. Decoded motion and empty reloads are identical.
- Glock: immediate taps after switching now fire; an early held press moves
  281.25 ms earlier in the fixed-step bench. All 12 engine pairs agree on shot
  and mode-transition times; six normal shot/mode controls remain unchanged.
- Common draws: with 250 ms attachment delay, M4 rate 1.283019343× → 1× and
  Glock/USP/Deagle rate 1.333333333× → 1×. All 1,086 action-lifetime/weight samples,
  901 unaffected controls, 72 interruptions and 24 pauses remain unchanged.

- Standing launch 298.86838 versus fully crouched 301.99338 u/s; airborne origin
  shifts ±9 units; camera offsets approach 90 units/s. Standing apex 56.9974→55.8255 u,
  midair-crouch apex 74.9974→64.8255 u. Captured camera samples match within .0001 u.
- Exact scheduled aim-punch: maximum fresh eight-shot processing-time error
  .338199°→.00000239°. Bullets and guides share the scheduled sample.
- R8 charge: native additive motion composed over its firing-start pose.
  Arm/finger error 752.262→.02743 mm across 30 frames; both HD/legacy rebuilt.
  Actual runtime checks cover charge after idle and fire/cancel.
- Accuracy/index: production matches all 39,648 native invocation cases and
  41,584 accepted demo ticks within documented landing-speed precision. Fresh
  recovery penalty error falls .0013072615→1.49e-8; index error 1→numerical precision.
- Ordinary running footsteps: AK/AWP intervals now406.25ms, knife312.5ms,
  replacing the faster distance accumulator in both engines. Mixer unchanged.
- Weapon recoil: 108 independently executed native cases reduce maximum isolated
  orientation error 3.29583651°→0.000014502°; Range and Duel use the same world-angle
  conversion, including Duel damage punch.
- AIR weapon motion: 944 captured transitions match exactly; 812 isolated engine
  cases reduce missing position20.32mm→.000000889mm and orientation.4000053°→.00001648°.
- Pass 25 evidence: 3,833 captured bob transitions replay within 7.46e-9 native
  units using the selected velocity cache. Corrected moving turns confirm scene
  yaw differs from aim yaw. Full bob/sway production behavior remains unchanged.
- Loaded-shell reloads: early held fire moves from 250 ms to 468.75 ms for
  Nova/Sawed-Off and 609.375 ms for XM1014. Ready taps fire at their input edge
  instead of being lost; 192 cases agree across both engines and the bounded
  rule. Empty-start insertion and finish clocks remain estimates.
- Pass 27 evidence: 38 native history-bracket cases and six native writer cases
  establish tick-keyed ring behavior. Static body-yaw ownership and state rules
  are bound to the current client; no new bob/sway behavior is shipped.
- Pass 28 evidence: all711 selected-cache projections match actual captured
  rings; 11 other cache values retain an earlier history phase. Body dispatch
  matches Move/Start/air projections; stationary turn timing still needs the
  scoped controller clock. Production motion remains unchanged.
- Pass 29 evidence: 20 AK/AWP/Nova/XM clip entries match the current package;
  16 fire-clock samples preserve authored time. AK's insertion pose trails its
  own ammo event by 15.069 ms before the pass31 correction below.
- Pass 30 evidence: 2,589 guarded snapshots, all 372 controller-seeded turn
  projections within reconstruction precision, and 1,427 exact selected-cache
  velocity comparisons. Invocation association, existing-instance resets and
  transform/latch scheduling remain open; no production motion change.
- AK reload: current Arms graph clock passes 40 native cases. Authored insertion
  pose crossing changes 1.115069→1.1 seconds; ammo/readiness remain unchanged.
  Exact native action onset and display phase remain outside this rate correction.
- Pass 32 evidence: 4,088 input-entry occurrences match published clock pairs;
  three fresh-press anchors and eight demo/live camera pairs match exactly.
  Five held follow-ups match a conditional float32 cache replay. All 4,861
  velocity rows have the bound one-tick offset; transform reads were rejected
  and their corrected class gate awaited the pass 33 live validation below.
  Pass 32 changed no production behavior.
- Ordinary AK/AWP/Nova/XM draws now preserve authored seconds after late model
  attachment. A 250 ms delay changes AK/Nova/XM 1.333333×→1× and AWP 1.245901×→1×.
  All 724 action-lifetime/fade samples remain unchanged; 576 equipment/pickup
  controls, 48 interruption controls and 16 pause checks pass.
- Pass 33 evidence: all 2,602 fresh transform snapshots pass their exact class/
  owner/callback gates. Complete current values match ring values in only 179
  rows; polling still does not establish writer identity or call arguments.
  Count-one source/output metadata closes reduction for the three sampled first
  presses. Native movement scopes bind ordinary interior held deadlines to the
  weapon callback clock; live resolver branch/cache remains unobserved.
- Pass 33 validation: native/graph/portable probes and TypeScript pass;
  2,373 unit cases pass with only the known missing fallback fixture failure.
  Both Chromium draw cases pass in 15.1 seconds, verifying actual-engine
  authored time, hand motion, idle return and unchanged ammo/readiness.
  Both existing camera cases also pass. Heavy work was serialized under caps
  with deploy paused and repository files frozen during browser runs.
- Pass 32 validation: native/decoder/portable probes and TypeScript pass;
  2,367 unit cases pass with only the known missing fallback fixture failure.
  Both Chromium camera cases pass in 27.1 seconds, with serialized capped
  execution and repository files frozen throughout the browser run.
- Passes 30–31 validation: TypeScript and portable probes pass; 2,367 unit
  cases pass with only the known missing fallback fixture. All three targeted
  Chromium cases are verified: both camera checks and actual Duel AK reload
  playback. A stale HUD control-count assertion was corrected; no UI behavior
  changed. Heavy runs were serialized with caps and repository freezes.
- Passes 28–29 validation: all portable probes and TypeScript pass; 2,363 unit
  cases pass with only the documented missing fallback fixture failure. Both
  Chromium view-punch cases pass in 27.3 seconds, serially under host caps with
  repository edits frozen. No production behavior or asset changed.
- TypeScript passes. Passes 26–27 full unit suite: 2,363 passes and the documented missing
  `public/models/ak47.json` fallback failure. All four targeted Chromium cases pass
  in 53.1 seconds, including loaded-shell mouse input, actual weapon-root
  rotation, AIR placement and skipped draws. Earlier five-case input/trigger
  validation remains recorded in the delivery history.
  Numerical and browser commands use memory/swap caps; Chromium is serial,
  CPU-capped and run with repository edits frozen. Auto-deploy was paused for
  the final browser run; one batched push avoids overlapping builds.
- Paired neutral-material strips cover world running, AK reload/full fire and
  R8 idle→charge→fire→cancel. They compare exported clips/runtime animation,
  not native lighting, monitor presentation, or the complete CS2 animation graph.

Unchanged rows name baseline `c488943` in the implementation column. “Matched”
always refers to the evidence/property stated in that row; missing runtime
coverage is not silently upgraded by a matching constant or imported clip.

## Movement

Evidence labels, reproduction commands and detailed limits: [reaudit-movement.md](reaudit-movement.md).

| Mechanic | Game rule / evidence | Trainer before | Trainer after | Status | Implementation commit |
|---|---|---|---|---|---|
| Ground acceleration | M1 Accelerate separates wish speed and acceleration speed; base max(250,wish), weapon/stance scales, 5 u/s walk taper. M4 acceleration 5.5. | Same arithmetic; AK rest→215 u/s at 570.3125 ms. | Unchanged. | Matched equations; complete live acceleration trajectory still approximated. | `c488943` |
| Ground friction / stop speed | M1 ground-only max(speed,80)×5.2×surface×dt, midpoint movement correction. M4 numeric values. | Default surface=1 behavior matches; surface-specific friction metadata is not consumed by actor motor. | Unchanged. | Matched default-surface equation; variable surfaces approximated. | `c488943` |
| Counter-strafe / release | M5 position intervals; M1 friction/acceleration. | 34% threshold 78.125 / 203.125 ms; sustained reverse crosses zero 125 ms, release zero 382.8125 ms. | Unchanged. | Matched sampled threshold only; exact subtick stop timing unverified. | `c488943` |
| Stand / walk / crouch caps | M1 running weapon cap, walk×0.52, crouch×(1−0.66 amount). | AK215 /111.8 /73.1 u/s; ground speed clamps every step. | Unchanged. | Matched equations. | `c488943` |
| Weapon speed multipliers | M6 all 35 firearms, both modes; knife250. | Extracted speeds; bench enumerates all 71 supported weapon/mode entries. | Unchanged. | Matched data. | `c488943` |
| Scoped walk acceleration | M1 second zoom with scaled walk speed<110 retains weapon scaling. | Implemented;100 u/s weapon gives4.296875 u/s gain/128 step from rest. | Unchanged. | Matched static branch. | `c488943` |
| Silent walking threshold | Current-server movement wrapper bypasses the timer while walking or below135.2u/s; speed²<10 resets it. See [footstep ledger](reaudit-footsteps.md). | Gate54% weapon speed; distance accumulator. | Native absolute speed/walk gate and rest reset. | Matched bounded ordinary dry-ground cases; special sounds and client delivery remain partial. | `2aba70c` |
| Air acceleration / wish cap | M1 AirAccelerate/AirMove; M4 12/30. Gain budget12×uncapped wish×dt; capped directional deficit; half budget before movement, remainder after. | AK from rest20.15625 u/s gain/128step; pre-move10.078125. | Unchanged. | Matched arithmetic. | `c488943` |
| Air-strafe / no-key control | M1 uses wish direction and dot product; zero wish gives no gain. | No-key momentum retained; directional cap 30; orthogonal strafe can add speed. | Unchanged. | Matched isolated arithmetic; full curved runtime path/collision unverified. | `c488943` |
| Bunny-hop timing | M1 window/restore/clamp branches, M4 7.8125ms full window; velocity restoration gated above weapon cap; launch clamp1.1×weapon unless enabled. | ±3.90625ms; restores only overspeed; AK clamp236.5u/s. | Unchanged. | Static rule matched; runtime boundary presses unverified. | `c488943` |
| Jump spam | M1 modern jump rejection; M4 15.625ms threshold. | ≤15.625ms rejected;15.626ms accepted. | Unchanged. | Static/default matched; rapid physical-input delivery unverified. | `c488943` |
| Jump impulse / standing trajectory | M1 standing branch subtracts gravity/256; M3 records 298.86838 at ticks282,670,873. | Used301.993 for standing; apex 56.9974u. |298.868; apex 55.8255u, matching recorded apex 55.81235u within sampling/position quantization. | Fixed; matched launch state and bounded trajectory. | `79832e6` |
| Fully crouched jump | M3 tick476 launch301.99338. | Full impulse, correct. | Full impulse retained. | Matched launch state. | `c488943` |
| Midair crouch / crouch-jump height | M2 and M3 ticks681/882: amount0→1; ballistic origin residual+9.0078125/+8.9921925u. | Gradual tuck, +18u; midair-crouch apex 74.9974u. | Immediate crouched state,+9u; apex 64.8255u. | Fixed; matched origin change within1/64u quantization. Partially crouched takeoffs remain approximated. | `79832e6` |
| Midair unduck | M2 clearance check; M3 tick894 amount1→0, residual−8.9921875u. | Gradual stand,-18u expansion. | Immediate stand,-9u, still requires standing hull clearance. | Fixed; matched free-space case; constrained-ceiling transitions unverified. | `79832e6` |
| Ground duck / unduck amount | M1 Duck and M3 ticks412–425/542–552: down0.8×duckSpeed, upmax(1.5,duckSpeed). | Fresh-edge completion203.125ms down,164.0625ms up at128Hz. | Unchanged amount arithmetic. | Matched sampled states;128Hz split introduces documented small amount difference. | `c488943` |
| Duck eye-height curve | M3 per-sample DuckViewOffset→−18×amount at 90u/s; DuckRootOffset compensates airborne origin changes and approaches0 at 90u/s. | Smoothstep of duckAmount; ground-unduck sample error up to4.60295u; camera finished164.0625ms. | Both offset states preserved; recorded ground/air sequences match within0.0001u; fully rested camera return203.125ms. | Fixed server eye-offset arithmetic; final client interpolation not yet measured. | `79832e6` |
| Duck fatigue / cooldown | M1 both edges consume2, recharge3/s, extra6/s after64u, thresholds1.5/0.75; M4 cooldown0.4. | Implemented. | Retained; new camera remains independent of amount completion. | Matched bounded static/replayed state; stationary spam edges need exact native command fractions for complete parity. | `c488943` |
| Falling / landing slowdown | M1 modern landing-state dependence and gravity; older arithmetic fixture bounds identified separately. | Ballistic gravity800; ground factor clamp(1+v×.0005,.2,1)² then+1.111189t; jump factor base+0.6t. | Unchanged factors; standing relaunch uses corrected impulse. | Approximated complete collision/landing timing; no legacy stamina claim substituted for modern factors. | `c488943` |
| Post-landing accuracy | Native hook and12 captured landings add land coefficient×prior fall speed before recovery. | Linear addition with continuous recovery. | Native full-tick recovery; cumulative error≤3.10e-6 from fall-speed precision. | Matched captured paths; shots at simultaneous stance/landing edges remain partial. | `fd328d5` |
| Landing camera dip | Distinct native view-punch/camera mechanism; M3 carries view-punch state but this worker did not establish rendered dip from it. | Existing landing camera/view-punch response. | Unchanged. | Unverified by this movement pass; see response worker. | `c488943` |
| Step height / stairs | M4 confirms normals; current trainer step18u derives from older fixture/config evidence, not a fresh stair run. | Swept square hull with18u step-up/down. | Unchanged. | Approximated; exact stair trace and camera behavior unverified. | `c488943` |
| Slopes / collisions | M4 standable/walkable normal 0.7; M2 standing occupancy trace. | Authored box/wedge solver and voxelized imported map;32u width,72/54u heights; smooth ground-transition hull. | Air changes corrected; geometry solver unchanged. | Approximated. Surface friction, partial-ground-duck hull, multi-plane clipping and map discretization need native geometry traces. | `c488943` |
| Ladders | Native ladder scale 0.78 (M4); older isolated detach arithmetic270u/s. Authored loft ladders exist in trainer. | Simplified projected wish velocity; incidence/damping branches not completely implemented. | Unchanged. | Approximated; live ascent/dismount/detach trajectory unverified. | `c488943` |
| Subtick press timing / view sampling | M1 DoMovement integrates button-edge fractions and samples view angles when enabled (M4 true). | Both engines flush old-input elapsed time before applying edges; 128Hz base slices. | Unchanged. | Matched scheduling design; not proof that128Hz integration equals every native subinterval. | `c488943` |
| Native tick mapping | M3 jump timestamp53736+.53125 corresponds419.816650s at128Hz; demo282 time419.828125s. | Trainer base128Hz; event schedules also use64Hz server boundaries elsewhere. | Unchanged; documentation distinguishes clocks. | Matched observed mapping for movement timestamp fields; other tick fields must be identified individually. | `c488943` |

## Shooting, recoil, damage and hitboxes

Evidence labels, reproduction commands and detailed limits: [reaudit-combat.md](reaudit-combat.md).

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
| Glock/FAMAS bursts | Current Glock class/dispatcher/setter/constructor bytes and fresh vdata: unlinked attack clocks, secondary-only 300 ms mode-switch delay, pending rounds before inputs ([pass 38](reaudit-glock-timing.md)) | Shared mode-switch fire lock and missing firing secondary cooldown → separate Glock clocks and held-secondary retries in both engines | Bounded Glock rule corrected; native input producer/live scheduling remain partial. FAMAS follow-up deferred | `ae2f6cf` |
| R8 primary windup | Current server bounded initialization preserves command fraction and adds 13 ticks | 203.125 ms, unchanged; 20 native emulation cases pass | Matched arithmetic; complete charge/animation chain unverified | `c488943` |
| R8 alternate fire | Current alternate stats; fresh server spread sampler uses `1-r²` | Same alternate cycle/distribution, unchanged | Matched data/distribution branch; native trigger schedule unverified | `c488943` |
| Reload lock and insertion | Current vdata lock; imported clip insert events; fresh AK capture | Separate insert and attack deadline; unchanged | Matched exported lock, animation event coverage in animation audit | `c488943` |
| Explicit reload admission / held retry | Current-server dispatcher and seven bound classes; primary deadline inclusive, attacks take priority ([pass 34](reaudit-common-reload.md)) | R at 31.25 ms after a shot always began reload → released early taps dropped, held R retries when ready; 56 paired cases pass | Bounded weapon/input rule corrected; independent player/deploy and within-command edge timing remain partial | `55602f8` |
| Silent reload | Current Deagle clip ends its normal silent window at frame 50, not 49; [pass 37](reaudit-deagle-reload.md). Whole native gate not newly emulated | Deagle work end 1.633333 → 1.666667 s; existing trainer held exit 3.066667 → 3.133333 s and completion 3.639057 → 3.672054 s | Current static marker corrected; native runtime coefficients/onset remain unverified | `c533887` |
| Shell loading/interruption | Current native loaded-shell primary path uses the initial attack lock, then switches directly to shooting; [pass 26](reaudit-shell-reload.md) | Early held fire 250 ms → Nova/Sawed-Off468.75 ms, XM609.375 ms; ready taps now fire immediately. Start/insertion/finish estimates and empty-start path retained | Loaded-start interruption corrected; insertion/completion and empty retry ordering remain approximated | `9095bb0` |
| Recoil pattern seed/parameters | Current vdata seeds/angles/magnitudes; fresh AK native impulse anchors | Parameters identical, AK six-shot impulses verified; unchanged table generator | Matched data and AK sample; current all-weapon table emulation unverified | `c488943` |
| Recoil suppression/smoothing | AK first six native impulse anchors reproduce trainer table; historical Windows table fixture is another artifact | Four-shot suppression and automatic smoothing retained | Matched AK sample; broad native rule still partial | `c488943` |
| Aim-punch decay and velocity decay | Fresh native anchor-to-anchor carry in both captures, `PunchRecovery` comparison | Native carry error ≤0.000000478°; unchanged decay math | Matched sampled current native trajectories | `c488943` |
| Recoil time anchor in actual engines | Fresh AK native anchors use exact command schedule | Maximum sampled live error 0.338199° → 0.00000239° | Matched sampled trajectory after fix | `e85f59a` |
| Between-spray recovery | Fresh native index snapshots and native update body; long-rest angle samples | Long rests matched; short-pause index now uses full native decay steps and strict gate | Matched captured recovery; full command histories remain bounded | `fd328d5` |
| Aim punch versus camera-only punch | Current client/server sampler and impulse execution; 52 AK shots; distinct sampling and command-history clocks ([pass 22](reaudit-camera-clocks.md)) | Aim-punch scheduling corrected; camera-only processing anchor retained | Arithmetic matched; camera command-clock integration and rendered parity remain partial | `e85f59a`; camera evidence only in pass 22 |
| Recoil-follow settings | Client setting lookup and frame presentation handled in response audit | No combat settings change | See response audit | `c488943` |
| Stand/crouch/air baseline | Native arithmetic plus current crouch-flag writers/readers and retained transition states ([pass 35](reaudit-duck-accuracy.md)) | Amount ≥ .95 selected crouch → completed-crouch flag retained through successful unduck until ≤ .75; 120/168 consumer mismatches → 0 | Arithmetic and supplied-state engine conversion matched; partial blocked expansion remains approximated | `fd328d5`; `02cc418` |
| Running/walking velocity mapping | Fresh GetInaccuracy remaps 34–95% mode speed; run quarter-power, walk linear | Bench samples 0/.34/.52/.75/.95/1; same results | Matched arithmetic structure | `c488943` |
| Jump/fall/landing accuracy | Native square-root vertical term; 12 captured landings use land coefficient × prior fall speed before recovery | Continuous recovery → native full-tick recovery; cumulative penalty error within 3.10e-6 landing-speed precision | Matched captured landing penalty/recovery; coincident firing/stance edges still partial | `fd328d5` |
| Fire accuracy and tick order | Native movement → PostThink → FinishTick caller chain; 160 captured shots | Advance-then-fire continuous decay → fractional shot before native tick update, exact-boundary shot afterward; fresh recovery max error .00130726 → 1.49e-8 | Matched native arithmetic and captured paths in both engines | `fd328d5` |
| Recoil-index decay | Native strict time > float32(last shot + primary cycle + 1/64); full 10^(-2/64) step and ≤.1 snap | Partial-threshold decay → full tick factor; fresh cumulative index error 1 → numerical precision | Matched grid and cumulative captured paths | `fd328d5` |
| Reload accuracy penalty / index | Current reload penalty is zero; native explicit reload follows accuracy update and adds +1 index; idle automatic reload adds before update; captured end resets zero | No start increment → explicit/automatic ordering and end reset for magazine reloads | Matched captured magazine cases; shell and cancellation paths still partial | `fd328d5` |
| Ladder / stacked-player accuracy | Native baseline has ladder and stacking branches; current trainer lacks those accuracy inputs | No ladder/boost accuracy state | Not present | `c488943` |
| Recovery curves and transition index | Native body truncates index for ground interpolation, final -1 disables transition, air uses 4×crouch recovery | Continuous-double steps → complete 64Hz float32 steps; 39,648 invocations have zero error | Matched bounded native body and 41,584 cumulative captured ticks | `fd328d5` |
| Scope / zoom-level inaccuracy | Current mode arrays; native mode transitions preserve penalty and apply new baseline at next update | Immediate baseline rebasing → preserve penalty; retained AWP transition max error .07100477 → numerical precision | Matched data and captured transitions; all-weapon live zoom timing still partial | `fd328d5` |
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

## Input and perceived response

Evidence labels, reproduction commands and detailed limits: [reaudit-response.md](reaudit-response.md).

| Mechanic | Game evidence / rule | Trainer before → after | Status | Implementation commit |
|---|---|---|---|---|
| Pointer lock / raw input | Native OS input path was not instrumented by these captures | Requests unadjusted pointer lock, retries standard pointer lock, retains drag fallback; unchanged | Native delivery unverified; browser fallback measured separately | `c488943` |
| Sensitivity / yaw / pitch | Fresh configured native sensitivity1 and yaw/pitch .022 | .022° per count at sensitivity1; all12 count/sensitivity samples match arithmetic; unchanged | Matched configured conversion; device/OS count parity unverified | `c488943` |
| Subtick click timestamp | Native command fractions and recorded scheduled shot anchors; see movement/combat inventories | Monotonic input clock flushes elapsed old-input state before edges; stale timestamp cannot rewind, gap capped at250ms; unchanged | Approximated integration; exact physical delivery unverified | `c488943` |
| Input→simulation→render | Native video lacks synchronized device edge/presentation instrumentation | Browser tests record DOM dispatch, shot and renderer submission; no production delay tuned | CPU/browser response measured; native and physical mouse-to-photon unverified | `c488943` |
| Frame pacing | Native engine presentation is outside demo sampling | Synthetic60/144/240Hz clocks, limits0/60/120; uncapped renders every supplied frame; unchanged | Trainer measured, native comparison unverified | `c488943` |
| Low-latency canvas | No native presentation equivalence established | Requests desynchronized WebGL2 when enabled, rejects software-renderer path, falls back to regular context; unchanged | Browser implementation only; actual scanout benefit unverified | `c488943` |
| Shot camera / aim punch | Current client/server arithmetic; pass32 adds 8 exact demo/live anchor pairs, 3 selected first-press matches and 5 conditional held-anchor replays ([history](reaudit-presentation-history.md)) | .45 physical punch share plus camera kick; processing-clock class replay differs up to 0.499441°; no speculative change | Arithmetic matched; native published/input pairs now observed; browser mapping, resolver phase and continuous video comparison remain partial | `e85f59a`; evidence only in passes 22/32 |
| Crosshair on shot | Current-client saved pixel conversion and recoil-follow evidence; earlier bounded arithmetic retained | Render-time sample and pixel snapping retained; unchanged in this pass | Bounded prior arithmetic independently traced; new video parity unverified | `c488943` |
| Viewmodel on shot | Current native camera/HUD caller chain, 0.325 combined physical share and 108 executed orientation cases ([pass 23](reaudit-viewmodel-recoil.md)) | .22 local Euler rotation replaced by native world-angle share converted to weapon camera space; damage punch included | Isolated recoil rotation matched; full animated landmarks and timing remain open | `5132783` |
| Muzzle flash / tracer onset | Native clip event tracks and tracer data; see animation/combat inventories | Simulated shot triggers pooled flash/tracer; native cadence option retained | Approximated particles and renderer timing | `c488943` |
| Viewmodel offsets / presets | Fresh configured native FOV65, offsets−.5/1/−2 | Source-unit conversion gives metres−.0127/−.0508/−.0254; presets unchanged | Matched coordinate arithmetic; complete placement unverified | `c488943` |
| FOV / stretched view | Native configured viewmodel FOV65 | Vertical projection51.077193°; world4:3 and16:9 flow to model aspect; unchanged | Trainer arithmetic measured; matched native image comparison unverified | `c488943` |
| Crouch camera | Fresh native view/root offset samples, movement inventory | Smoothstep replaced by independently approaching90u/s offsets | Matched recorded server state; rendered interpolation unverified | `79832e6` |
| Landing camera / weapon dip | Native demo state available; complete rendered trajectory not recovered from gapped video | Existing view-punch response and model landing adjustment retained | Unverified rendered amplitude and duration | `c488943` |
| Head bob / sway | Current HUD-model procedure contains velocity/air-state bob and smoothed angle sway outside the graph; pass 24 captures 944 exact AIR transitions | Native airborne world drop/pitch added; existing 2 mm sine movement bob retained | AIR matched in isolated bench; pass 25 matches captured bob inputs, full head/bob/sway parity unverified | `4e999d9` |
| Hit sounds / damage indicators | Native hit/hurt event assets and mixer metadata; fresh sound onset alignment not captured | Head/helmet/body/armor and shooter/victim event selection; training indicators and damage camera retained | Native asset selection supported; timing/loudness and UI parity approximated | `c488943` |
| Kill confirmation | Native event/UI rendering not frame-compared | Trainer kill feed/count and target feedback follow simulated death | Approximated training feedback | `c488943` |
| Blood / bot flinch | Fresh native flinch clips and flags; animation inventory | Imported bullet-hit deltas plus simplified blood particles; unchanged | Matched sampled clips; approximated effects/blends | `c488943` |
| Footstep cadence | Current native wrapper, countdown override and command producer; [footstep ledger](reaudit-footsteps.md) | 1.35m distance cadence: AK242.1875–250ms, AWP265.625–273.4375ms, knife210.9375–218.75ms → native command timer:406.25/406.25/312.5ms | Matched bounded normal dry-ground timer and speed gates in both engines; special paths remain partial | `2aba70c` |
| Footstep loudness / stance | Native walking/135.2u/s gate; rest resets; native volume scalars retained in footstep ledger | Walk/slow/rest countdown behavior corrected; ordinary walk/crouch stay silent; existing browser mixer retained | Timer/stance gates matched in bounded cases; loudness, surfaces and listener-distance parity unverified | `2aba70c` |
| Weapon sound timing / distance layers | Fresh native action timelines/mixer imports and clip event metadata | Imported gun/action events, distant layer and browser spatial gain; unchanged | Matched imported data; runtime spatial mix/occlusion approximated | `c488943` |
| Bot target locomotion / turning / landing / death | Fresh world clips/graphs, pose/capsule bench | Native clips in custom blends; missing turn/planted/additive states; custom ragdoll | See full animation inventory; overall approximated | `c488943` |

## Models, animation and effects

Evidence labels, reproduction commands and detailed limits: [reaudit-animation.md](reaudit-animation.md).

| Mechanic | Primary rule/evidence | Trainer before → after | Status | Implementation commit |
|---|---|---|---|---|
| Agent mesh, scale and proportions | Fresh `ctm_sas.vmdl_c` glTF, world pose and skinned-envelope bench | Simplified SAS body; measured envelope ≤0.052 mm, bone position ≤0.258 mm; unchanged | Approximated mesh; matched sampled scale/pose | `c488943` |
| Skin weights and all six agent variants | Native skinned meshes retain per-joint inverse binds; each variant must be compared to its own model | 94-joint SAS rig verified; other five variants not freshly skin-sampled | Unverified outside SAS sample | `c488943` |
| Agent materials, textures, cloth and specular | Native model/material/shader resources | glTF PBR/Three rendering, compressed textures; no cloth solver or Source 2 shader recreation | Approximated | `c488943` |
| Gloves, knives and finishes | Native glove/weapon meshes and composite-material resources | Glove builder collapses fixed attachment helpers, uses approximate albedo and metallic .05/roughness .65; finishes use browser shader approximations | Approximated; per-finish rendering unverified | `c488943` |
| Mesh LOD | Native model supports authored mesh/LOD resources | One optimized mesh per loaded asset; no native distance LOD selection identified | Not present as native LOD | `c488943` |
| Posed hitboxes: stand, walk, crouch, jump | Fresh skeletal poses plus 19 capsule transforms | ≤0.230 mm endpoint difference across six sampled clips; capsules follow rendered skeleton | Matched sampled transform; full runtime graph approximated | `c488943` |
| Head/neck boundary | Native capsules are separate head and neck groups | Existing definitions transform correctly with those bones; combat independently checks source shape/group | Matched sampled transform | `c488943` |
| Dying poses and hitboxes | Native death/ragdoll graph transitions | Dead actors cease active target damage; custom physics poses corpse | Approximated | `c488943` |
| Eye height versus head | Model head bone is an animated landmark, not authoritative camera height | Camera comes from movement eye-height rule; pose bench does not establish live camera trajectory | Unverified relationship; movement bench owns eye rule | `c488943` |
| First-person arms scale and pose | Fresh view clips and native character skeleton | 37-absolute-clip/2,206-frame sample; R8 charge separately graph-composed, maximum global bone position error 1.330 mm | Matched within reported conversion error | `c488943` |
| First-person placement, FOV and stretched resolution | Live configured camera and viewmodel projection required | Separate viewmodel camera, Source-unit offsets and stretched aspect handling remain | Unverified complete visual parity | `c488943` |
| Eight-way run/walk/crouch | `worldmodel_locomotion.vnmgraph`: eight directional clip sets; standing anchors 136/225 u/s, crouch 96 u/s | Rifle/pistol sets retained; zero missing channels in 90-clip comparison | Matched clip data; approximated blending | `c488943` |
| Locomotion speed and idle rate | Graph blend-space coordinates and idle multiplier .167 | Same scalar anchors and idle multiplier; directional radial interpolation and phase locking are custom | Approximated graph; matched named constants | `c488943` |
| Planted-foot reversals | Native graph references start, slow, cross-leg and e2w/w2e states | Two planted clips exist in pack but runtime weights never select them | Not present | `c488943` |
| Turn in place | Native wrapper/dispatch; pass30 captured controller seed matches all 372 turn projections within float32 allowance ([report](reaudit-motion-controller.md)) | Actor root turns; no native turn-in-place state machine selected | Not present; invocation association, cadence/reset, evaluated transform and consecutive transitions incomplete | `c488943`; pass30 evidence only |
| Jump, in-air, crouched air | Native authored jump/in-air clips | Retained clips blended with custom takeoff 60% threshold and .12 s blend | Approximated | `c488943` |
| Additive takeoff and landing | `worldmodel.vnmgraph` references standing/crouched `jump_additive_*` layers for rifle/pistol/knife | No corresponding additive runtime layer | Not present | `c488943` |
| Aim matrix and IK | Native world graph aim/bone-mask/IK nodes | Estimated pitch weights spine0 .20, spine1 .30, spine2 .35, head .15; clamp ±1.15 rad; .35 share while reloading | Approximated | `c488943` |
| Weapon families: rifle/pistol/knife/grenade/heavy | Native world graph has separate knife, pistol, rifle locomotion and weapon graphs | Pistol equipment selects pistol; all other equipment selects rifle; weapon-specific upper-body idles/gestures overlay it | Approximated; knife/grenade locomotion absent | `c488943` |
| World draw/reload/fire gestures | Native world DMX channels and additive metadata | Native upper-body subset; lower-body/root tracks dropped, spine/neck/head translation dropped at runtime; durations retimed to mechanic | Approximated composition/timing | `c488943` |
| Hit flinch by group and side | 90 VPK flinch entries = 45 base + 45 non-additive variants | 42 bullet-hit family clips imported; three molotov family clips omitted; four freshly sampled retained sets match to .03189° | Matched sampled clip deltas; approximated blending | `c488943` |
| Death and ragdoll behavior | Native world graph hands death to native physics | Custom joint spheres, distance constraints, damping .98/friction .45, 10 iterations; baked fallback | Approximated | `c488943` |
| Distance-based animation throttling | Needs native client runtime measurement | Trainer uses visibility and global quality/adaptive rate; no distance input in `animationRate` | Native rule unverified; distance-specific policy not present | `c488943` |
| View draw, idle, fire, reload, empty reload, inspect | Current package, bound Arms clock, ordinary draw graphs; common draws add six graphs/24 unit-rate nodes ([pass 36](reaudit-common-draw.md)) | AK reload and initial four draws corrected; M4/pistol delayed draw rates now 1×, 1,086 lifetime/weight samples unchanged | Bounded relative rates corrected; onset/blends/display/pickup remain partial; pass 37 independently confirms Deagle motion data unchanged and corrects two event markers | `7597b1c`; `64bbe25`; `95788ca`; `c533887` |
| Last-shot/scoped/left/right/alternate variants | Fresh view graphs; selector inventories | Supported dedicated last/scoped/Dualies/R8 variants; generic fire paths use selected native shoot1 clips | Matched selection for implemented variants; full graph not reproduced | `c488943` |
| View action coverage | Referenced resources in fresh graphs | Unselected referenced actions include AK inspect variants/fixups, AUG/SG fidgets, CZ second reload/draw, MG bullet-hide layers, R8 chamber-position layers and knife hit/backstab variants | Not present for named layers/actions | `c488943` |
| Settle and action interruption | Native graph transition durations, sync events and inspect fixups | Trainer fades transient end over up to .08 s; inspect onset .06 s; fire resets transient; reload/switch cancels it | Approximated; exact event gating unverified | `c488943` |
| R8 charge/dry fire | Fixed `shoot1` frame-zero graph base plus additive `prepare_shoot`; independent DMX delta reference | Arm/finger error 752.262 mm → 0.02743 mm; HD/legacy rebuilt; regression checks hands and weapon after idle/fire/cancel | Matched sampled graph-composed pose; charge playback rate and chamber layers unverified | `9b94483` |
| Bolt, slide and pump | Secondary parts embedded in native fire/reload clips; pass29 AWP bolt and Nova pump markers retained | AWP1.6s and Nova.8s fire clips play1×, independently of attack cycle; sampled part errors≤1.8mm | Matched sampled parts/authored clock; native runtime event delivery unresolved | `c488943`; pass29 evidence only |
| Shell reload timing | Native segment/sync markers and conditional loop transition; pass29 | Nova intro/loop/outro rates.733333/.928571/4.166667×; XM1.4/1/2.166667× relative to authored segments | Approximated; native active-phase durations, shell transitions and action onset unresolved | `c488943`; pass29 evidence only |
| Viewmodel recoil share/view punch | Current-byte caller chain and native .325 world-angle addition; 432 bounded executions | Rotation error 3.29584° → 0.000014502° across 108 supplied states | Isolated rotation corrected; full gun/camera trajectories remain open | `5132783` |
| Bob/sway and crouch/zoom motion | Native AIR; pass30 controller/cache evidence; pass32 offset producer; pass33 accepts 2,602 transform snapshots | AIR error20.32mm→.000000889mm and angle.4000053°→.00001648°; old movement sine retained | Isolated AIR matched; body clock/reset, latch ordering, transform invocation/writer identity, look sway/crouch/zoom landmarks partial | `4e999d9`; passes30–33 evidence |
| Muzzle shape, size, duration | Fresh fire event tracks reference per-weapon particle systems at frame zero | Reduced native texture/particle envelopes grouped into six families; implementation explicitly approximates radius, randomization and materials | Approximated | `c488943` |
| Shell ejection | AK fire clip includes `weapon_shell_casing_rifle` event at frame zero | No ejected shell/casing simulation/rendering found | Not present | `c488943` |
| Tracer cadence and shape | Native per-weapon tracer data and particle systems | Native cadence option plus every-shot training option; browser trail/rope approximations | Approximated shape; combat/data bench owns cadence | `c488943` |
| Gun smoke | Native particle graph hierarchy | One simplified expanding/fading sprite per muzzle slot | Approximated | `c488943` |
| Scope overlays and unscoped blur | Native runtime scope rendering required | Browser scope effect implemented; no independent matched-frame rendering comparison | Unverified | `c488943` |
| World weapon attachment | Native `wpn` and secondary weapon skeleton | Native hand/anchor transforms plus procedural aim correction; secondary part bench checks mounted pose separately | Approximated runtime aim; measured clip mounts | `c488943` |
| World weapon moving parts when bots fire/reload | Native weapon skeleton action layers | `attachWorldWeapon` clones a static model under `wpn`; the only bot mixer binds character gestures, with no secondary part tracks | Not present | `c488943` |
| Dropped weapons | Native dropped world models and physics | Trainer pickup/drop presentation uses browser scene and simplified placement | Approximated | `c488943` |

## Claims overturned or not reproduced

The focused follow-up adds three corrections to the earlier claims:

- Trigger continuity tests that forced a manual reload immediately after a held
  shot did not verify native reload admission. The native common-weapon
  dispatcher rejects that request; the corrected tests use legal starts.
- Native accuracy arithmetic passed with externally supplied stance. It did
  not verify the engines' 95% duck-amount conversion, which disagreed with five
  recorded states. The new flag and consumer checks close that specific gap.
- The authored draw-rate correction covered four selected weapons. M4s and
  common pistols still retimed delayed attachment until pass 36. Draw resource
  identity did not validate the separately mismatched Deagle reload resource.
  Pass 37 independently resolves its two event-marker differences while
  preserving all decoded motion data.
- Extracted burst intervals did not validate Glock mode-switch readiness or
  attack priority. Current code/data show that the switch leaves primary ready,
  while firing advances both clocks and due primary input precedes secondary.

Earlier findings remain:

1. Standing and crouched jumps do not share the same observed launch velocity.
2. Airborne stance changes shift the origin 9 units, not 18, and complete immediately.
3. Smoothstep of duck amount does not reproduce the recorded camera curve;
   the eye can still be returning after the standing hull is restored.
4. Maximum duck rates do not establish fresh-key durations; input edges consume
   duck speed. 128Hz integration is not proof of all native subtick intervals.
5. Native velocity convenience aliases lag position intervals; slopes and
   obstructions in a capture cannot establish flat-ground acceleration.
6. Correct idealized recoil tests did not verify live-engine scheduling. The
   processing-tick anchor caused a measurable error even with correct cadence.
7. Matching accuracy formulas did not verify update order, full-tick index
   decay, mode switching or reload-start increments. Independent native replay
   now verifies the correction in production code and both simulation paths.
8. Filename-based coverage was wrong: `native_phase3_m4a1s_001` is M4A4,
   `native_audit_aug_scope_001` is USP-S, `native_audit_awp_001` is USP-S/AK,
   and `native_reload_deagle_empty_001` is M4A4. The M4A1-S 0.09 s claim is
   withdrawn; current M4A1-S data is 0.1 s. Exact decoded coverage is retained.
9. Old Windows/previous-Linux hash-pinned fixtures cannot be labeled current
   by bypassing their guards. Their bounded evidence is identified separately.
10. The fresh early-tap script's intended 25 ms edge was not delivered precisely;
    X11 call timing and stale serialized FIRE fields do not prove native
    released-before-ready behavior.
11. Whole-report hitbox fixture equality can fail on provenance while the
   19 capsule definitions match. Geometry and source identity are compared separately.
12. Displayed damage examples do not establish executable integer truncation,
    armor, knife, Zeus or every penetration branch.
13. “Native animation” describes the sampled clip data, not native graph
    reconstruction, IK, planted transitions, turn-in-place or additive landing layers.
14. The 90 flinch resources contain 45 paired representations, not 90 distinct
    bullet-hit gestures. The 42 imported bullet-hit clips omit 3 molotov base clips.
15. “Native model” does not establish identical topology or shaders: sampled
    SAS body vertices fall from 19,077 to 9,779. Envelope agreement is bounded.
16. Distance-based animation sampling was not implemented by the existing
    global quality/visibility policy; it has no distance input.
17. Zero-duration native static poses exported as constant 1/30 s loops do not
    imply a frame of input latency.
18. The initial R8 mount-only reference incorrectly accepted hanging arms.
    The native graph's firing-start base and independent DMX composition
    supersede that reference and its 124.647 mm interpretation.
19. Current console queries do not expose several legacy recoil, landing and
    eye-smoothing names. Their inferred values are not verified current defaults;
    unknown-command responses do not prove the underlying code is absent.
20. A 60 fps container header did not mean 60 sampled frames per second. The first
    recovery video contains 44 frames over 14.067 s. Isolated recorder checks now
    preserve 480 frames over 8 s with separate audio/video processes; this still
    does not establish unique native rendered frames or physical input latency.

21. A fixed 1.35 m stride and weapon-relative audible threshold do not reproduce
    the native footstep clock. The native wrapper has absolute speed gates,
    rest resets, walk/slow clock preservation and command-time countdowns.

22. The old 14-shot camera fixture verified arithmetic for almost coincident
    clocks; it did not establish the general shot caller. Current native camera
    sampling and command-history storage use separate clocks. A schedule-only
    candidate still differs by up to 0.177648° in the new class replay.
23. Continuous capture timestamps do not establish uniform game-frame timing.
    Recovery002 retains continuous video but selected displayed GameTime offsets
    vary by about 49.7 ms. A single-offset fit cannot certify rendered recoil.

24. Weapon recoil is not an unmeasured 0.22 local rotation: the current native
    HUD path adds 0.325 of combined physical punch to camera-based world angles.
    Converting that orientation into the separate weapon scene also matters.
25. The trainer already has a 2 mm sine bob. Native procedural bob and sway
    exist outside the searched animation graphs; neither can be dismissed from
    graph-node absence.
26. The first attack-down selects a published-frame record and its captured
    player clock. Input event time and firing deadline do not replace that record.
27. The weapon air transition is per eligible HUD invocation, including zero
    delta. A time-scaled easing would not reproduce the measured native rule.
28. Stored velocity and look yaw are insufficient for native movement bob.
    Pass 25 directly identifies the selected velocity cache and reproduces
    3,833 captured bob transitions; no interpolation delay was fitted.
29. Fixed scene yaw in pass 24's 3.52° look sweep was limited coverage. Larger
    stationary turns show up to35.62460° aim/scene separation; corrected moving
    turns also show a clean local-angle difference. A fixed-yaw model is invalid.
30. Requested FPS caps do not establish HUD or presentation cadence. Both
    requested60/30 windows expose approximately64Hz HUD state updates.
31. The first pass25 sequences used W/S, which are inspect/use in the user's
    bindings. Those intervals are excluded from forward/back and moving-turn
    evidence; the corrected T/G recording establishes actual movement.
32. A loaded-shell attack does not universally wait for a .2-second reload outro.
    Native initial attack locks come from the named vdata duration; an eligible
    loaded shot switches directly to firing. The .2/.25-second primary-wrapper
    literals belong to the empty-fire retry path. Earlier trainer interruption
    both bypassed the initial lock and lost ready released taps.
33. A false return from the velocity-history writer does not mean no sample was
    recorded: the third identical-vector case still appends its new tick.
    Native fixed 1/64 factors in body yaw also do not establish call cadence.
34. A retained velocity cache need not match a newly changed ring. All11
    apparent pass28 residuals retain an earlier exact cache value while the
    sampled context selects stored velocity; active cache-zero samples match.
35. Sampled raw global tick and last processed command do not identify the
    body writer's active clock. Movement temporarily replaces global time from
    controller tick base, restores it afterward and publishes the last command
    after yaw postprocessing. A fitted command offset would conceal that phase.
36. Older import build labels did not prove the sampled AK/AWP/Nova/XM clips
    stale: all20 selected resource CRC/size pairs match the current package.
    Conversely, matching clip identity does not establish correct runtime time:
    the trainer's AK insertion pose trailed its own ammo event by15.069ms.
    Pass31 corrects the relative clip rate after binding the external Arms clock.

37. The recorded controller seed now explains every retained pass30 turn-loop
    projection, but almost every sample is outside an active processing marker.
    That match does not establish invocation identity or a free-running replay.
    Constructor defaults also do not establish an existing-instance reset policy.
38. Runtime006/007 did not capture two velocity rings: each had one active ring.
    Pass32 binds its offset producer and observes the matching group pair;
    unused second-context values cannot establish that context's runtime law.
39. A transform current record is not necessarily the last interpolated result.
    Its recording and fallback getters also write it. The first runtime008
    reader rejected the actual pawn subclass; fixing its class gate does not
    retroactively validate those samples.

40. The worker clock is not the sole displayed-Arms update path. The ordinary
    HUD caller reaches a concrete immediate Arms evaluator under explicit mode
    and interpolation-selector gates, forwarding unscaled frame delta.
41. Late model attachment previously sped up ordinary draws to fill the remaining
    deploy lock. Four audited graphs now use authored seconds; native first-display
    onset and readiness/idle ordering remain separate from that rate correction.
42. A single input history entry bypasses reduction and preserves index zero.
    Its completed append mapping does not prove the final command's player-pair
    presence. Ordinary interior held deadlines also have an actual native clock
    scope; that does not identify every live resolver branch or cache value.

## Exact remaining evidence and implementation

- Accuracy/index: common captured paths are corrected in both engines. Native
  command/state captures remain for bursts, Negev, shell reloads, suppressor,
  holster and simultaneous transitions. See the accepted 41,584-tick coverage
  and caller evidence in [reaudit-accuracy.md](reaudit-accuracy.md).
- Input/fire: native command fractions plus due tick/ratio and fire events for
  released early taps and bursts. Loaded-start shell interruption is corrected;
  capture empty-fire retry, ammo-event ordering, absolute insertion/completion
  deadlines, later silent phases and reload admission during attack cooldown.
  Mouse-to-photon requires synchronized device/display instrumentation.
- Movement: flat unobstructed trajectories and exact input edges; landing/bhop
  boundary presses; constrained unduck and partial-duck takeoffs; matched
  stairs, slopes, surface friction and ladders; rendered camera frames paired
  with camera-service offsets.
- Camera clocks: [pass32](reaudit-presentation-history.md) observes selected
  player/render pairs and first-press camera anchors. Pass33 binds count-one
  serialization and the ordinary interior held-deadline scope. Still needed:
  final player-pair presence/command association, higher-count reduction cases,
  live resolver branch/cache and entry/domain state, exact sampler phase, and
  the trainer's corresponding saved frame clock.
  Both older and new recordings rule out a fitted universal schedule offset.
- Presentation/audio: continuous timestamped native camera and gun landmarks
  through shots, recovery, crouch, landing and zoom; footstep material,
  listener-distance, water/ladder and separate jump/landing sound paths.
  Current video/audio process clocks give only approximate cross-stream alignment.
  AIR state/arithmetic is now matched; pass25 identifies the selected velocity
  cache. Pass27 binds the history writer and ordinary body-yaw owner/rules.
  Pass30 adds 1,427 exact selected-cache comparisons and captured controller tick
  base; the recorded seed matches all 372 stationary-turn projections. Full bob
  has a bound ring-offset producer in pass32 but still needs latch ordering,
  call-associated entry/exit clocks,
  consecutive body transitions, existing-instance resets and selected transform
  history beside its evaluation context. Pass33 accepts that history but does not
  establish invocation arguments or writer identity. Sway needs input/writer/prediction ordering and
  HUD phase beyond the captured exact-endpoint arithmetic.
- Damage/hitboxes: controlled native victim health/armor deltas, hit groups,
  tagging velocities, knife/Zeus and penetration flags; authoritative server
  posed skeletons against the displayed poses in every stance and death transition.
- Models/animation: native runtime graph outputs for reversals, turns, additives,
  aim/IK and weapon-family masks; native ragdoll traces; all agent/glove/knife/
  finish skin/material comparisons; client animation-rate and effect event readers.
  Static exports alone cannot settle active runtime branches or renderer parity.
  Pass31 binds the current Arms NmGraph elapsed-time caller and corrects the
  ordinary AK clip rate. Pass33 binds the immediate Arms path and corrects four
  ordinary draw rates. Exact first-active-sample/transition timing, other weapon
  clock branches, shell phase gates, pickup routing and delayed-model onset
  remain open.
  The legacy demo playback-rate field still is not the Arms graph clock.

Every unresolved row is retained without speculative feel tuning. The subsystem
reports provide the finer boundaries and local artifact names needed to resume.
