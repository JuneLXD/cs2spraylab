# Controller clocks and motion lifecycle: pass 30

This pass retains a new approved offline AK capture and compares its independently
recorded controller clock with native body dispatch. Production bob, sway and
body orientation remain unchanged. It closes the missing controller-field
measurement from pass 28; it does not establish a free-running body replay.

## Capture quality and identity

`native_reaudit_bob_006` contains 1,406 demo ticks, 2,589 accepted numeric
snapshots and 1,299 decoded video frames. Video timestamps have a maximum
17 ms interval and no gaps above 50 ms. That establishes recording availability,
not unique presented game frames or physical latency. Numeric snapshots have
a maximum 180.1 ms gap and cannot count every native invocation.

The current client SHA-256 is
`eba5345cb05eb4a72cc2942f6c25c89a44c0f9d8913b6de0af41c6e5e4bebcd1`.
The immutable snapshot SHA-256 is
`1583fed348b1d62a6c281bacd181b3d6df4eb82df24ffb1524be14c2f545c30a`.
[The numeric fixture](evidence/reaudit-motion-clock-fixture.json) preserves
named clocks, body state and velocity histories without addresses, process
identities or guard bytes. Its source sampler and helper hashes are retained.

Every accepted snapshot passes both body-owner and controller-class checks.
The sequence includes corrected T/G movement, F/H strafing, stationary and
moving turns, C crouch and Space jump. No bindings or display resolution changed.
AK ammunition stays at 30 throughout; this is a motion capture. Game and sampler
exit zero, `cl_showpos 0` is requested before quit, and owned Steam stops afterward.

The full session retained 19,789 rows and rejected 1,400 reads: 1,393 changing
history headers/metadata and seven lifecycle/read failures. The sampler now
retries normal concurrent-history changes after 2 ms rather than applying the
100 ms lifecycle delay. Both old and new versions reject changed reads. The
exact capture source is retained locally; later periodic error reporting is
not misrepresented as having run during this capture.

## Body clock comparison

The probe supplies either the recorded normalized global provider tick or the
recorded controller seed to the same native dispatch. Neither candidate uses
a fitted offset. Input yaw is reconstructed from retained float32 aim/error;
the comparison allowance derives from float32 spacing before observing errors.
State and timers are sampled after a call, so these remain supplied-input
projections rather than consecutive state evolution.

| Captured branch | Recorded provider tick | Recorded controller seed |
| --- | --- | --- |
| Move | 654/654 exact | 654/654 exact |
| Start | 25/25 exact | 25/25 exact |
| Airborne | 79/79 exact | 79/79 exact |
| Stationary turn loop | 345/372 within reconstruction allowance | 372/372 within allowance; maximum error 0.00003052° |
| Grounded Idle | 1,450/1,459 within allowance | 1,450/1,459 within allowance |

There are 226 unique controller-seeded turn-loop input/output comparisons.
The nine Idle exceptions are four distinct processed-command values immediately
after observed Loop→Idle transitions. A separate counterfactual using the
preceding observed Loop state reproduces yaw and the resulting Idle state in
all nine cases. It is a boundary diagnostic, not permission to rewrite captured
state or call the main projection an exact replay.

An output-derived ramp diagnostic agrees with the independently captured
controller seed in all 75 unsaturated samples; the sampled global provider
agrees in 50. This inversion is not a second source of runtime clock evidence.
Only one snapshot has an active-controller marker, and none has an active-pawn
marker. The recorded controller can be sampled after increment but before
postprocessing/publication. Inactive markers do not associate a retained result
with a particular invocation. [Full comparison summary](evidence/reaudit-scene-controller-runtime.json).

## Construction, publication and scene evaluation

[The current-byte lifecycle proof](evidence/reaudit-body-lifecycle.json) binds
the actual factory and constructor: new body state starts Idle, its ground and
stationary flags are true, and its named timers and prior values are zero.
This establishes new-instance initialization, not an existing-instance respawn,
teleport or equipment reset policy.

