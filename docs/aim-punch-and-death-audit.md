# Aim Punch And Death Presentation

## Damage Punch Evidence

Read-only audit of the installed CS2 build 2000922, patch 1.41.8.8,
SourceRevision 11064488 (September 30, 2026).

`server.dll` SHA-256:
`3541e46a3193fcf1151e97ce19cd4daf86c5fdb2889033c2bab1d4cc7f555b9c`.

`tools/verify-aim-punch.py` hash-pins the file and emulates bounded arithmetic
blocks offline with Unicorn. It never loads the DLL, hooks a running process,
or interacts with CS2. It captures 64 hitgroup cases and 49 recovery samples in
`src/range/aim-punch-native-fixture.json`.

- Damage branches: RVA `0xa82860`, table `0xa82e90`.
- External angle service: RVA `0xa386a0`.
- Recovery sampler: RVA `0xa38bc0`; verified decay block `0xa38e0d..0xa38e63`.
- `mp_flinch_punch_scale`: default 3 in this build.

For damage already scaled by distance and hitgroup, BEFORE armor absorption:

| Hit | Raw native pitch magnitude | Roll |
| --- | --- | --- |
| Chest/stomach, armor present | `min(12, damage * .005 * 3)` | 0 |
| Chest/stomach, no armor | `min(12, damage * .033 * 3)` | 0 |
| Bare head | `min(36, damage * .2 * 3)` | random `damage * 3`, capped +/-27 |
| Helmet head | 0 | 0 |
| Arms/legs | 0 | 0 |

The helmet flag is the native head-punch check, independently of remaining
armor points. Torso checks armor present before the hit, including a hit that
depletes it. This does not prevent damage or movement tagging.

Recovery uses a 128 Hz three-axis cache: exponential decay `exp(-8/128)`, then
radial subtraction of `18/128` degrees. Native sampling clamps axes to +/-89,
zeros an output whose magnitude is below .03125, and doubles angles for
physical aim. Trainer pitch is up-positive, so native pitch is negated.

## Integration

Each combat actor owns `DamagePunch`, independently of weapon recoil. Both
player and AI feed it into the same physical shot kernel. It is not extra
spread, a changed recoil table, or cosmetic-only shake. Roll rotates the
spread basis. The player camera receives the full external punch; the existing
weapon-recoil camera fraction is unchanged. Follow Recoil includes it once.

Actor-owned storage is separate, but recovery is not independent: the damage
state records the difference between the combined native three-axis cache and
the unhit recoil cache. This applies radial decay once while spraying rather
than incorrectly subtracting the linear term from both contributions. Existing
no-damage recoil samples remain unchanged. Small damage components are retained
when the combined recoil cache is above the native output threshold.

All shots for a simulation tick resolve before incoming punch is applied,
preserving mutual fire and actor-order independence. Successive hits stack.
Switching weapons does not clear punch; pause freezes it; new actors reset it.
Bots correct displaced aim through their bounded aim motor, not instantaneous
recoil cancellation. A separate seeded RNG stream preserves weapon randomness.

Valve's [April 21, 2026 update](https://store.steampowered.com/news/posts/?appids=730%2C240%2C10%2C80&enddate=1776897650&feed=steam_community_announcements)
explicitly separates full external camera punch from its immediate effect on
bullet trajectories.

This verifies local damage/recovery arithmetic, not every networking/animation
detail of live CS2. Sub-tick view prediction linearly interpolates cached angles;
Source 2 interpolates rotations. No live-game parity claim is made.

## Death Assets

### Runtime fall rework (October 10, 2026)

The live contact rig now holds hips, chest, shoulders and neck in one frame,
preserving the spine curve captured at death. The old hip/shoulder frames shared
only one point, allowing the shoulders to fold independently through the body.
The neck now has its own contact joint, and its bone aims from neck to head;
aiming from chest to head put the rendered skull far from its solved position.
One shared torso rotation avoids amplifying contact errors into spine twists.

Standing hip and knee flexion is limited more tightly, with limits clamped to
the initial pose so crouched and running victims do not snap upright. A bounded
height-weighted push initiates a tip in the shot direction while preserving
incoming movement and hit-specific impulses. This is cosmetic tuning, not a
claim of Source 2 ragdoll parity. Gravity, damage and live collision are unchanged.
Settling measures movement between solved poses and stops at the same physics
step at every render rate; contact edits to the velocity history no longer keep
a stationary corpse awake.

The follow-up adds 13 solid torso/limb/hand/head volumes. Closest points along
non-adjacent capsules exchange mass-weighted separation corrections; endpoint
spheres alone could miss completely intersecting limbs. Anatomically adjoining
volumes are excluded, while a slight overlap in the imported holding pose eases
out over .18 seconds. The same thickness feeds floor and prop contacts. Crouched
falls retain an upper-body push and a small lateral lean to avoid balancing on a
hand. Rendered capsule separation is checked as well as solver/bone alignment.

