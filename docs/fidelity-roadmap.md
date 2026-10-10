# Native feel follow-up

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

User-approved priority order, October 8, 2026. Local commits and LAN previews;
publishing still requires approval under the repository workflow.

1. Muzzle flashes and tracers: use installed particle definitions, retain
   cosmetic-only behavior and bounded allocations, compare native recordings.
2. First-person weapon movement: identify and remove redundant motion; validate
   authored animation, recoil, movement and scope presentation separately.
3. Counter-strafe accuracy timing: compare release/reversal and shooting around
   the accuracy threshold using retained native evidence and simulation tests.
4. Map materials: rebuild aim_redline with the installed game's stock materials,
   verify collision remains unchanged and review load/render cost.
5. Weapon actions: extend insertion/transition coverage where native evidence
   supports it; record unverified empty/silent branches separately.
6. Impact and audio feedback: refine material-dependent presentation and timing.
7. Opponent animation: improve turning and stance transitions without changing
   authored hitbox geometry or granting bots hidden information.
8. Frame pacing: expose actionable measurements in Chrome for the user's PC.
   Local software WebGL checks cannot measure that PC's physical input latency.

The first implementation pass is validated locally. Remaining measurements and
limitations are recorded below; this list is not a claim of Source 2 equivalence.

The first implementation pass is described in `native-presentation-followup.md`.
It covers effects, weapon projection/motion, retained stopping evidence, the map
rebuild, reload event deadlines, material decals, directional animation blending
and exportable frame diagnostics. Further live captures are still needed for
additional reload branches and full motion/particle comparisons.

The second pass completes the held-reload gate, expands installed normal/empty
magazine insertion markers, and drives reload foley/opponent gestures from
actual animation progress. `native-reload-clock.md` retains fresh live M4A4
comparisons and distinguishes measured behavior from shell-phase estimates.
For item 8, the user's Chrome/4090 check reported stable 500 FPS and 2.1 ms frame
time while firing on aim_redline. Browser diagnostics are implemented; physical
mouse-to-screen latency and complete Source 2 rendering equivalence are not
claimed. All eight areas now have an implemented, testable improvement or a
retained native comparison showing that further numerical tuning was unwarranted.

## October 9 feel audit follow-up

Pass 11 of `native-gameplay-comparison.md` fixes ground/air displacement order
and the bunnyhop momentum restore gate using the current server's native
arithmetic. Counter-strafe and release accuracy times remain unchanged; a new
direct velocity/input recording is required to tighten their existing demo
comparison. The camera's crouch interpolation remains a separate open item.

Pass 12 preserves physical held fire through range reload/deploy, backed by the
current native item dispatcher and reproducible before/after probes. Released
early taps do not queue a later shot. Native early-press schedule preservation
still needs the prepared recording; the existing schedule policy is unchanged.

Pass 13 replaces the estimated R8 windup with the current server's thirteen-tick
deadline (203.125 ms), backed by 62 bounded native arithmetic cases. Full R8
animation and physical input latency remain outside that comparison.

Pass 14 aligns follow-recoil and range guides to the camera's rendered recoil
sample and verifies the client pixel conversion. The former stale sample could
differ by 4.01 pixels in a deterministic 240 Hz AK spray. The 0.22 weapon fraction,
landing weapon dip, crouch eye curve and exact framebuffer/DPR parity remain
unverified; no tuning was made without evidence.

Pass 15 refreshes current weapon parameters and the AUG's reload controller,
both viewmodel variants and audio cues: lock 3.766667→3.2 s, insertion
1.566667→1.4 s. All 2,730 weapon and 108 tagging values now match the export;
older binary/cosmetic provenance remains explicitly separate.

Three targeted browser specs now validate real captured input, held-trigger
continuity and rendered camera/follow recoil. Response probes report handler,
simulation and render-submission time rather than physical display latency.
See `cs2-feel-audit.md` for the before/after/commit table and exact remaining
capture needs. The prepared four-sequence native recording plan is in
`../native-audit/feel-capture/feel-capture-plan.json`. The user approved native launches for the independent re-audit below.

