# Native motion producers — pass 27

Follow-up: [pass 28](reaudit-motion-runtime.md) validates the optional readers
live and executes body-yaw cases. The pending-capture statements below describe
the evidence available at pass 27; controller clock and reset boundaries remain
open after that follow-up.

This pass follows the inputs identified in pass 25 back toward their producers.
It does not change production bob or sway. Supplying a captured velocity cache
reproduces native bob, but constructing the equivalent cache from the trainer's
simulation remains a separate requirement.

## Velocity history

The current client's constructor and runtime type information bind the history
to `CInterpolatedVar<CNetworkVelocityVector>`. Its native writer accepts an
integer tick key and either a supplied value or the registered current value.
Its reader searches the selected ring after subtracting that ring's time offset,
unless the caller requests the offset-bypass mode. Tick keys convert at 64 Hz.

The [portable findings](evidence/reaudit-velocity-history.json) retain the current
client hash, bounded code hashes and numeric results. The probe checks 18
instruction bindings and three type/vtable bindings before executing 38 native
bracketing cases and six native writer cases in private emulator memory.
The only external writer shim is the verified `memcpy` import; allocation is
excluded by supplying a preallocated history.

| Supplied native case | Observed result |
| --- | --- |
| Requested tick 99.5 between tick 100 and 99 | Selects both samples, fraction .5 |
| Requested tick 100.5 with a one-tick history offset | Selects 100/99, fraction .5 |
| Same request with offset bypassed | Selects newest endpoint, clamped fraction 1; unclamped fraction 1.5 |
| Ring head at 0, 6 or 7 | Identical selected ticks and fractions across all nine requests |
| Secondary ring disabled/enabled | Disabled lookup fails; enabled lookup selects the secondary ring |
| Three components per stored value | Native bracket addresses select the correct component storage stride |
| Write tick 101 after 100/99/98/97 | New order 101/100/99/98/97 |
| Write tick 101 again with a different vector | Replaces that tick's value without growing the history |
| Rewind from 101 to tick 99 | Removes 101 and 100, replaces 99, retains 98/97 |
| Third consecutive identical vector | Writer returns “unchanged” while still recording its new tick |

The last observation distinguishes the writer's return flag from whether a
sample was inserted. A caller must not treat false as proof that the history
was untouched. The supplied ordinary flags match those retained in the preceding
capture, but the histories and tick arguments in this oracle are synthetic.

None of these supplied rings activates the separately gated three-point branch.
The native branch's existence does not establish that it is used by this local
player's velocity. Complete live interpolation, the ring-offset producer,
prediction rewind/caller order and cache invalidation remain unverified.

## Body yaw ownership

Current type information, named schema fields and caller instructions now bind
the ordinary writer to `CCSPlayer_MovementServices` and its embedded
`CCSPlayerAnimationState`. The movement service calls the writer after its base
post-processing. The writer reads its owner pawn's absolute yaw, prepares its
inputs, dispatches the body state machine and writes that same pawn's absolute
angles. This establishes the owner missing from pass 25.

The working yaw is reseeded from the current absolute scene yaw on every call.
The aim input combines the pawn's source angles with the aim-punch service's
result. An independent yaw accumulator driven only by mouse look would omit
both native inputs. [Static findings](evidence/reaudit-scene-writer.json) retain
the supporting hashes and the unverified branches.

| Native state or gate | Rule decoded from current instructions |
| --- | --- |
| Pre-dispatch safety gate | Aim/body separation above 70° moves body until the gap is 69° |
| Move, speed above 10, no plant-turn transition | Clamp wrapped body-minus-aim error to ±45°; approach aim by `(80 × speed / maxSpeed + 55) / 64` degrees per call |
| Idle, speed at most 10, aim/body gap at most 5° | Preserve body yaw |
| Idle, larger turn | Gap above 30° or native scaled aim change (`abs(currentNormalizedAim − previousAim) × 64`) at least 45 enters TurnOnSpotLoop |
| Stationary TurnOnSpotLoop | For nonnegative elapsed ticks, approach by `min(error, error × .125 × min((elapsedTicks + 1) / 12, 1))`; return to Idle when `abs(step × 64)` is below 16 |
| Airborne branch | Set working body yaw directly to the prepared aim yaw |

The schema separately names Start, Move, TurnOnSpot, TurnOnSpotLoop and
PlantAndTurn. Their transitions and timers prevent treating these rows as one
universal smoothing equation. These are static instruction-derived rules,
not a full state-machine execution or captured per-command comparison.
Fixed 1/64 factors do not establish invocation count or render cadence.
Initial state, transient overrides, full plant-turn gates and lifecycle resets
remain open.

The scene registration chain also binds transform getters/setters to the node's
interpolation state. Thus the body write and the evaluated transform consumed by
bob remain separate phases to measure. Existing recordings establish that the
scene yaw changes; they lack the newly bound body state and timers.

## Reproduction and next capture

From the repository, run:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-velocity-history.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scene-writer-proof.py
```

The probe writes full local evidence under
`../native-audit/reports/reaudit-velocity-history`. The native binary must match
the recorded hash. `tools/reaudit-velocity-capture-fields.py` decodes the same
private histories after every writer case, validating sample indexes against
the executed native writer rather than only a duplicate parser.

The existing game-only sampler now accepts `--velocity-history`. It reads bounded
ring metadata and numeric values, then double-checks the wrapper, headers and
entry metadata. The outer sampler repeats all fields and rejects a changed
snapshot. This option has not yet been used in a live capture.

The optional `--scene-writer` reader records the movement-service identity,
embedded body state, timers, prepared aim, produced yaw, movement inputs and
available clocks. It also remains pending live validation. Neither option
changes game memory.

The body proof verifies 28 current-byte ranges (19,757 bytes), 45 instruction
bindings, five classes, four virtual slots, 20 fields, seven state enum values
and 21 literals. These checks bind the static reading to this build; they do
not execute the body state machine.

The next approved capture must retain those rings beside the requested context
time, selected evaluated cache, stored velocity, source angles, body state and
HUD clock. Compare the native bracket and value computation with the observed
cache per transition, then identify the writer's actual tick/time source before
mapping it to trainer history. These findings alone justify no new delay,
interpolation factor or production motion change.
