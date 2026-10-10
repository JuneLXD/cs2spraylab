# Common-weapon draw playback

M4A4, M4A1-S, Glock, USP-S and Deagle now retain authored draw speed when a
weapon model attaches after its deploy timer has started. Both engine callers
already pass the remaining deploy time; the animation controller previously
compressed the entire draw into that remaining interval for these five weapons.
The change adds only these IDs to the existing ordinary-draw rule.

## Measured before and after

The same probe loads the exact `90c7562` ViewAnimation source before and the
actual changed source after, through esbuild. It uses durations read from the
current imported GLB JSON and linear pose tracks to measure the real controller.
All other bundled dependencies, caller hashes, asset metadata and toolchain
identities must remain identical across the comparison. The current Range
caller's separate secondary-input update is recorded relative to the historical
revision; its draw formula is unchanged and its actual bytes are pinned between
the two runs.

| Weapons | Model attachment delay | Before clock rate | After clock rate |
| --- | ---: | ---: | ---: |
| M4A4, M4A1-S | 250 ms | 1.283019× | 1× |
| M4A4, M4A1-S | 750 ms | 2.956524× | 1× |
| Glock, USP-S, Deagle | 250 ms | 1.333333× | 1× |
| Glock, USP-S, Deagle | 750 ms | 4× | 1× |
| AWP, unchanged control | 0/250/750 ms | 1× | 1× |

At the midpoint with a 250 ms late attachment, M4 clip time changes from
0.566666663 to 0.441666500 seconds; pistol clip time changes from 0.500 to
0.375 seconds. The latter values equal elapsed time since attachment.

Both runs contain **1,086 samples**. All 1,086 action lifetimes and weights,
901 unaffected controls, 72 fire/reload/cancel interruption controls and 24
zero-delta pause checks remain identical. Controls include omitted/unknown
equipment, distinct pickup clips, draw reused for pickup, ordinary endpoints,
post-deadline attachment and a lifetime longer than the clip. AWP remains an
independent already-correct weapon control.

## Native and asset evidence

The verifier freshly parses six retained decoded graphs and checks **24 draw
nodes**. Their playback rate is 1, with no connected dynamic input, no looping
and zero start-sync offset. Deploy entry/reset has zero transition duration
and no time matching. The global idle exit uses 200 ms; the Deploying state
emits completion with at most 100 ms remaining. These graph events do not prove
that gameplay readiness immediately exits or finishes the draw.

The current installed VPK directory and selected compiled graph/clip bytes are
read and hashed. Every draw's CRC and byte count matches both the retained
extraction listing and imported export manifest. Decoded graph hashes match the
prior extraction index. Actual GLB JSON hashes, file sizes and clip durations
are recorded. This establishes the retained-resource identity bounds without
claiming a fresh compiled-to-decoded conversion or rechecking every binary pose.

Constant one-sample idle clips have an explicit one-frame imported padding.
The older inventory's DMX duration rounding is separately retained and bounded
below 35 microseconds; moving imported clips agree with the normalized export
durations within 10 microseconds. These metadata differences are not tuned.

The current Arms clock/caller evidence from the earlier draw pass applies to
the same ordinary graph path. Native first displayed sample, attachment-age
seeking, external idle-writer ordering and final blend matching remain open.
This correction preserves the existing onset, fades and readiness-based action
lifetime. It does not extend the deploy lock, alter firing readiness, or change
pickup playback.

## Validation and retained artifacts

Graph verification and both actual-controller probes exited zero under
512 MiB / one-CPU caps. The new common-draw tests, existing draw tests and AK
reload tests pass (20 cases). The broader animation file had one separate
simulation-only failure: its fixture requested reload immediately after firing,
which the separately corrected reload-admission rule rejects. The root task
owns that fixture correction and the final integrated/browser checks.

- `tools/reaudit-common-draw-graph.mjs` → `docs/evidence/reaudit-common-draw-graph.json`
- `tools/reaudit-common-draw-runtime.mjs before|after` → `docs/evidence/reaudit-common-draw-{before,after}.json`
- `docs/evidence/reaudit-common-draw-summary.json` retains compact counts,
  midpoint measurements, source/artifact hashes and terminal outcomes.
- `docs/evidence/reaudit-common-draw-baseline-view-animation.txt` is the exact
  historical source, independently checked against git before bundling.
- `src/range/view-animation-common-draw.test.ts` checks visible hand motion,
  zero-delta pause, existing lifetime, pickup reuse and firing interruption.

Run the graph verifier first, then the runtime probe before and after the
production correction, using `systemd-run --user --scope --quiet -p MemoryMax=512M
-p MemorySwapMax=0 -p CPUQuota=100% node ...`. The baseline source is supplied
through an esbuild load override; no hypothetical implementation is benchmarked.
The first successful before JSON is preserved in
`native-audit/reports/animation-common-draw/original-before.json`, SHA-256
`750e3d67354e530edd7d23fc1bfd57f020aa065811bb83adb109520df60bf956`.
Its paired after result and original probe are retained beside it. The final
portable before/after reruns remove only a redundant working-file guard, so the
historical baseline can be measured again after the production correction.
They retain identical source clocks, counts and controls; final artifact hashes
are recorded in the compact summary.

## Separate out-of-scope asset finding

The Deagle normal-reload compiled resource has current CRC `05d10c92`, while
the imported export manifest records `a0de1be2`; both have 27,162 bytes. Its
current compiled SHA-256 is
`3966fb59252703eaf905a5cbda2c0c778a2837f0ab27e14a819a155a14ff8f3e`.
The draw resource matches. This is an identity discrepancy, not a measured
reload-behavior explanation. No reload asset, timing or gameplay change is made
in this draw correction.

## Final integration

Both M4A4 draw Chromium cases pass in the actual Range and Duel engines. The reload-admission setup in the older simulation test was corrected separately and now passes.
The combined TypeScript/unit/browser results and remaining missing-model fixture
are recorded in the [audit inventory](cs2-reaudit.md).
