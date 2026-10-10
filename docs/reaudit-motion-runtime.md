# Live velocity history and body-yaw clocks — pass 28

The optional readers from pass 27 have now been used in an approved offline AK
capture. This pass measures native history and body state; SprayLab retains its
existing movement bob and has no new body-yaw state machine. The remaining
clock and lifecycle boundaries prevent a justified production replacement yet.

## Capture and provenance

`native_reaudit_bob_005` contains 1,412 demo ticks and 1,614 accepted numeric
snapshots. The sequence uses the verified T/G forward/back, F/H strafe, C crouch
and Space jump bindings, with stationary and moving turns. No bindings changed.
The demo retains AK throughout with 30 rounds. The selected pawn was checked
against visible position and a controlled forward movement before recording.

The video decodes to 1,239 frames with a maximum 33 ms timestamp interval and
no interval above 50 ms. This establishes recording continuity, not unique
rendered frames, actual presentation frequency or physical latency. The
22.366-second numeric window covers 812 frame counters and 740 distinct last
processed command values. All retained body-owner checks pass; maximum
horizontal speed is 215 u/s, duck amount spans zero to one, and 45 snapshots
are airborne.

The sampler rejects changes during repeated reads. Its full session records
15,325 rows and 882 read errors; the first retained errors are history-header
changes. Later error types were not individually retained. Its 100 ms error
backoff leaves gaps, so the accepted window is not a complete invocation trace.
The owned game and sampler exited zero, and owned Steam was stopped. No game
memory was written. Local capture logs, input edges, identity checks, hashes
and terminal state remain under `../native-audit/reports`.

The [portable numeric fixture](evidence/reaudit-motion-runtime-fixture.json)
omits pointers, process identities and memory blocks. Its source snapshot hash
and sampler/helper hashes preserve provenance. Replay needs the matching
installed client binary and the existing local Python dependencies, not a
running game.

## Velocity: distinguish the selected cache from a retained old value

The replay reconstructs the captured packed ring metadata, physical slots,
value indexes, numeric value words, wrapper flags and requested cache time.
The actual native bracket search runs without shims. Two-point vector
arithmetic is a float32 projection of the bound instructions; the complete
cache evaluator and quantization metadata helpers are not executed.

| Measurement | Result |
| --- | --- |
| Native bracket invocations | 3,228: each of 1,614 snapshots with the uncaptured cubic global flag supplied as both zero and one |
| Flag-dependent differences / three-point selections | Zero / zero |
| Past-newest endpoint selections / in-range selections | 1,302 / 312 |
| Full-window exact cache projections | 1,603 / 1,614 |
| Context selecting cache zero, with matching requested time | **711 / 711 exact**, including 134 nonzero vectors |
| Other 11 projections | Maximum component difference .513507843 u/s; every cached time/vector exactly matches an earlier sample one frame before |

Every retained history has one ring and a 1/64-second offset. This is an
observed value, not proof of its producer or a delay to add to SprayLab.
In all 11 apparent mismatches the selected history values changed while the
old evaluated cache remained. Their sampled context selects stored velocity,
not cache zero. Comparing that retained cache with the newer ring as though
both were evaluated together invents an interpolation error.

[Portable results](evidence/reaudit-velocity-runtime.json) retain code hashes,
counts and limits. The replay writes the individual mismatch origins locally.
Cache invalidation, history-write callers, rewind timing and mapping native
prediction/presentation state to the trainer remain unverified.

## Body yaw: native dispatch and a scoped clock

The bounded native wrapper, aim/error preparation and state dispatch execute
80 supplied cases with 178 assertions. Movement inputs, scene interfaces,
current tick and aim punch are supplied; weapon-drop preparation, foot IK and
air auxiliary routines are skipped. Bound mathematical imports use float32
host shims. These cases establish the isolated yaw behavior, not those omitted
systems, special-weapon gates or lifecycle reset rules.

The capture projection reconstructs input yaw from the retained pre-dispatch
aim/error pair and supplies captured state/timers. Those state fields are
post-call, so this is not a consecutive-command replay. A small tolerance comes
from float32 spacing in the reconstruction, rather than fitted residuals.

| Captured branch | Dispatch comparison |
| --- | --- |
| Move | All 246 samples exact |
| Start | All 20 samples exact |
| Airborne | All 45 samples exact |
| Idle on ground | 1,090 / 1,091 within reconstruction precision; the remaining sample follows a turn-loop-to-idle transition and retains its final nonzero turn rate |
| Stationary turn loop | All 212 match at least one of raw normalized tick or that tick plus one; neither supplied clock explains every sample |

The turn-loop comparison is diagnostic, not permission to select the better
clock per sample in production. Inverting the unsaturated turn ramp yields an
integer elapsed tick in 47 cases, within 8e-7 tick; 24 agree with sampled raw
tick and 23 are one tick later. An observed constant difference from the last
processed command is not a proven command-to-clock rule.

The movement wrapper provides a concrete reason to capture its active clock:
it temporarily sets movement time from the pawn controller's tick base,
recomputes the integer tick from current time, clears the fractional part,
calls movement/postprocessing, then restores the previous global clock. The
context-zero timer also applies the game-rules pause ceiling and accumulated
paused ticks. Those pause fields were already recorded and are inactive here;
controller tick base and the active processing identity were not recorded.
[Current-byte proof](evidence/reaudit-body-clock.json) checks ten bounded ranges,
43 instructions, three classes, four virtual targets, six schema fields and
three constants. [Capture diagnostics](evidence/reaudit-body-clock-diagnostics.json)
show that rounding sampled current time produces the same raw tick in every
row. A positive prediction cache agrees with the inferred ramp tick in 41
cases, but is zero in six others and is not the bound controller input.

The normal caller publishes its last processed command **after** the body-yaw
writer. Thus the 28 command values accompanied by multiple produced yaws
cannot count calls or prove an extra update. The produced yaw matches the
declared local scene yaw exactly in 1,585 samples; later evaluated/absolute
scene angles can differ by up to 2.393 degrees. Production must preserve that
transform phase too.

[Body results](evidence/reaudit-scene-writer-runtime.json) retain supplied-case
coverage, capture projections, clock diagnostics and explicit shim limits.
The next capture needs controller tick base and active movement identity beside
state/timers, followed by consecutive transition and reset comparisons.
The sampler's new optional `--body-clock` reader is prepared for that capture;
19 synthetic decoder checks pass, with a maximum read of 36 bytes. This reader
has not been validated live and must not label a later controller value as the
clock that produced an earlier retained body state.

## Reproduce

Run these serially while deploy is inactive:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-velocity-runtime.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scene-writer-oracle.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-scene-writer-project-capture.py
python3 tools/reaudit-scene-writer-summary.py
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-body-clock-proof.py
python3 tools/reaudit-body-clock-capture-fields.py
python3 tools/reaudit-body-clock-diagnostics.py
```

`tools/reaudit-motion-capture-fixture.py` regenerates the portable fixture from
the hash-bound local snapshot. The historical raw capture remains immutable.

## Delivery validation

All portable native, decoder and animation-clock probes pass. TypeScript
passes; the full unit suite has 2,363 passes and only the known missing
`public/models/ak47.json` fallback fixture failure. Both targeted Chromium
view-punch cases pass in 27.3 seconds. Checks ran serially with memory/swap/CPU
caps, deploy paused and repository edits frozen during browser execution.
Logs use the local `reaudit-motion-animation-*` prefix.
