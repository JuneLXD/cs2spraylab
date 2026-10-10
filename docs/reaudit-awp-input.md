# AWP primary and zoom input — pass 40

Ready AWP primary input now takes priority over secondary input in both trainer
modes. Holding primary after bolt recovery therefore preserves the restored scope
level, even though the semiautomatic weapon rejects another shot. Releasing primary
allows the existing zoom-repeat controller to act again. Baseline: `9021527`.

## Primary evidence and limits

The [native proof](evidence/reaudit-awp-input-native.json) checks the current server
SHA256 `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`.
It binds seven concrete AWP virtual methods and checks 96 instructions using
hash-matched pass 38/39 evidence plus two new selected reads totaling 1,536 bytes.
Whole-library hashing is separate from that byte count. This is static evidence;
no game, native execution or full Ghidra analysis ran in this pass.

The shared input dispatcher selects primary when its input is active **and its
deadline is ready**. Both acceptance and rejection by the primary handler bypass
secondary afterward. For the AWP's semiautomatic path, rejecting a repeated shot
does not release that priority. Primary input during cooldown does not win this
branch; ordinary secondary input then receives its own readiness check. Pending
automatic rescope is processed before this arbitration, as established in pass 39.
The [derived table](evidence/reaudit-awp-input-derived.json) covers 64 combinations
and eight named examples of those already-evaluated predicates. It models neither
physical input nor native command history. A supplied secondary-ready/primary-not-
ready case tests the conditional branch without claiming that ordinary AWP actions
produce that clock ordering.

The selected scope/controller branch reads `cl_debounce_zoom`: a positive value
forces a result that requests input consumption after secondary dispatch. A
nonpositive or missing value preserves ordinary AWP secondary's zero return. The
consume routine calls another helper and records a selected button bit; that
helper's effects and the producer/reset lifetime remain unproved. Consequently,
this pass does not infer the game's current/default preference or replace the
trainer's existing Zoom Button Hold setting with unconditional held input.

## Before and after

The [trainer probe](../tools/reaudit-awp-input-trainer.mjs) bundles actual Range and
Duel simulations and calls their actual engine zoom-repeat methods on a minimal
host, without constructing a renderer. It uses synthetic 120 Hz frame callbacks,
production event boundaries and exact input edges. The same probe measured clean
`9021527` and the patched checkout. Only two of its 127 bundled source files differ.
[Before](evidence/reaudit-awp-input-before.json),
[after](evidence/reaudit-awp-input-after.json) and
[comparison](evidence/reaudit-awp-input-comparison.json) retain every sampled state.

| Fixture | Before | After |
| --- | --- | --- |
| Duel atomic ready primary + secondary at zoom 0/1/2 | Shot sees zoom 1/2/0 | Shot sees original zoom 0/1/2 |
| Both modes: scoped shot at 1 s, primary stays held, secondary tap at 2.6 s | Restored level 1→2 or 2→0 | Restored level 1 or 2 preserved |
| Range: repeat enabled, secondary held during recovery, primary released at 3 s | Zoom cycles at 2.458333 s and 2.766667 s before release | Preserves level 1; changes to 2 at 3.008333 s |
| Duel: same held sequence | Zoom cycles at 2.460938 s and 2.773438 s before release | Preserves level 1; changes to 2 at 3 s |

All 23 cases retain exact shot counts, scheduled times and processing times.
Nine cases change; 14 complete cases are unchanged, including repeat disabled,
repeat enabled with primary released, single-button inputs and ordered scope/fire
inputs. Three atomic fixtures are Duel-only. Equal-time browser DOM edges remain
ordered events; the probe does not call them a combined native command.

The Range/Duel release timing difference is retained and disclosed. Range invokes
zoom immediately from a frame; Duel queues it for the next simulation update,
which can coincide with the release event. These measurements do not establish
native dispatch cadence or a generic retry delay. The pilot used a second scope
input too late to make both clocks ready at 1 s; its source/results remain locally
retained, and the final baseline uses a 0.7 s second-scope setup.

## Change and validation

Two existing priority guards now include AWP. The existing zoom-repeat preference,
frame cadence, shot schedule, reload/firing guards and pass 39 rescope logic are
unchanged. Six unit cases cover simultaneous input at all zoom levels, held-primary
rejection in both modes and the conditional cooldown branch. The prior quickscope
fixture incorrectly expected secondary first in a combined Duel command; it now
uses separate ordered scope and fire inputs, matching the Range fixture.

[Validation](evidence/reaudit-awp-input-validation.json): TypeScript passes;
49 focused tests and 2,523 full-suite tests pass. The sole full-suite failure is
the existing absent `public/models/ak47.json` fallback fixture. All four Chromium
checks pass: actual held mouse inputs in Range and Duel, AWP scope clocks, and
Glock timing. Browser fixtures freeze simulation/frame timing while preserving
the actual DOM bind path; they do not measure wall-clock input latency.

All heavy work was serialized with auto-deploy paused and memory/swap/CPU caps;
the repository was frozen during browser validation. No assets changed.
Native reproduction instructions and hashes are in
[tools/reaudit-awp-input-native](../tools/reaudit-awp-input-native/README.md).
The trainer comparator refuses existing output paths:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-awp-input-report.py --before docs/evidence/reaudit-awp-input-before.json --after docs/evidence/reaudit-awp-input-after.json --output /tmp/awp-input-comparison-new.json
```

Native command aggregation, upstream player/equip gates, mask lifetimes, history
selection and client prediction remain partial. This correction does not certify
complete AWP parity or expand deferred uncommon-weapon work.
