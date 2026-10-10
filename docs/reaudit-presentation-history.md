# Presented input clocks and motion histories — pass 32

This pass adds native observations and reproducible probes. Production behavior
and assets are unchanged. R8 follow-up remains excluded.

## Evidence and capture quality

The approved offline runtime008 session retained two AK recordings. The game and
its read-only ancestor sampler exited zero; its owned Steam unit was stopped.
The capture HUD setting was restored; bindings and resolution were unchanged.

| Recording | Guarded numeric rows | Demo ticks | Decoded video frames | Largest video gap | Largest numeric gap |
|---|---:|---:|---:|---:|---:|
| `native_reaudit_history_001` — taps, burst, reload | 1,934 | 1,160 | 1,072 | 34 ms | 110.937 ms |
| `native_reaudit_bob_007` — movement, turns, crouch, jump | 2,927 | 1,414 | 1,334 | 33 ms | 32.314 ms |

Neither video has a gap over 50 ms. No audio was recorded. These timestamps
measure available samples, not physical input latency or unique rendered frames.
The complete sampler retained 24,480 rows and rejected 6,553 reads: 6,551 were
changing/busy histories or producer fields; two were camera/teardown reads.
Repeated guards reduce torn reads; they do not make a cross-object snapshot
atomic or associate every value with its producing invocation.

The [portable fixture](evidence/reaudit-frame-history-fixture.json) omits process
identifiers, pointers and raw memory. It retains explicit numeric fields and
deduplicates published records. Original snapshots, exact launch-version
readers, input logs, videos, demos and hashes remain under `native-audit/reports`.

## Input history and camera anchors

Current client and engine hashes, native type/storage bindings and 42 exact
instruction assertions bind the reader to the actual input object and the
ten-slot presented-frame ring. Twenty-three synthetic checks exercise decoding,
bounds, class/owner rejection and concurrent-change rejection.

Across both windows, **4,088 input-entry occurrences match their published
render/player pairs exactly**, with no missing frame or differing pair in the
sampled ring. These represent 2,458 distinct input records. The firing window
contains three selected primary records; each first-shot camera anchor equals
that record's player pair exactly. The render pair is separately retained and
is one integer tick earlier in these three observations. Do not substitute it
for the selected player clock.

The firing demo contains eight AK shots and one reload. All eight camera anchor
pairs agree bit-for-bit with the live reads after decoding the demo's doubled
integer carrier and recovering float32 CSV values. Live memory itself uses
`(tick + fraction) / 64`, with native float32 rounding when converting to seconds.
All eight `last_shot_time` values equal the float32 weapon deadlines.

Five held-fire follow-ups advance the first burst anchor by the native float32
cycle pair. The saved resolver instructions also reproduce all five exactly
under the explicit assumption that the resolver's entry clock equals the weapon
deadline:

```
candidate = nextAttack + oneTick + cachedDifference
cachedDifference = resolvedAnchor - currentPair - oneTick
```

Pair normalization and float32 operations matter. This is a conditional replay,
not observation of the resolver's current clock or its exact/interpolated/last/
no-history branch. All five follow-up polls have no selected primary index;
four occur while the input reader's early-return flag is set. The three selected
first-press records were also sampled with that flag set. The flag is retained
as phase evidence; it does not identify a complete command invocation.

The observed anchors precede weapon deadlines by 0.139646–0.153806 ms; ordinary
tick processing trails them by 1.220696–14.892578 ms. Earlier recordings had
larger and different anchor/deadline gaps. A universal fitted delay remains
unsupported. SprayLab still needs an evidenced association between its saved
rendered player clock and first press, separate camera sample/anchor clocks,
and defined delayed/missing-history handling before this changes production.

Numeric results: [runtime comparison](evidence/reaudit-frame-history-runtime.json),
[native bindings](evidence/reaudit-frame-history-bindings.json), and
[held-anchor replay](evidence/reaudit-held-anchor-replay.json).

