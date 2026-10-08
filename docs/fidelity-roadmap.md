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
