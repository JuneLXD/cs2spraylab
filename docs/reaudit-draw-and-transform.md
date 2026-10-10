# Draw playback and accepted transform histories — pass 33

Ordinary AK-47, AWP, Nova and XM1014 draw clips now advance in authored
seconds while their existing action is active. A model that attaches late
previously squeezed its whole draw into the remaining deploy time. The change
removes that relative-rate error in Range and Duel. First-display onset,
readiness-based action lifetime and fades remain separate approximation limits.
The draw correction is commit `64bbe25`. R8 follow-up remains excluded.

## Native draw clock and measured correction

The current-client [immediate caller proof](evidence/reaudit-animation-immediate-clock.json)
binds the ordinary local HUD path through the player's HUD handle to
`C_CS2HudModelArms::UpdateAndSetupView`, action reflection, the immediate AG2
evaluator and the Arms skeleton callback. Whole-artifact identity, five code
ranges, 72 instruction assertions, two classes and three virtual targets pass.
The evaluator requires graph mode 2, interpolation selector -1 and a graph
instance. It forwards global frame delta unchanged; an equal-current-time
repeat supplies zero. This is a concrete displayed-Arms route in addition to
the earlier general worker path. Static bindings do not count live invocations.

The [graph proof](evidence/reaudit-draw-graph-proof.json) reparses the four
current-hash retained resources. All 16 selected draw nodes have rate one,
zero sync offset, no connected rate inputs and no looping. Ordinary entry and
reset transitions have zero duration, no time matching and zero offset.
The global Idle transition depends on an external idle/empty action and lasts
200 ms. The graph emits its action-complete event with at most 100 ms remaining.
Neither condition independently establishes a gameplay readiness deadline.
Current compiled-resource CRC/size corroboration is retained from pass 29;
this pass did not re-export native packages.

Both actual engine callers await model preparation and then supply
`max(0.01, equipReadyAt - simulationTime)` as the draw lifetime. Their existing
per-frame updates already supply equipment identity. `ViewAnimation` now marks
ordinary draws explicitly and samples `min(elapsedSinceAttach, clipDuration)`
for the four proved graphs. Pickup reuse, other equipment, firing, reloads,
onset, lifetime and fade policy retain their previous behavior.

The same [portable probe](../tools/reaudit-draw-clock-runtime.mjs) bundles the
exact git-verified baseline source from `f0f70ee` and the actual current source.
It substitutes no hypothetical implementation. Both runs pin the unchanged
supporting modules and real engine callers, verify imported GLB JSON hashes and
sizes, and use linear bone tracks to read out actual action time and weight.
The delay schedules are controlled instances of the real caller formulas;
their frequency in ordinary use has not been measured.

| Weapon | Model attachment delay | Sample age after attachment | Before clip time | After clip time | Rate before → after |
|---|---:|---:|---:|---:|---:|
| AK / Nova / XM | 250 ms | 375 ms | 500 ms | 375 ms | 1.333333× → 1× |
| AK / Nova / XM | 750 ms | 125 ms | 500 ms | 125 ms | 4× → 1× |
| AWP | 250 ms | 508.3335 ms | 633.333325 ms | 508.3335 ms | 1.245901× → 1× |
| AWP | 750 ms | 258.3335 ms | 633.333325 ms | 258.3335 ms | 2.451611× → 1× |

The [before](evidence/reaudit-draw-clock-before.json) and
[after](evidence/reaudit-draw-clock-after.json) retain 724 samples with identical
action lifetime, elapsed state and fade weight. All 576 unaudited-equipment and
pickup controls are identical, as are 48 cancel/fire/reload controls and 16
pause checks. Four extended-lifetime controls hold the authored endpoint.
First displayed sample, elapsed-age seeking, the action-complete event consumer
and external idle/readiness ordering are not newly certified by this fix.

## Accepted TransformHistory capture

Approved runtime009 retained `native_reaudit_bob_008`: 2,602 guarded snapshots,
1,408 AK demo ticks and 1,325 decoded game-video frames. The maximum video gap
is 34 ms with no gap over 50 ms; the maximum numeric gap is 109.194113 ms.
The sequence covers strafing, forward/back movement, turns, crouching and a
jump. Demo duck amount spans zero to one, 47 rows are airborne, and ammo remains
30. No audio was recorded. Game and sampler exited zero, owned Steam stopped,
and the capture HUD setting was restored. Bindings and resolution were unchanged.

All 2,602 transform reads pass the corrected exact-class/owner/callback gates.
The full sampler retained 10,196 rows and rejected 2,800 reads, comprising
2,773 changing/busy histories and 27 camera/teardown reads. Clock/whole-field
guard rejections are separate sampler counters. The original runtime008
rejections remain invalid; they were not retroactively repaired.

