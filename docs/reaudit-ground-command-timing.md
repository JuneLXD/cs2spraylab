# Ground acceleration and stopping timing — pass 48

Player ground movement now retains the native movement segment across the
trainer's 128 Hz updates. Friction, acceleration work and the final stop branch
are evaluated from a bounded segment checkpoint. An intervening update exposes
a prediction; it does not turn that prediction into a second native segment.
Actual direction, walking, crouching, jumping and yaw edges close the preceding
segment. The 128 Hz weapon/action clock remains unchanged.

This implements the discrepancy measured in [pass 47](reaudit-ground-start-stop.md).
The reference is the installed server with SHA-256
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The original guarded native readers and their proof manifests remain unchanged.
The compact test fixture pins both completed native captures by hash; a separate
small scoped replay checks 30 cases/390 native rows without artificial half-tick
boundaries. The old scoped half-segment fixture still tests the raw solver.

## Measured change

All numbers below are observations at shared 15.625 ms command boundaries,
not physical key latency or exact times between observations.

| Mechanic | Before (live e99fd05) | Corrected behavior and evidence |
| --- | --- | --- |
| Initial AK running acceleration | 15.22656 u/s after 15.625 ms | 18.47656 u/s, matching native |
| AK first observed 99% running speed | 546.875 ms | 531.25 ms, matching native |
| AK first observed 99% walking speed | 406.25 ms | 390.625 ms, matching native |
| AK first observed 99% fully crouched speed | 1,343.75 ms | 1,281.25 ms, matching native |
| Release, restart and counter-strafe curves | The frame split changes the trajectory | Cumulative command endpoints match the saved native curves across seven priority weapons and three stances |
| AWP moving rescope | Held intermediate correction could force a false zero and give fresh shots zero movement contribution | Both real engines retain moving velocity and agree on the fresh shot's movement ratio |
| Movement tutorial | Repeated short updates rebuild ground state | Uses the same segment checkpoint and matches Range braking |

## Integration and limits

The weapon speed and scoped-walking flag are sampled together at a movement
segment's start. Range captures them before advancing weapon events, as Duel
already does. A scope recovery cannot change motion that has already elapsed;
the new cap enters the next movement segment. A zero-duration call never applies
friction, reclamps speed or consumes a pending movement segment. Shots still read
the current published velocity. The cap policy follows the retained native
movement-before-remaining-weapon-events ordering; the full native moving-rescope
dispatcher has not been executed end to end.

Each checkpoint holds only its origin, input, sampled cap and latest published
kinematics, plus a value signature of reachable collision geometry. It contains
no parent simulation, weapon state or recursive checkpoint. Reset, teleport,
external velocity/tag changes and changed nearby collision geometry invalidate
it. Jumping, stance transitions, water, ladders and moving supports continue
through the existing contact solver. Generated bots keep their explicit steering
segments on each AI update; replaying their preceding steering against a newly
generated avoidance world caused navigation regressions and is not used.

The fixed-state native fixtures supply processed wishes, stance, speed caps and
command boundaries. They verify acceleration and braking arithmetic and timing
under those conditions. They do not prove physical key-to-screen latency, native
collision parity, crouch transition timing or every possible weapon/input event
combination. Between-boundary positions are trainer predictions. Reaching zero
movement inaccuracy (about 203 ms in the running release examples) is still
distinct from reaching complete standstill.

## Reproduction

Run `tools/reaudit-ground-start-stop-trainer.mjs` with `--command-movement`,
`--trainer-half-steps`, `--expect-match`, the saved native input and its pinned
SHA. This checks the actual actor wrapper, Range and Duel cumulatively without
copying native endpoints into the trainer. Repeat with the long crouch capture.
`tools/reaudit-ground-command-fixture.py` compacts these two saved inputs;
`tools/reaudit-scoped-command-native.py` creates the small scoped fixture from
the frozen guarded oracle. All commands require the host memory guards.

Permanent tests cover native trajectories, irregular subdivisions, real key
edges, immutable prediction, resets, changed obstacles, jumps/crouches, bounded
history, both AWP zoom levels, and actual fresh rescope shots. Browser checks
cover physical DOM key bindings, initial acceleration, release accuracy and full
stop, scoped walking/prediction in both modes, and scope recovery presentation.
Exact validation results and hashes are recorded in the companion evidence
ledger. No game, recording, Ghidra analysis or asset rebuild is required.

## Final validation

The [verified ledger](evidence/reaudit-ground-command-validation.json) pins 71
application input files and the completed raw reports. All 84 cumulative
actor/Range/Duel cases pass (16,128 observations): maximum velocity error is
`2.85e-14` u/s and maximum position error is `2.56e-13` units. Both are numerical
unit-conversion roundoff. All 32 AWP rescope cases agree between the engines;
all 16 fresh shots retain nonzero movement contribution, with identical ratios.

TypeScript passes. The full unit run has 2,862 passes and only the known missing
`public/models/ak47.json` fallback-asset failure. Four isolated Chromium cases
pass: startup/release/complete stop (14.2 s), Range scoped movement (11.2 s),
Duel scoped movement (4.8 s), and AWP recovery presentation (11.1 s). Source files
were frozen throughout browser validation. Independent read-only review found
no remaining blocker; collision callbacks must remain pure, and mutable worlds
must be supplied through `ActorEnvironment` to participate in invalidation.

Tests and browsers used a 2 GiB hard cap; native/engine probes used 512 MiB.
All had zero swap, one CPU, and serialized execution with auto-deploy paused.
Two slow draft unit runs were manually interrupted while investigating a whole-
arena serialization mistake in the contact signature. That mistake was fixed
and covered by a size regression; the final full suite completed in 109.81 s.
No process hit its memory cap during this implementation pass.

### Integration with the concurrent main update

Movement implementation commit `5d830f1` was then merged with the already-pushed
main update `2314ea5` (Pop hit counts/peek wall/background and aggressive bots).
Only the appended changelog sections conflicted; both were retained. The Pop
environment and all existing feature changes are preserved.

The [combined-source ledger](evidence/reaudit-ground-main-integration.json) pins
the resulting 71 application inputs and fresh checks. TypeScript and 2,870 unit
tests pass, with the same single known missing-model failure. All 84 native
curve comparisons and 16 fresh rescope shots still pass. Four isolated Chromium
cases pass on this combined source: stopping, scoped movement in Range and Duel,
and the complete Pop interaction test including its peek wall. The earlier
scope-recovery presentation test remains pinned to `5d830f1`.

The main update's existing deployment and release verification were allowed to
finish before the combined validation began. All subsequent checks used the same
serial 512 MiB/2 GiB limits; the merge is intended for one push/build, not separate
builds for each earlier audit commit.
