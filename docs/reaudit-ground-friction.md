# Stopping, counter-strafing and first-shot accuracy — pass 44

The movement correction carries the native friction cache between segments and
commands, preserves the separately rounded acceleration work, subtracts unused
friction from counter-strafe acceleration, and applies the native low-speed stop
branch. Range, Duel and the movement lesson share the corrected actor path.
The simulation still runs at 128 Hz; native 64 Hz command boundaries and saved
interior fractions subdivide its movement work.

Before the correction, the supplied M4/Deagle/Glock/USP release cases reached
the movement-accuracy boundary one 128 Hz step late. In the larger combined
standing replay, velocity differences reached 23.54681 u/s and 164 evaluated
rows disagreed about whether movement inaccuracy was zero. The corrected
actor matches all 462 cumulative combined trajectories, including counter-input,
diagonal starts, near-zero reversals and explicitly supplied speed-cap cases.

This is a comparison with guarded execution of selected instructions from the
installed Linux server, under declared inputs. It does not claim full command,
collision, physical input latency or live recording parity. Fifteen retained
runtime release windows failed the predeclared flat-ground/no-input eligibility
gates; none was used for fitting.

## What the native evidence establishes

The current server SHA-256 is
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
Class/schema metadata and bounded instruction reads bind the state and callbacks.
The portable proof records the exact ranges, dependencies and fail-closed guards
in [the native evidence ledger](evidence/reaudit-ground-friction-native.json).
Raw addresses stay in the reproduction tools and evidence artifacts.

- Speed is quantized on a 20-bit grid spanning −16384 to +16384, with a
  separately encoded exact zero. Friction uses that control speed, which can
  remain cached while the actual velocity changes.
- Changed processed horizontal wish can establish the cache. An existing cache
  survives segments at different fractions; at its saved fraction, the old
  active flag and newly quantized speed determine whether it clears or refreshes.
- Command preparation clears a marker, cache writes set it, and command
  completion promotes it to the persistent active flag. The segment producer
  inserts the active saved fraction into the command schedule.
- The movement callback copies the processed horizontal wish after each
  nonempty segment, before the next input edge. This is the speed-scaled vector
  before normalization, not just a unit direction.
- Friction updates velocity and acceleration work separately. Unused friction
  reduces the acceleration budget. This includes zero actual speed with an
  active cache; forgetting that case made the draft restart too fast.
- Acceleration and the final ground cap also update work separately. The native
  pre-helper subtracts half that work before movement; the post-helper restores
  it afterward. Averaging rounded starting/ending velocities is not equivalent.
- After the pre-helper, a projected speed strictly below 1 u/s clears velocity,
  work and deferred velocity. Equality is a separate tested boundary.

The native accuracy slice independently consumes the resulting horizontal
velocity. It executes the current float32 movement normalization and zero branch,
using supplied speeds whose common-weapon getter bindings are separately proved.
Its 10,969 cases include 10,939
release endpoints and 30 threshold neighbors. Every one of the 98 supplied
release/profile sequences reaches zero movement contribution at the expected
boundary, before the exact-stop gate fires. Base spread and other inaccuracy
remain: **zero movement contribution does not mean a perfectly accurate shot**.
See [the accuracy evidence ledger](evidence/reaudit-ground-friction-accuracy-native.json).

## Actual before and after

The baseline is the real actor implementation at `e99fd05`, also unchanged by
the four preceding audit commits through `9ae6a49`. Reports preserve source
hashes, supplied inputs and all evaluated rows. No parameter or tolerance was
fitted to the results.

| Check | Before | Corrected actor |
| --- | --- | --- |
| Combined standing trajectories: 231 fixtures × two caller schedules | Maximum velocity error 23.546807 u/s; 164 movement-zero row disagreements | 462 cases / 10,332 evaluated rows; maximum velocity error 2.85×10⁻¹⁴ u/s; zero trajectory, cache-state or threshold disagreements |
| Combined derived uncollided position | Maximum error 2.542242 native units | Maximum error 9.06×10⁻¹⁵ native units |
| Release through complete stopping: 96 fixtures × two caller schedules | Missing cache and native work/stop integration | 192 cases / 19,914 evaluated rows; maximum velocity error 2.85×10⁻¹⁴ u/s; maximum derived-position error 3.88×10⁻⁷ units; zero state, accuracy-boundary or stop-boundary disagreements |
| Native release primitives | Unquantized stateless friction | All 10,980 native rows match velocity/work/helper/stop results exactly, plus 12 direct stop-gate controls |
| Supplied walking/crouching/tag-cap controls | Ideal decimal cap/midpoint assumptions in older tests | 3,909 native arithmetic rows exact; 248 cumulative actor cases / 7,688 rows, zero state/trajectory disagreements |