## Independent re-audit from c488943 (ongoing)

Pass 16 retains fresh native runtime settings and distinguishes unavailable legacy
command names from verified values. New movement, combat and animation benches
compare primary native evidence before consulting earlier claims. Offline native
recordings are now authorized and underway; no unverified feel adjustment is
justified by a hypothesis alone. Full requested inventory remains the scope.

Current priorities: airborne duck/hull trajectories; tick order of fire-inaccuracy
and recoil recovery; native versus imported clip poses and timing; footstep audio
onsets against demo movement; presentation and event-to-render probes. Remaining
model, animation, damage, collision and input items require their own evidence.

### Independently measured corrections, passes 17–19

- Shared movement: recorded standing/crouched launch distinction, immediate ±9u airborne hull changes, and separate 90u/s duck camera offsets. Native fixture replays every sample; rendered-client interpolation and full terrain parity remain open. See [movement inventory](reaudit-movement.md).
- Held recoil: impulses now belong to exact schedules, with processing-time presentation sampled afterward. Fresh eight-shot AK error falls .338199°→.00000239°. Accuracy penalty/index tick ordering is corrected by the following pass. See [combat inventory](reaudit-combat.md).
- R8 asset: compose charge deltas over the native graph’s firing-start pose and preserve constant object channels. Both variants rebuilt; arm/finger error752.262mm→.02743mm. The earlier mount-only reference was insufficient and is superseded. Native graph reconstruction, materials, effects and broad runtime presentation remain bounded in the [animation inventory](reaudit-animation.md).
- Offline native capture permission is granted. Demos and game-output audio are retained; initial video has large presentation-timestamp gaps, so a nominal 60fps header must not be used for frame-accurate claims.

The consolidated [independent inventory](cs2-reaudit.md) covers all requested
mechanics with implementation commits and exact limits. The [accuracy/index correction](reaudit-accuracy.md) now matches 39,648 native
invocations and 41,584 accepted demo ticks in production replay, with both-engine
shot/reload ordering tests. The [footstep correction](reaudit-footsteps.md) replaces
distance-based cadence with the native speed-gated command clock. Special-state
accuracy, material/ladder/water sound paths and physical presentation remain
open. R8-specific follow-up is excluded at the user’s request.


### Camera clocks, pass 22

The [current camera investigation](reaudit-camera-clocks.md) confirms the native
sampler/impulse arithmetic but overturns the assumption that the firing deadline
alone supplies the camera anchor. 52 AK shots expose separate command-history
storage and decay clocks. No production feel change is justified until native
attack-history selection, tick-domain state and client history construction map
to trainer input. 386 continuous scene frames now have measured rotations, but
variable game-frame timing still prevents a complete rendered comparison.
Next capture/trace must retain per-shot history/resolver metadata and per-frame
game/prediction clocks; fitting a constant millisecond offset is excluded.

### Presented-frame history and weapon model, pass 23

[Client history](reaudit-client-history.md) now traces first attack-down to the
last published frame and its predicted player clock. Runtime phase/publication
and resolver metadata remain necessary for a camera-clock correction.
[Weapon recoil](reaudit-viewmodel-recoil.md) replaces the unmeasured .22 local
rotation with the native .325 world-angle term converted into weapon-camera
space, including damage punch. Native executed fixtures cover 108 orientations.
Procedural bob/sway outside the graph is now confirmed; complete movement,
landing/zoom, animation and rendering parity remain open.

### Airborne weapon motion, pass 24

[AIR motion](reaudit-viewmodel-air.md) now matches native per-invocation state,
world drop and pitch/clamp/recoil ordering in Range and Duel. Nine native
sequences and 944 live state pairs support the correction; the 812-case engine
bench removes 20.32 mm/.4° of missing airborne motion. Existing movement sine
bob, prediction-phase mapping, pause/lifecycle and rendered landmarks remain
partial. Full bob needs the evaluated native velocity cache and body-rotation
writer; look sway needs its history/caller clocks mapped to trainer input.
The approved capture and read-only sampler are retained. No R8 work resumed.