Each captured transform history has one seven-entry ring of capacity eight,
a one-tick offset and strictly descending keys. Its wrapper disables a third
interpolation point even though the separately sampled global cubic flag is on.
Every sampled parentless state would select its local value if the consumer
were invoked. This is a conditional static choice, not invocation telemetry.

The shared current value's selected local position equals the cached node
position in 2,600 rows, with a maximum residual of 0.03173828125 native units.
Its orientation differs by at most 0.000294823 degrees. Evaluated-scene local
position differs in 56 rows: 54 dirty and two clean. Complete semantic current
values match a ring value in only 179 rows, 140 of those ambiguously matching
several records. Equality cannot identify a writer or selected endpoint.
These observations preclude treating the shared current value as a uniquely
identified last-interpolated cache or fitting a clock to the nearest ring value.

The [numeric fixture](evidence/reaudit-transform-history-fixture.json) replaces
entity/parent/attachment references with stable equality-preserving ordinals
and contains no pointers, raw guards or process IDs. Deduplicating 1,401 semantic
records and 1,417 complete rings reduces it from 15.76 MB to 1.87 MB. Every
reconstructed row and all [comparison results](evidence/reaudit-transform-history-runtime.json)
match the frozen raw snapshot exactly; launch, sampler and helper hashes agree.
Actual invocation time/context/mode/options, writer ordering and reset ownership
remain open. A separate world-scale divisor was not captured, so world-getter
scale compatibility remains unavailable. Euler-derived orientation comparisons
are explicitly diagnostic rather than a native float32 conversion replay.

## Input serialization and held-shot clock

[Serialization evidence](evidence/reaudit-history-serialization.json) decodes
all 4,088 retained runtime008 input entries and checks 52 native instructions.
Every nonempty history contains one record whose output mapping is zero; all
three selected primary records map source zero to output zero. Initialization
uses a negative sentinel and the observed mapping is written after append.
Native count-at-most-four processing bypasses reduction regardless of its
control setting. Reduction cannot drop or replace these sole sampled entries.
The final command's player-pair presence gate and transport remain unobserved.

The [held-clock proof](evidence/reaudit-held-clock.json) verifies the current
server hash, 80 instruction checks, four movement virtual bindings and five
retained REA evidence identities. Movement preprocessing inserts eligible
weapon-deadline fractions into an ordered, deduplicated remaining-event list.
The loop installs event tick/fraction/current time, dispatches the active
weapon's post-frame handler, then restores the previous globals. For ordinary
one-tick processing with matching movement/weapon time domains and an interior
eligible deadline, the resolver therefore enters at that deadline pair.

All five runtime008 held deadlines have interior fractions. This supplies a
native caller path for the earlier conditional arithmetic; it does not observe
each live resolver branch or cache value. Exact boundaries, overdue/reset
schedules, flagged commands, domain disagreement and active clamps remain
outside this conclusion. Camera sample time and recoil-anchor time remain
separate. No fitted delay or camera-only production change follows.

## Reproduction and validation

Run each command serially under the host memory/swap/CPU caps, with deploy
inactive:

- `node tools/reaudit-draw-graph-proof.mjs`
- `node tools/reaudit-draw-clock-runtime.mjs before`
- `node tools/reaudit-draw-clock-runtime.mjs after`
- `python3 tools/reaudit-animation-immediate-clock.py --out docs/evidence/reaudit-animation-immediate-clock.json`
- `python3 tools/reaudit-history-serialization.py --out docs/evidence/reaudit-history-serialization.json`
- `python3 tools/reaudit-held-clock-proof.py --out docs/evidence/reaudit-held-clock.json`
- `python3 tools/reaudit-transform-history-runtime.py --compact docs/evidence/reaudit-transform-history-fixture.json --sha256 6c6a4e4f6443f1db29600a2a8ed2bb2c3a456e22314ea343a32c179bb55465f0 --out docs/evidence/reaudit-transform-history-runtime.json`

Native and graph probes require the matching installed/retained artifacts.
The compact transform comparison runs without a game installation or local
capture files. Native, graph and portable before/after checks pass. TypeScript
passes; the full unit suite has 2,373 passes and only the known missing
`public/models/ak47.json` fallback fixture failure.

Both Chromium draw cases pass in 15.1 seconds, using real engine/model loading
with a controlled 250 ms delay. They verify authored clip seconds, changing
hand pose, return to idle, and unchanged ammo/readiness. The initial pose check
incorrectly sampled fixed bone-local translation; measuring world position
corrected the test without changing production code. Both existing camera
cases also pass. Heavy jobs ran serially under memory/swap/CPU caps, with
deploy paused and repository files frozen during browser execution. Logs use
`reaudit-draw-transform-` locally.