The two caller schedules either supply every native segment boundary or only
external input boundaries. In the latter, the actor must insert its own saved
cache fraction. Each trajectory carries actual actor state from the declared
initial state; it is not reseeded from the native result on every step.
Derived position sums native midpoint displacement without executing native
collision. The declared comparison bounds remain 0.00025 u/s and 0.00004 units
for combined motion, and 0.0002 u/s and 0.00003 units for release.

The initial isolated release bench supplies full weapon speed, a command-boundary
release and half-command observations. It establishes this specific boundary:

| Weapon speed group | Native supplied release | Previous trainer | Corrected trainer |
| --- | ---: | ---: | ---: |
| AWP unscoped, 200 u/s | 203.125 ms | 203.125 ms | 203.125 ms |
| AK-47, 215 u/s | 203.125 ms | 203.125 ms | 203.125 ms |
| M4A4 / M4A1-S, 225 u/s | 203.125 ms | 210.9375 ms | 203.125 ms |
| Deagle, 230 u/s | 203.125 ms | 210.9375 ms | 203.125 ms |
| Glock / USP-S, 240 u/s | 203.125 ms | 210.9375 ms | 203.125 ms |

These are first evaluated boundaries for the stated fixture, not universal
physical release delays. Interior release fractions are covered separately.
Real Range and Duel shooting tests check all seven weapons immediately before
and at the boundary and verify that the shot uses the current movement accuracy.

## Integration and regression coverage

Actor prediction keeps the input/cache immutable. Range explicitly carries the
state; Duel carries it with the actor result. Resets clear history, while weapon
changes preserve it. The movement lesson uses the same actor calculation.
Command/fraction splits retain a single jump edge and carry virtual stacked
riders between internal segments without moving a rider twice.
The command loop is iterative, so long action fast-forwards do not grow the
call stack; a 32-second comparison checks it against individual 64 Hz calls.

Permanent native fixtures cover quantization/cache choices, complete release,
stop-gate neighbors, friction overshoot at zero velocity, counter-strafe restart,
diagonal motion and cap/work corrections. Existing collision, crouch, movement,
weapon and view tests remain part of final validation. Three old cap assertions
now use exact native endpoints, backed by separately executed steps from their
supplied prior states. Those controls do not claim the native game produced the
preceding trainer stance ramp. The [seven-control fixture](evidence/reaudit-ground-stance-regressions.json)
also preserves four native midpoint controls. Two additional
[supplied-state controls](evidence/reaudit-ground-tag-diagonal-regressions.json)
check the tagged stop branch and diagonal float32 endpoint, replacing old
ideal-decimal expectations without changing comparison tolerances.

Final TypeScript validation passes. The full unit suite passes 2,660 cases;
the only failure is the pre-existing absent `public/models/ak47.json` fallback
fixture. Four isolated Chromium cases pass across three specs: release-and-fire,
Glock timing, and Range/Duel recoil. The
[validation ledger](evidence/reaudit-ground-friction-validation.json) verifies
70 bundled source identities, the native comparisons and all saved check logs.
These changes are committed locally for review; deployment remains pending.

## Reproduction and limits

Use the entry points in [the native package](../tools/reaudit-ground-friction-native/README.md)
and [the accuracy package](../tools/reaudit-ground-friction-accuracy/README.md).
A separately supplied matching server library is required; no native binary,
large saved executable span or raw full report is committed.

`tools/reaudit-ground-friction-cases.py` validates the canonical digest of every
native execution row, fixture, hook and guard count, then exports a stable
trainer input. Portable paths can differ without weakening content validation.
The trainer comparison tools bundle the actual source in the selected checkout.
Unit-fixture generators preserve their input and extractor identities. Original
v1/v2/v3 and failed draft reports remain in the local audit archive.

All probes run serially under 512 MiB, no swap and one CPU; app checks use 2 GiB
and one worker. Deployment must be inactive with at least 12 GiB available.
No game, capture, full analysis server or bridge restart was used for this pass.

Unverified boundaries remain: upstream physical input/command production,
complete collision and pawn-publishing callbacks, variable surface/base velocity,
full water/ladder/air lifecycle parity, and a clean accepted live release recording.
The supplied stance/tag-cap labels do not execute upstream native cap modifiers.
The accuracy oracle establishes the movement normalization and zero branch,
not the complete accuracy updater or all its coefficients.