## Velocity offset producer

Current class, constructor and adapter paths bind registration to the velocity
history's interpolation group. Dirty-group refresh obtains an integer count,
computes an offset, caches both and broadcasts them to each context. The actual
pawn's count provider returns one. Its typed velocity adapter stores the offset
and count, invalidates the selected cache timestamp and sets its dirty bit.
Registration and the named interpolation-list processor refresh these groups.

All **4,861 captured rows** have one active velocity ring, with count one and
offset 1/64 second. Its group pair agrees exactly; the unused second group has
count one and offset zero. Earlier runtime006/007 also had only one ring.
Those captures therefore never established the second context's offset.

The ordinary first-context offset is count × 1/64; a separately gated local
time-scale branch can alter its interval. The second context has independent
network/control/fallback branches. Captured values do not establish every
setter's branch or its ordering relative to latch/cache/render consumers.
The [producer proof](evidence/reaudit-velocity-offset.json) checks 68 instructions,
three classes, four virtual targets and 17 ranges. No bob/sway tuning follows
from an offset value alone.

## Transform history: explicit failed validation and correction

The scene node uses a distinct procedural TransformHistory wrapper and a
96-byte value layout, independently bound from its own methods. Its shared
current record has several writers: the recording getter, interpolation and
the fallback getter. It is **not** a proved last-evaluated cache. Local/world
origins, quaternions and scales have parent/flag-dependent selection; the
quaternion kernel is not established as generic SLERP.

Runtime008 rejected every transform read before following its wrapper because
the original allowlist omitted the pawn's exact network-variable skeleton
subclass. Those readouts remain invalid. Subsequent RTTI/ABI bindings establish
its inheritance and 30 matching scene virtuals, allowing a narrow reader fix.
The corrected reader has **not yet been validated live**. Its 21 synthetic
checks reject other classes and unsupported rings without truncation.

The [static proof](evidence/reaudit-transform-history.json) covers 23 ranges,
72 instructions, four classes and three inheritance relocations. Still needed:
accepted reads from the corrected class gate, actual interpolation invocation
time/context/mode/endpoints, writer ordering, and existing-instance reset
ownership across respawn/teleport. Clearing a history does not itself establish
a gameplay reset policy.

## Reproduction

Run these serially under the host memory/CPU caps:

- `python3 tools/reaudit-frame-history-proof.py`
- `python3 tools/reaudit-velocity-offset-proof.py`
- `python3 tools/reaudit-transform-history-static.py`
- `python3 tools/reaudit-frame-history-report.py --fixture docs/evidence/reaudit-frame-history-fixture.json`
- `python3 tools/reaudit-held-anchor-replay.py --out docs/evidence/reaudit-held-anchor-replay.json`

Native proofs require the matching installed artifacts. Held-anchor replay uses
the retained CSV, snapshot and resolver listings. The fixture-only comparison
does not require those local capture files. The optional sampler readers remain
in `tools/reaudit-motion-runtime-v3.py`; launching that tool starts the game and
requires the approved capture scope and host coordination.

## Validation

Current native proofs, decoder checks, raw/portable replay and Python syntax
checks pass. Final fixture/probe hashes agree with the retained reports.
TypeScript passes; 2,367 unit cases pass, with only the known missing
`public/models/ak47.json` fixture failure. Both Chromium camera cases pass in
27.1 seconds. Checks ran serially under memory/swap/CPU caps; auto-deploy was
paused and repository files were frozen during browser execution. Local logs
use the `reaudit-history-{typescript,unit,browser}` prefix.

## Pass 33 follow-up

[Pass 33](reaudit-draw-and-transform.md) validates the corrected transform reader
in 2,602 fresh snapshots; runtime008 remains rejected. It also decodes retained
serialization mappings and binds the ordinary interior held-deadline caller
clock. Final command presence, live resolver branch/cache and transform invocation
arguments remain open. The new pass separately corrects four ordinary draw rates.
