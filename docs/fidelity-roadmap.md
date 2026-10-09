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
