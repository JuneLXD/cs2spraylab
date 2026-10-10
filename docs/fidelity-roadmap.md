# Native feel follow-up

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