### Procedural motion inputs, pass 25

[Motion inputs](reaudit-motion-inputs.md) reproduces native bob from the actual
selected velocity cache. Raw velocity does not reproduce it. Large stationary
turns prove scene yaw changes and differs from aim yaw; its writer/update law
remains unbound. New sway captures confirm exact history arithmetic and distinguish
writer, source-interpolation and HUD clocks. No production feel change is justified
until those inputs map to trainer simulation/presentation. The first capture
sequence's incorrect W/S movement assumption is explicitly excluded.

### Loaded-shell attack interruption, pass 26

Current native class/caller evidence separates the reload-start attack lock from
shell insertion and outro playback. Nova/Sawed-Off use .466667 seconds and XM1014
.6 seconds. Once ready with an existing shell, primary fire changes directly to
the shooting action. The paired-engine bench exposes both premature early held
fire and an unnecessary roughly 200 ms delay on a ready press. The correction
uses the native initial lock and cancels directly when the attack executes.
Empty-start reloads, insertion/full-completion clocks and later silent phases
retain their explicit approximation. MAG-7 remains a magazine reload.

### Native motion producers, pass 27

[Motion history](reaudit-motion-history.md) now binds the body writer to the
movement service's embedded animation state. Its prepared aim includes the
aim-punch service result, and every update starts from current absolute scene
yaw. Idle, movement and turn states have different rules. Static timing factors
do not establish caller cadence or resets.

The velocity probe executes 38 bracket searches and six native history writes,
including same-tick replacement and rewind removal. Optional capture readers
now retain both velocity rings and body state. Production bob/sway remains
unchanged pending a live comparison of history construction, body transitions
and their prediction/presentation phases.

### Live motion state and scoped clocks, pass 28

[Motion runtime](reaudit-motion-runtime.md) now compares actual velocity rings:
711 selected-cache snapshots match exactly. Eleven other retained cache values
belong to an earlier frame/history phase. Native body dispatch matches captured
Move/Start/air yaw; stationary turn clocks still require the active movement
scope. Static callers temporarily use controller tick-base time, restore global
clocks afterward and publish the last-command field after yaw postprocessing.
Capture controller tick base and active processing identity before mapping this
state machine or its evaluated scene transform to SprayLab. No bob/sway tuning
is supported by selecting a different diagnostic clock for each sample.

### View action clocks, pass 29