The normal controller-present command branch sets the processing marker,
conditionally increments and stores tick base when incoming frame delta is
nonzero, then seeds scoped movement time. Body postprocessing precedes processed
command publication. Inner cleanup clears the pawn marker and restores its
clock; outer cleanup clears the controller marker and restores the outer clock.
Alternative movement modes/virtual overrides are outside this bound branch.

A changed absolute-angle setter on a parentless scene node copies its angles
to absolute, declared-local and evaluated-local representations. Unchanged
absolute angles return early. A separate registered transform-history consumer
can later replace evaluated-local angles from its selected quaternion. Its
wrapped-angle equivalence check uses a strict float32 0.001° threshold. This
explains why the two kinds of scene angle cannot be treated as one accumulator;
it does not establish that consumer's actual call schedule in this capture.

The transform history carries a different record from velocity history. Its
selected local/world quaternion, origin, scale, parent and flags must be captured
with evaluation context before it can become a production input. Reusing the
velocity reader's layout would be invalid.

## Velocity cross-check

The same window adds 5,178 native bracket invocations over the captured rings.
All 1,427 snapshots whose observed getter branch selects cache zero match it
exactly, including 411 nonzero vectors. Twenty-one other comparisons retain
an exact cache time/vector from one frame earlier while the selected history
has changed and the current context selects stored velocity. None justifies
tuning interpolation or adding a fixed delay.

All rings still carry a 1/64-second offset; no case selects three-point
interpolation. The native bracket runs without helper shims, followed by
instruction-bound float32 two-point arithmetic; full cache invalidation and
metadata helpers are outside that replay.
[Velocity comparison](evidence/reaudit-velocity-runtime-007.json).

[The registered-writer trace](evidence/reaudit-velocity-caller.json) separately
binds the velocity timestamp callback. Velocity uses time class 1. Ring zero
uses rounded global current time; either ring also uses it when both prediction
gates are set. The remaining nonzero-ring branch uses the entity's class-1 time,
with global time as an exact-zero fallback. The queue forwards the resulting
integer tick unchanged to the writer. The class-1 schema name and outer latch
phase remain unbound. Dual-ring ring-zero writes take their value through the
interpolation cache; that branch was not observed in these single-ring captures.

The constructor sets ring offsets to zero, and a bound virtual setter accepts
an explicit offset. Its actual caller remains unidentified. One bounded entity
code-region scan found no direct reference to that setter or the outer latch
entry; it says nothing about virtual calls or other code regions. The captured
1/64 second is therefore runtime-produced, not a proven constructor default.

## Reproduce and remaining boundary

Run serially while deploy is inactive, with the host memory/CPU caps:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scene-controller-projection.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-velocity-runtime.py --fixture docs/evidence/reaudit-motion-clock-fixture.json --out ../native-audit/reports/reaudit-velocity-runtime-007 --summary docs/evidence/reaudit-velocity-runtime-007.json
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-body-lifecycle-proof.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-velocity-caller-proof.py
```

`tools/reaudit-motion-clock-fixture.py` regenerates the portable fixture from
the hash-bound local capture. The local `extract-motion-007.py` preserves the
full-session source and frozen window; raw per-row projections stay under
`native-audit/reports`.

The next required evidence is call-associated body entry/exit state and clock,
consecutive state transitions, existing-instance reset ownership, evaluated
transform history and velocity-offset/latch scheduling. This pass improves
the measured inputs without promoting polled state to a native call trace.


## Passes 30–31 integration validation

TypeScript passes. The full unit suite has 2,367 passes and only the documented
missing `public/models/ak47.json` fallback fixture failure. Both Chromium
camera/viewmodel cases pass. The actual Duel reload case verifies authored
seconds, endpoint hold during the lock, held-work continuity, return to idle
and nonoverlapping HUD controls at three viewport sizes. Its initial run
passed the animation assertions and exposed a stale four-group HUD count;
`DuelStage` contains three groups. The corrected test passes in 9.3 seconds.
Production UI behavior was not changed to accommodate the test.

Native/graph/fixture probes pass, and current source/fixture/probe hashes are
consistent. Heavy jobs ran serially under memory/swap/CPU caps with deploy
paused and all repository edits frozen during browser runs. Logs use the local
`reaudit-controller-ak-{typescript,unit,browser,browser-reload}` prefix.
