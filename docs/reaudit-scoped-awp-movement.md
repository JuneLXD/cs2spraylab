# AWP walking at either scope level — pass 45

The AWP used the native slow walking acceleration only at second zoom. Its
between-tick movement prediction omitted that rule at both zoom levels. Range
and Duel now use one scope condition for committed and predicted movement.

The earlier “second zoom” interpretation confused the active zoom level with
the weapon's configured number of zoom levels. The native rule tests them
separately: active zoom must be positive, configured count must exceed one,
and the float32 mode speed times the walking multiplier must be strictly below
110 u/s. AWP data declares two zoom levels and a scoped speed of 100 u/s, so
both active levels select the same acceleration branch. Crouch precedence and
the five-unit walking taper remain in effect.

## Current native evidence

The server SHA-256 is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
The [scoped evidence ledger](evidence/reaudit-scoped-awp-native.json) binds the
actual AWP class slots, both getter bodies and the named server data member.
The retained current AWP secondary dispatcher independently associates the
instance field with scope cycling: increment, compare with configured count,
wrap and pass the chosen level to scope application.

The new fixed static reader selects 3,640 bytes after verifying the whole
artifact identity. It stops if any planned getter or schema assertion differs.
The arithmetic replay reuses the preceding pass's 7,192 selected native code
bytes and existing hooks. Twelve additional private bytes supply the standard
data pointer and configured count; no new native hook replaces the branch.

Thirty declared fixtures cover both scopes, standing/walking/crouching, starts,
release, counter-input, diagonals and walking taper controls. Thirty-two profile
sequences execute 844 rows. All 15 scope-level pairs produce identical native
results. The guard observes 122,145 reads and 71,693 writes with zero unexpected
accesses. The mode speed, scope state, processed cap and dry-ground state are
supplied; native scope transitions and upstream cap construction are outside
this replay.

## Before and after through the actual trainer

The before snapshot is commit `5efcfb0`, which includes the verified ground
stopping correction from pass 44. The same hash-pinned native input and
comparison tool run against both source versions. All bundled source identities
are retained with the results.

Each fixture runs through the actual actor, Range and full Duel engines, with
native segment boundaries or only external input boundaries. The isolated actor
is an arithmetic control with an explicitly supplied scope flag; Range and Duel
use their real weapon-action predicates. Each trajectory carries its own state
after the initial seed. Prediction is checked before committing each engine
step and must leave velocity, position, history state and input unchanged.

| Check | Before | After |
| --- | ---: | ---: |
| Native acceleration/cap primitive rows | 844 exact | 844 exact |
| Cumulative actor/Range/Duel cases | 180 cases / 4,680 rows | Same cases and rows |
| Maximum velocity error | 24.5625008704 u/s | 7.11×10⁻¹⁵ u/s |
| Maximum derived position error | 3.7232678494 units | 3.56×10⁻¹⁵ units |
| Predicted positions | 816 mismatches in 3,120 checks | Zero mismatches |
| Cache-state disagreements | 360 | Zero |

Positions are sums of native uncollided midpoint displacement, not execution
of the game's collision routine. Comparison bounds were fixed at 0.00025 u/s
and 0.00004 native units before running; no coefficients or tolerances were fit.
The correction changes the scope predicate and its propagation, not the
already-matched ground arithmetic.

Sixty permanent Range/Duel cases check all native trajectories and their render
prediction. Eight additional cases fire the scoped AWP immediately below and
above the movement-accuracy boundary, checking that the shot consumes the
current native-matched velocity. A zero movement contribution still leaves base
spread and other accuracy penalties. These are supplied-state integration tests,
not new native execution of the complete accuracy updater.

Two single-scope rifle controls protect the configured-count guard. The final
TypeScript check passes; 2,730 unit cases pass, with only the pre-existing
missing `public/models/ak47.json` fixture failing. Four isolated Chromium cases
pass across three specs: real first-scope/walking input in both modes, AWP
rescoping and the M4 release-and-fire boundary. The
[validation ledger](evidence/reaudit-scoped-awp-validation.json) verifies all
70 bundled sources, fixtures, comparisons and check logs. Of 180 committed
trajectories, 156 retain their complete velocity traces unchanged. The correction
is committed locally as `4bb6223`. A subsequent
[moving-rescope check](reaudit-awp-movement-phase.md) exposed a combined stopping
integration risk; deployment of this batch is held.

## Reproduction and boundaries

Use [the native reproduction package](../tools/reaudit-scoped-awp-native/README.md)
with the separately supplied matching server library, then run
`tools/reaudit-scoped-awp-trainer.mjs` and
`tools/reaudit-scoped-awp-fixture.mjs` against its stable comparison input.
Every entry point rejects a changed input identity. Native binaries and large
raw reports remain outside the repository.

Probes run serially under 512 MiB; application checks use 2 GiB and one worker.
Both caps disable swap and limit CPU to one core. Deployment is paused and
headroom checked before each heavy command. No game, recording, full analysis
or bridge restart is used.

Unverified: physical input delivery, native prediction and scope-transition
timing in this movement replay, swimming and other movement modes, upstream
cap modifiers, native collision and a live scoped-walking recording. Other
weapons retain the configured-count guard; this pass does not certify new
uncommon-weapon trajectories.