[Animation timing](reaudit-animation.md#pass-29-action-clocks-evidence-only)
confirms current resource identity for 20 AK/AWP/Nova/XM clip entries and
unscaled fire playback. The trainer's AK reload insertion pose trails its own
ammo event by 15.069 ms; shell phase and delayed-model draw retimes are measured
separately. Bind the current first-person graph's external elapsed-time/rate
caller and transition clock before correcting any native timing claim. A fixed
node multiplier alone does not prove the wall-clock playback rate.

### Captured controller clocks and lifecycle, pass 30

[The new motion window](reaudit-motion-controller.md) measures controller tick
base beside body state. All 372 turn-loop projections match that independently
captured seed, plus all Move/Start/air projections; nine Idle samples require
a separately labeled transition diagnostic. Processing-marker coverage is too
sparse to associate each sample with a call. Current bytes now bind constructor
initialization, tick increment/postprocess/publication order and the separate
evaluated-transform consumer. Full bob still needs invocation association,
existing-instance reset ownership and transform-history evaluation inputs.
The velocity check adds 1,427 exact selected-cache comparisons without tuning.

### First-person graph time and AK reload, pass 31

The current Arms AG2 elapsed-time path is now bound and passes 40 native clock
cases. Ordinary AK graph wiring has a 1× clip clock and no reload-lock scaling.
Its magazine reload now advances in authored seconds, holding the endpoint
through the remaining lock. The measured frame-33 crossing changes from
1.115069 s to 1.1 s on the existing action clock. Ammo/readiness and existing
fades are preserved. Exact action onset/display phase, other weapon paths,
shell transitions and delayed-model draw playback remain separate work.

### Published input and motion histories, pass 32

[Two approved windows](reaudit-presentation-history.md) retain 4,861 guarded
snapshots. All 4,088 input-entry occurrences match published clock pairs;
three first-press camera anchors match selected player pairs, and eight
demo/live anchors agree exactly. Five held follow-ups match a conditional
float32 cache replay, without proving resolver branch or entry-clock identity.
Establish the corresponding trainer render/input clock before changing camera
timing; no fitted delay is supported.

The velocity offset producer and cache invalidation are now bound; all captured
active rings have count one and a 1/64-second offset. Transform history uses a
separate layout and shared current record. Its first live reader rejected the
actual skeleton subclass; the corrected, narrowly bound gate remains awaiting
live validation. Full motion still needs invocation inputs, latch/consumer
ordering and existing-instance resets. Production remains unchanged.

## Pass 33: draw rate and accepted transform history

[Report](reaudit-draw-and-transform.md). The concrete immediate Arms caller and
four native graphs justify authored-rate ordinary AK/AWP/Nova/XM draws. Late
attachment no longer compresses the clip into the remaining lock; native onset,
idle/readiness ordering, fades and pickup routing remain separate work. The
new capture accepts 2,602 transform rows and retains an exactly reproducible
numeric fixture, with invocation arguments and writer ordering still open.
Serialization metadata closes one-entry reduction for the sampled first presses;
typed movement callbacks establish the ordinary interior held-deadline clock.
The full mechanic inventory remains active, including model/graph/renderer work.
R8 remains excluded. No camera-only or bob/sway tuning is inferred from these
new motion and command observations.

## Common-weapon and movement corrections, passes 34–36

The [reload admission correction](reaudit-common-reload.md) makes early R taps
and held retries respect the current native firing deadline and attack priority
for AK/M4/AWP/Glock/USP/Deagle. The [crouch accuracy correction](reaudit-duck-accuracy.md)
replaces the 95% amount approximation with the native stance flag in both engines.
The [common draw correction](reaudit-common-draw.md) preserves authored playback
for M4s and common pistols after delayed model loading. Numerical controls and
limits are retained in each report; these do not establish complete rendering
or physical input parity. Further priority stays with common-weapon behavior;
shell/revolver work and deeper transform/resolver investigation remain deferred.

## Current Deagle reload events, pass 37

The [Deagle resource comparison](reaudit-deagle-reload.md) establishes that its
normal-reload mismatch consists of two event markers. Magazine-removal audio
moves 133.333 → 333.333 ms, and the silent window gains one authored frame.
All decoded motion data and the empty reload remain unchanged. The actual
hearing/browser consumers agree across 42 pairs; 78 of 84 cases are unchanged
controls. Current native runtime silence coefficients, action onset and event
delivery still need independent evidence. This local correction includes a
private deploy audio manifest whose hash must be checked when delivery proceeds.

## Glock attack clocks, pass 38

The [Glock correction](reaudit-glock-timing.md) removes the shared firing delay
after a mode switch and adds the native secondary cooldown to actual shots.
Pending burst rounds and eligible primary input retain priority; held secondary
retries when ready in both engines. All 12 paired input scenarios agree on shot
and mode-transition times, with six unchanged normal shot/mode controls. Current
code and vdata support the bounded rule. Native live command timing, float32
clock normalization and upstream player/equip gates remain separately unverified.

## AWP scope recovery, pass 39

Commit `81f9c27`: the [AWP clock report](reaudit-awp-clocks.md) separates attack readiness from
processing-time FOV onset. Ordinary queued shots retain their existing schedule;
rescope checks current primary readiness/ammo and starts its100ms transition
when processed. Twenty actual-engine cases retain identical shot schedules,
with ten unchanged controls. Native historical/fresh context selection and
reset invariants remain outside this correction. Native postframe cadence,
client presentation and simultaneous primary/secondary ordering need separate
evidence. The pass38 Glock scheduled-time label is corrected without rewriting
its original evidence or changing the published processing-time comparisons.
