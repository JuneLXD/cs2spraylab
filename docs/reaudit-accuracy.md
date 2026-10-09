# Accuracy and recoil-index replay, 2026-10-09

The evidence supports implementing a coherent accuracy/index correction next. Production source is unchanged by this investigation. The candidate reproduces the installed server's arithmetic and the captured update order; integration into both simulation clocks and prediction remains future work.

Reproduction tools are `tools/reaudit-accuracy-native.py`, `tools/reaudit-accuracy-demos.py`, and `tools/reaudit-accuracy.mjs`. The portable summary is `docs/evidence/reaudit-accuracy-summary.json`. Full inputs and per-tick results are retained under `../native-audit/reports/reaudit-accuracy-{native,demos,results,summary}.json`.

## Evidence and coverage

The bounded instruction probe verifies the installed server SHA-256 `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a` before execution. It executes the native accuracy-update and recovery-time bodies in private Unicorn memory. Owner/ground/time queries are supplied, notification setters do nothing, and host float math supplies log/exp imports. Unexpected execution outside the allowed bodies and callbacks fails the probe. This validates each invocation's arithmetic; it does not execute the entire engine frame.

Saved current-hash decompiles are `reaudit-combat-accuracy-update.c` and `reaudit-combat-accuracy-recovery.c` under `../native-audit/rea/out/`. The replay independently reads the fresh exported `reaudit-combat/weapons.vdata`. Original demo bytes are hashed before parsing. The fresh recovery/shooting captures are from the current session; older retained demos remain separately identified and are corroborating runtime evidence, without a retrospective assertion that their headers bind them to this ELF hash.

The native grid contains **39,648 cases**, with **zero penalty or index error**. It covers 35 supplied weapon parameter sets, both supplied modes, standing/crouching/airborne baselines, penalty below/equal/above baseline, index snap boundaries, recovery-transition integer boundaries, and times before/equal/after/late relative to the decay gate. These supplied trainer parameters were independently checked against the current vdata by the combat audit. Silenced trainer defaults select silenced parameters; this grid is not 70 native gameplay captures. Turning, ladder and stack-boost paths are outside the grid.

Accepted demo coverage is **21 recordings / 40,408 consecutive ticks**: 39,338 standing, 664 crouching and 406 airborne rows. There are **152 shots**, **20 mode changes**, **19 reload starts**, **17 reload ends** and **12 landings**. Actual decoded weapons are AK-47, M4A4, Desert Eagle, AWP, AUG and USP-S. AUG has scope-transition coverage but no recorded shot in this set. Weapon switches and missing/discontinuous player rows start a new cumulative segment; ordinary ticks, shots, modes, reloads and landings do not.

All 152 shot times are reconstructed from the decoded next-primary-attack integer tick and fractional ratio, subtracting the applicable float32 cycle time. They agree with the separately decoded last-shot float within its clock precision. There are 150 fractional shots and two exact-boundary shots. No X11 timestamp is used as a native command timestamp.

Excluded recordings remain visible in the report: `native_audit_ak_001.dem` and `native_phase3_m4a4_001.dem` have no usable rows; `native_reaudit_airduck_001.dem` was interrupted by the desktop window menu/minimization. Null weapon and knife intervals are not firearm recovery evidence.

## Observed rules

| Mechanic | Result | Evidence / boundary |
|---|---|---|
| Accuracy decay | One complete 1/64-second exponential step per invocation, with native float32 rounding | Native instruction grid; continuous demos |
| Baseline | Ground stance uses the current mode's stand/crouch value; air uses stand + jump at the captured air-spread scale of 1 | Native body, all three stance grid branches, raw pawn flags |
| Recovery time | Air uses four times crouch recovery; ground interpolation truncates the recoil index to an integer; final value -1 disables the final transition | Native body and transition grid |
| Index gate | Strictly later than float32(last-shot + **primary** cycle + 1/64); the alternate mode's cycle does not replace the primary-cycle gate | Native body and both-mode grid |
| Index decay | Multiply by the complete native 1/64-second decay factor after the gate; snap at or below 0.1 inside that decay branch | Native body, small-index/equality grid |
| Fractional shot | Add fire penalty and index, update last-shot time, then perform the tick's accuracy/index update | 150 fractional shots, including fresh taps and held AK sprays |
| Exact-boundary shot | Perform accuracy/index update first, then add fire penalty/index | Fresh shooting ticks 955 and 987; only two native examples |
| Mode switch | Preserve accumulated penalty; the next native update applies its ordinary baseline/decay rule | 20 transitions; current immediate `setParameters` baseline rebasing differs |
| Reload with event | Accuracy/index update precedes the +1 index increment; scoped AWP reload uses its previous scoped mode for this update, then changes mode | 17 event-bearing starts; fresh manual reloads and retained scoped reload |
| State-only automatic reload | +1 index precedes the update in the discriminating M4A4 case | Two starts without a reload event; Deagle's index gate is not open, so its sample cannot distinguish the two orders |
| Reload end | Captured floating recoil index is zero at the end transition | 17 observed ends; unrelated cancellation/holster cases are not inferred |
| Landing | Add mode landing coefficient × prior raw fall-speed sample before the ground accuracy update | 12 landings; maximum point error 3.10e-6 is within a conservative ±1/64 u/s fall-speed interval |

