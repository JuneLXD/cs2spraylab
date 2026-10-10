# AWP scope and attack clocks — pass 39

The AWP now uses its existing scheduled shot time for ordinary scope recovery,
checks the current primary deadline and ammo before automatically rescoping,
and starts that camera transition at the processing call. Baseline: `feb6a50`.
This is a bounded integration with the trainer's scheduler. It does not reproduce
the native command-history selector or establish physical input/display latency.

## Primary evidence

[Current server proof](evidence/reaudit-awp-native.json): whole-library SHA256
`c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`,
137 instruction assertions, five literal assertions, 16 concrete AWP virtual
bindings and eight schema fields, across 36 retained ranges and 37,267 bounded
read bytes. These are static reads and assertions, not native execution.
[Weapon data](evidence/reaudit-awp-data.json) verifies the current compiled VPK
entry against a hash-verified retained pass-38 decode; no new export is claimed.
The six-node inheritance chain establishes a 1.455-second cycle, two zoom levels
(40°/10°), automatic unzoom, unlinked attack clocks and no flag override.

The concrete ordinary primary/firing helper advances both attack clocks by the
authored cycle. Let P and S be the existing clocks, C the captured current
command time, and D the cycle. With a retained historical context it adds D to
each existing clock. When the context requests rebasing, it first raises each
past clock to C, then adds D. Thus a future secondary deadline is preserved.
Fresh explicit attack records request rebasing; the specific live context for
the trainer's queued sequence was not captured.

Ordinary postframe tests primary readiness before shared input dispatch. A pending
positive saved zoom restores only when ammo exists for ordinary AWP data, starts
a 100 ms FOV transition, then clears pending. An empty magazine clears pending
without zooming. There is no separate secondary-ready gate or independent rescope
timer in this path. The camera setter records current camera-domain seconds as
the transition start. Shot unzoom likewise starts when its caller executes.

Given S≥P initially, ordinary loaded shoot/zoom sequences preserve that ordering:
both receive the same cycle, rebasing is monotonic, and accepted manual zoom
requires C≥S before setting S=C+0.3. Under this bound, the trainer's existing
fresh/stale-vs-queued shot selection supports `max(S, scheduledShot)+D`.
That equivalence is **not** established through every reload, deploy, holster or
special state. A supplied S<P state with an unrebased native context would differ.

## Actual trainer measurements

The [probe](../tools/reaudit-awp-trainer.mjs) bundles actual Range and Duel code.
It forwards `afterShot` arguments unchanged and records schedule and processing
separately; Range's `lastShotAt` independently checks the former and `onShot.at`
the latter. Production `untilEvent()` selects the global 128 Hz/action boundaries,
with exact input edges. Two declared fixtures deliberately supply a late single
update; they do not represent normal frame-loop behavior.

[Before](evidence/reaudit-awp-before.json), [after](evidence/reaudit-awp-after.json)
and [comparison](evidence/reaudit-awp-comparison.json) retain 20 cases / 10 engine
pairs. Shot schedules are identical before/after; all paired clocks, FOV and
completed ammo states agree. Inside the `afterShot` hook only, Range has already
decremented ammo while Duel has not; the comparator explicitly excludes that
known phase difference and retains the raw values. Ten complete cases are unchanged.

| Case (seconds unless marked) | Before | After | Status |
|---|---|---|---|
| Level-one held shot scheduled2.458, processed2.46875 | Secondary and pending scope deadline3.92375 | Both3.913, matching existing primary schedule | Corrected ordinary scheduler integration; native context selection unmeasured |
| Level-two held shot with future secondary deadline | Secondary4.06; scope3.92375 | Secondary4.06 retained; scope3.913 | Future secondary retained |
| Rescope processed25ms after readiness | FOV already82.1875° | Starts90°, then100ms transition | Current native setter rule |
| Last shot, no reserve | Automatically zooms with0ammo | Remains unscoped; consumes pending state | Current native ammo gate |
| Late held update processed2.5 | Unzoom restarts from70° because rescope was backdated | Restarts from90° after current-call rescope | Processing order preserved |
| Unscoped, settled, quickscope, second-level and exact-ready controls | Existing clocks and FOV | Unchanged | Ten engine cases |

## Limits and corrected claims

The old on-time scope tests did not verify late transitions. The delayed AWP
assertion explicitly expected backdating and has been corrected from current
native evidence. SSG and other scoped weapons retain their previous behavior;
their follow-up is outside this focused pass.

The trainer still wakes rescope at a fractional action deadline. Native postframe
invocation cadence, context/history production, float32 normalization, dynamic
auto-rezoom preference, client prediction and rendered landmarks remain unverified.
No shot schedule or general resolver was changed. Native primary input precedes
secondary in the same eligible command; Duel's existing AWP simultaneous-input
path differs and remains a separate gap, outside these sequential-input fixtures.

The pass-38 Glock raw trace mislabeled callback processing time as `scheduledAt`.
Its published comparisons used `at`, so their results stand. The original files
are preserved; the portable probe now reads the actual `lastShotAt` and retains
`callbackAt`. See the explicit [erratum](reaudit-glock-timing.md#pass-39-timestamp-label-correction).

## Reproduction and validation

Run every Node/test command under the host memory/swap cap, with deployment
inactive and heavy work serialized. Use separate clean baseline and patch
worktrees, the same probe source and fresh output paths:

```sh
node tools/reaudit-awp-trainer.mjs --repo BASELINE --output before.json
node tools/reaudit-awp-trainer.mjs --repo PATCH --output after.json
python3 tools/reaudit-awp-report.py --before before.json --after after.json --output comparison.json
```

Native reproduction tools and their retained-source mapping are under
`tools/reaudit-awp-native/`. Raw locations stay in those tools and the local
`native-audit/reports/awp-clocks-next/` ledger. [Validation](evidence/reaudit-awp-validation.json): TypeScript passes; 48 focused
cases and 2,517 full-suite cases pass, with only the known missing fallback model.
All three Chromium specs (AWP rescope, common reload, Glock timing) pass. The
first full-unit invocation used the parent working directory and could not
resolve relative assets; the final worktree-directory run is authoritative.
All eight checked app/test hashes remained unchanged through the final checks.
The five packaged native tools reproduce all 36 ranges and original findings.
This report does not claim deployment.