The anatomical-joint follow-up corrects a limitation those contact checks missed:
distance limits admit both forward and backward flexion, and independently aiming
the two bones with shortest-arc rotations twists the skin at the knee or elbow.
Each limb now has a signed hinge plane transported with the torso and upper limb.
Knees allow 0–110 degrees of flexion, elbows 0–150, with bounded hip/shoulder swing
and socket roll. Both bones use the same hinge frame, preserving their captured
anatomical alignment. Hip swing includes the neutral downward direction and the
initial crouch, so the legs can relax without forcing the victim upright. These
are cosmetic limits, not a reproduction of native Source 2 joint constraints.

Regression checks measure actual local knee/elbow rotations throughout the fall,
including straight initial knees, and verify fixed-step determinism. The real-model
preview also measures signed flexion, sideways twist, and head rise at 60 Hz,
alongside body contacts and bone/solver alignment. Visual review includes standing,
side and crouched falls; the user-supplied twisted-leg screenshot remains the
reason for checking the skinned result rather than only point separation.

Final verification: 61 focused unit tests and TypeScript passed. All 50 actual-model
cases settled by 3.6 seconds. At 60 Hz, maximum sideways knee/elbow rotation was
0.94 degrees, maximum bone/solver error 3.58 cm, and maximum post-blend body-volume
overlap 1.51 cm. Head rise stayed below 4 mm. Local evidence is retained under
`native-audit/reports/death-joints/` (`variants-final.json`, `units-passed.log`,
`types-final.log`, and the final skinned captures).

`tools/death-preview.html` is a lightweight Vite preview with standing/crouched
and front/side/rear replay controls. `tools/capture-death-preview.mjs <out>` captures
the real target mesh and motion bank. `tools/verify-death-preview.mjs <report.json>`
checks 50 falls including head/leg hits, gait phases, rotated/pitched poses,
airborne starts and a raised platform. Run browser tools one at a time under the host memory cap, with the
preview served at `http://192.168.0.18:5184`. The older baked assets below remain
the fallback when a contact world is unavailable.

The three previously imported death clips contain severe joint discontinuities
in the DMX-derived source, not only after glTF optimization. For example,
`death_chest_b` rotates `spine_1` by about 179 degrees in one 30 Hz frame.
Their durations are 2.50, 1.47 and 2.37 seconds. Compressing entire clips to .55
seconds amplified those artifacts. Restoring speed alone does not fix them.

The SAS model's PHYS metadata contains 15 capsule/sphere bodies and 14 joints,
including a 5-unit head sphere and 7-unit pelvis/torso capsule radii. These are
the reference for offline constrained falls, not a claim that the browser runs
Source 2's ragdoll solver. Native death clips have no ragdoll handoff event.

Captured hit poses must blend inside the animation mixer. Post-mixer bone edits
leave constant tracks stale in Three.js PropertyMixer. Preserve that regression
test, support-surface checks, and immediate hit/death feedback.

The shipped replacement bank contains six 1.4-second, 30 Hz clips: standing
and crouched backward/side/forward falls. Incoming lethal shot direction selects
the fall in actor-local space; the standing/crouch weights are frozen at the
victim's stance. The first .08 seconds blend from the captured hit pose. Playback
uses real seconds and holds its endpoint. The player camera uses a gentler .7
second fall with a prompt weapon drop. Airborne victims retain vertical momentum
in the support-aware root trajectory.

Blender 5.2.1 LTS Bullet uses the native 15-body / 14-joint reference, native
mass and pose proportions, converted angular limits, and 800 units/s^2 gravity.
Self-collision is disabled for the overlapping weapon-holding start poses.
The reconstruction preserves local bone lengths and distributes the torso
rotation over the native spine chain. It is not a live Source 2 ragdoll: arbitrary
prop/limb collisions, network presentation and per-hit impulse magnitudes are
not reproduced. Existing support contacts prevent floor/raised-surface clipping.

PHYS text SHA-256:
`8993e5f611bc537ff60c994b3b0c49345cfcb7ae379de9b91fb8e271c1f62ce9`.

`tools/build-death-motion.mjs` bakes and validates a candidate before publishing
the JSON. `tools/build-duel-motion.mjs` incorporates it into the 99-clip motion
library. The six falls have no local translation drift, under 54 degrees of
joint rotation per 30 Hz frame, under 3 cm solver anchor separation, and reach
a continuously low head/hip pose in .40-.94 seconds. Unsafe native death tracks
are retained for source comparison but not selected when the replacements load.

Commands (local CS2, Source2Viewer and Blender are required only to rebuild):

```powershell
node tools/build-death-motion.mjs --preview
node tools/build-death-motion.mjs --validate-only
node tools/build-duel-motion.mjs
node tools/check-assets.mjs
```

Verification: 64 native hitgroup fixtures, 49 native recovery samples, shared
player/bot ray tests, finite bot correction, pause/switch/reset checks, camera
and Follow Recoil browser alignment, all nine standing/partial/full crouch
death variants, raised surfaces, and immediate hit feedback at 30/240 FPS.