The event-bearing/state-only reload distinction is a replay classifier, not proof of a universal engine rule for every reload implementation. The full native caller chain is still needed before extending it to per-shell reloads, burst weapons or special weapon states.

The landing replay uses the movement-service fall-velocity field, not the lagged `velocity_Z` convenience alias. The raw network speed has limited precision. Every landing lies inside the stated interval propagated through the landing coefficient; an exact native impact-speed claim is not necessary for these results.

## Before and candidate numbers

The “before” columns invoke the current `WeaponRecovery` class with two 1/128-second advances per native tick, captured shots/stances and current parameter switching. This is a numerical class replay with native events, not a full end-to-end input/simulation replay. It includes the existing absence of the native reload-start index increment. The candidate carries its own state through each uninterrupted segment, rather than reseeding from the native snapshot every tick.

| Recording / quantity | Current class cumulative max error | Candidate cumulative max error |
|---|---:|---:|
| Fresh AK recovery: penalty | 0.0013072615 | 1.4901161e-8 |
| Fresh AK recovery: index | 1.0000000 | 5.5511151e-16 |
| Fresh AK shooting: penalty | 0.0014092454 | 5.9604645e-8 |
| Fresh AK shooting: index | 1.0004354 | 8.8817842e-16 |
| Retained M4A4 spray: penalty | 0.0014880967 | 4.9960036e-16 |
| Retained M4A4 spray: index | 1.0292111 | 8.8817842e-16 |
| Retained AWP scope transition: penalty | 0.0710047672 | 4.7531423e-16 |
| Fresh air/duck/landing: penalty | 0.0014181459 | 3.0994415e-6 |

For the fresh recovery capture, isolated one-step errors away from landing/mode/reload transitions reach 0.0007264839 penalty and 0.0600282336 index in the current class. Fresh shooting reaches 0.0007264850 penalty and 0.1234005089 index. The candidate reproduces non-landing rows at decoded float precision. All accepted cumulative index errors are below 9e-16; the remaining cumulative penalty error is confined to the propagated landing-speed precision.

The expanded native invocation grid also exposes the current class's partial-time index decay/snap difference: maximum index error 0.9019644368 over these supplied boundary inputs. This is a synthetic boundary result, not a measured per-shot gameplay error.

## Corrected artifact labels

Decoded weapon state, not the filename, determines coverage:

- `native_phase3_m4a1s_001.dem` contains M4A4, not M4A1-S.
- `native_audit_aug_scope_001.dem` contains USP-S, not AUG.
- `native_audit_awp_001.dem` contains USP-S and AK-47 around a knife interval, not AWP.
- `native_reload_deagle_empty_001.dem` contains M4A4, not Desert Eagle; `_002` contains Desert Eagle.

No silenced-rifle, AUG firing, or Deagle-empty coverage should be claimed from those mislabeled files. The summary records all decoded names, including null intervals.

## Next implementation boundary

Keep aim-punch sampling and its exact scheduled anchors separate from accuracy/index stepping. The new correction should give accuracy/index their native 64 Hz update phase, retain primary-cycle metadata while modes switch, preserve penalty during parameter changes, and process captured event ordering explicitly. Landing additions, reload increments/resets and fire increments must enter that state machine once. Render/predict calls must not advance the authoritative accuracy state or double-apply a tick. Both range and duel need the same implementation.

Integrate and test the following before calling the correction shipped:

1. Replay the captured taps, six-shot spray, long M4A4 spray, two boundary shots, scoped transitions, reloads and landings through the actual range/duel engines. Compare pre-shot index/inaccuracy as well as post-tick snapshots. Preserve the already verified scheduled aim-punch results.
2. Cover arbitrary render deltas and 128 Hz movement subdivisions, nonzero clock phases, delayed held-shot processing, long frames and guides/prediction without duplicate accuracy updates.
3. Keep unsupported order branches explicitly scoped: Glock/FAMAS burst subshots, R8 primary/secondary, Negev early shots, shotgun shell reload/cancel, suppressor transitions, holster/re-equip, and fire coinciding with stance/landing/reload changes lack appropriate native command/state captures here. Only two exact-boundary AK shots are available.
4. When REA recovery completes, inspect the native accuracy caller order and reload paths; do not treat the per-invocation grid as evidence for the unexecuted frame scheduler. The current evidence is sufficient for the common captured paths, while these special branches need separate validation.

Reproduce from `cs2spraylab/`:

```sh
python3 tools/reaudit-accuracy-native.py
python3 tools/reaudit-accuracy-demos.py
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 node tools/reaudit-accuracy.mjs
```

The Node bench fails on native grid drift, accepted one-step errors outside the stated landing interval, invalid reconstructed shot deadlines, cumulative index error above 1e-6, or cumulative penalty error above 1e-5. The latest expanded run passed. No browser, CS2 launch, bridge query, production-source edit, commit or push was performed by this follow-up.
