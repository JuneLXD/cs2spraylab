# Accuracy and recoil-index replay, 2026-10-09

Accuracy and floating recoil-index recovery now use the recorded 64 Hz phase in both production engines. Continuous aim-punch sampling retains its separately verified scheduled anchors. Mode changes preserve accumulated penalty, the index gate retains the primary cycle, and magazine reloads apply the native increment/reset. Special-state boundaries below remain explicitly limited.

Reproduction tools are `tools/reaudit-accuracy-native.py`, `tools/reaudit-accuracy-demos.py`, `tools/reaudit-accuracy-production.mjs`, and `tools/reaudit-accuracy-fixture.py`. The original candidate/before bench is `tools/reaudit-accuracy.mjs`; its retained historical results predate this implementation and must not be relabeled as a new before run. The portable summary is `docs/evidence/reaudit-accuracy-summary.json`. Full inputs and per-tick results are retained under `../native-audit/reports/reaudit-accuracy-{native,demos,results,summary}.json`.

## Evidence and coverage

The bounded instruction probe verifies the installed server SHA-256 `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a` before execution. It executes the native accuracy-update and recovery-time bodies in private Unicorn memory. Owner/ground/time queries are supplied, notification setters do nothing, and host float math supplies log/exp imports. Unexpected execution outside the allowed bodies and callbacks fails the probe. This validates each invocation's arithmetic; it does not execute the entire engine frame.

Saved current-hash decompiles are `reaudit-combat-accuracy-update.c` and `reaudit-combat-accuracy-recovery.c` under `../native-audit/rea/out/`. The replay independently reads the fresh exported `reaudit-combat/weapons.vdata`. Original demo bytes are hashed before parsing. The fresh recovery/shooting captures are from the current session; older retained demos remain separately identified and are corroborating runtime evidence, without a retrospective assertion that their headers bind them to this ELF hash.

The native grid contains **39,648 cases**, with **zero penalty or index error**. It covers 35 supplied weapon parameter sets, both supplied modes, standing/crouching/airborne baselines, penalty below/equal/above baseline, index snap boundaries, recovery-transition integer boundaries, and times before/equal/after/late relative to the decay gate. These supplied trainer parameters were independently checked against the current vdata by the combat audit. Silenced trainer defaults select silenced parameters; this grid is not 70 native gameplay captures. Turning, ladder and stack-boost paths are outside the grid.

The initial accepted demo set contains **21 recordings / 40,408 consecutive ticks**: 39,338 standing, 664 crouching and 406 airborne rows. There are **152 shots**, **20 mode changes**, **19 reload starts**, **17 reload ends** and **12 landings**. The production replay below adds a second continuous AK recovery recording, reaching 22 recordings / 41,584 ticks / 160 shots. Actual decoded weapons are AK-47, M4A4, Desert Eagle, AWP, AUG and USP-S. AUG has scope-transition coverage but no recorded shot in the initial set. Weapon switches and missing/discontinuous player rows start a new cumulative segment; ordinary ticks, shots, modes, reloads and landings do not.

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
| Mode switch | Preserve accumulated penalty; the next native update applies its ordinary baseline/decay rule | 20 transitions; the previous immediate `setParameters` baseline rebasing differed |
| Reload with event | Accuracy/index update precedes the +1 index increment; scoped AWP reload uses its previous scoped mode for this update, then changes mode | 17 event-bearing starts; fresh manual reloads and retained scoped reload |
| State-only automatic reload | +1 index precedes the update in the discriminating M4A4 case | Two starts without a reload event; Deagle's index gate is not open, so its sample cannot distinguish the two orders |
| Reload end | Captured floating recoil index is zero at the end transition | 17 observed ends; unrelated cancellation/holster cases are not inferred |
| Landing | Add mode landing coefficient × prior raw fall-speed sample before the ground accuracy update | 12 landings; maximum point error 3.10e-6 is within a conservative ±1/64 u/s fall-speed interval |

The caller investigation below corroborates the event-bearing/state-only distinction for the common gun paths. It does not establish every override's per-shell, cancellation or holster ordering.

The landing replay uses the movement-service fall-velocity field, not the lagged `velocity_Z` convenience alias. The raw network speed has limited precision. Every landing lies inside the stated interval propagated through the landing coefficient; an exact native impact-speed claim is not necessary for these results.

## Before and candidate numbers

The “before” columns invoke the `cb47b69` pre-change `WeaponRecovery` class with two 1/128-second advances per native tick, captured shots/stances and current parameter switching. This is a numerical class replay with native events, not a full end-to-end input/simulation replay. It includes the existing absence of the native reload-start index increment. The candidate carries its own state through each uninterrupted segment, rather than reseeding from the native snapshot every tick.

| Recording / quantity | Previous class cumulative max error | Candidate / production cumulative max error |
|---|---:|---:|
| Fresh AK recovery: penalty | 0.0013072615 | 1.4901161e-8 |
| Fresh AK recovery: index | 1.0000000 | 5.5511151e-16 |
| Fresh AK shooting: penalty | 0.0014092454 | 5.9604645e-8 |
| Fresh AK shooting: index | 1.0004354 | 8.8817842e-16 |
| Retained M4A4 spray: penalty | 0.0014880967 | 4.9960036e-16 |
| Retained M4A4 spray: index | 1.0292111 | 8.8817842e-16 |
| Retained AWP scope transition: penalty | 0.0710047672 | 4.7531423e-16 |
| Fresh air/duck/landing: penalty | 0.0014181459 | 3.0994415e-6 |

For the fresh recovery capture, isolated one-step errors away from landing/mode/reload transitions reach 0.0007264839 penalty and 0.0600282336 index in the previous class. Fresh shooting reaches 0.0007264850 penalty and 0.1234005089 index. The candidate reproduces non-landing rows at decoded float precision. All accepted cumulative index errors are below 9e-16; the remaining cumulative penalty error is confined to the propagated landing-speed precision.

The expanded native invocation grid also exposes the previous class's partial-time index decay/snap difference: maximum index error 0.9019644368 over these supplied boundary inputs. This is a synthetic boundary result, not a measured per-shot gameplay error.

## Corrected artifact labels

Decoded weapon state, not the filename, determines coverage:

- `native_phase3_m4a1s_001.dem` contains M4A4, not M4A1-S.
- `native_audit_aug_scope_001.dem` contains USP-S, not AUG.
- `native_audit_awp_001.dem` contains USP-S and AK-47 around a knife interval, not AWP.
- `native_reload_deagle_empty_001.dem` contains M4A4, not Desert Eagle; `_002` contains Desert Eagle.

No silenced-rifle, AUG firing, or Deagle-empty coverage should be claimed from those mislabeled files. The summary records all decoded names, including null intervals.

## Native caller evidence

All caller Evidence IDs below belong to the current server hash above. Complete tool replies and pseudocode are retained under `../native-audit/rea/out/reaudit-accuracy-*`; the provisional file `movement-caller` is actually the **WeaponServices** postthink callback, identified through its RTTI vtable. Do not infer a movement-service owner from that filename.

| Native path | Saved artifact / Evidence ID | Observed order |
|---|---|---|
| Pawn command | `finish-pawn-caller`, `ev_0aeffd6bfa128383d042e0a525acd1c127809212079e062a942876736613aaca` | Movement/subtick work, PostThink, FinishTick |
| Pawn PostThink override | `pawn-postthink-override`, `ev_1d454496d0e7c97e39d996a9fe97c94955643d7dc43e4276a35ec32554471c82` | Calls base PostThink; the unrecognized virtual entry is independently resolved by current-ELF vtable and saved direct disassembly (`postthink-thunk.txt`) |
| Base PostThink | `postthink-0`, `ev_ca805b33d68a719517af05f4a6c29410d04c65dfc7df03569ca3ff66c8d21301` | Iterates component postthink callbacks |
| WeaponServices callback | `movement-caller`, `ev_f352e59e2348e6d5d1592d8eb5316084cccca50fa3d3b8168898008437bf9213` | Resolves active weapon and invokes its accuracy update outside the movement subtick loop |
| Pawn / weapon FinishTick | `pawn-finish-tick`, `ev_26ff7bca172642a986d3a56376eadf5d13aafaf103ea1a335eda16ec7af60caf`; `gun-frame-dispatcher`, `ev_848693e449f8eae60a63ce43af37c3904b3443e078e9077f5d88b32eec276609` | Calls gun frame dispatch after ordinary PostThink |
| Explicit reload | `reload-dispatch`, `ev_557318c2131d22dd666fadbf3fb13548ab9d0d14df39635e7fa947bf4290a5c4` | Calls Reload, then emits weapon_reload when successful |
| Automatic idle reload | `idle-auto-reload`, `ev_3984277cdc5e6eaea0d48afb7bad05ebfa33f077c6ca2a6956ad7cbfaaa99311` | Directly calls Reload without that event |
| Common gun Reload | `gun-reload`, `ev_c3a542710726a0d811307ae3bddd766d5a632120c233d280a2516b210134ccab` | Successful base reload clears scoped state and adds one floating recoil index |
| R8 secondary dispatch | `secondary-dispatch`, `ev_bd05ca6a203e211b39bba825f267f1b35813082c45929c3a426e3efd17104` | Sets alternate mode, invokes an additional full accuracy update, then GunFire |
| GunFire | `gun-fire`, `ev_cbaad7b48d33c3bc5c4af281d6ac98d0f5d542edbe79b5dca98a106e6b3316be` | Reads bullet inaccuracy/index before fire penalty and index increments |

The common caller chain corroborates ordinary update placement. Exact fractional-versus-boundary ordering still relies on the runtime snapshots: this investigation did not emulate the complete frame scheduler. Pending burst dispatch and primary-fire mode/unzoom paths are retained too, but no burst runtime capture has yet validated their complete sequence.

## Production integration and validation

`WeaponRecovery` now keeps a separate absolute accuracy clock and complete 64 Hz steps, with explicit pending-boundary handling. Range and duel defer the boundary update until fractional shot work has run, flush it before exact-boundary shots and explicit magazine reloads, and apply automatic reload increments before the pending update. Both read pre-shot accuracy/index before adding firing penalty. Landing additions and native arithmetic use float32 rounding. Mode changes preserve penalty, including scoped-to-unscoped transitions. Prediction clones this state and cannot advance authoritative recovery.

`tools/reaudit-accuracy-production.mjs` invokes the actual production class over the native grid and carries its state cumulatively through original recordings. Its portable result is `docs/evidence/reaudit-accuracy-production.json`; full samples remain in `../native-audit/reports/reaudit-accuracy-production.json`. Captured weapon/stance/shot/reload/landing events are exogenous inputs in this class replay, not reconstructed button input. The historical before file remains unchanged.

Current production results: **39,648 native invocations, zero penalty/index error; 22 accepted recordings / 41,584 ticks / 160 shots**. The new `native_reaudit_recovery_002.dem` has maximum cumulative penalty error **5.9604645e-8** and index error **5.5511151e-16**. The largest accepted penalty error remains the landing-speed precision bound **3.0994415e-6**. Both failed R8 selection attempts (`r8_001`, `r8_002`) decode as AK and are excluded from R8 coverage.

Portable tests replay 376 original snapshots without per-tick reseeding and 306 representative bounded native invocations. Both live engines independently reproduce the native six-shot fractional burst and the eight-shot burst containing two exact-boundary shots, followed by recovery. Three native reload-start boundaries cover explicit and automatic order in both engines. Subdivision tests preserve 64 Hz accuracy across 1, 2, 5 and 13 substeps and verify predictions do not mutate state. Existing scheduled aim-punch and guide regressions remain required.

Remaining boundaries: the full command scheduler is not emulated; there are only two exact-boundary AK examples. Glock/FAMAS burst subshots, Negev early-shot runtime behavior, shotgun shell reload/cancel, suppressor transitions, holster/re-equip and shots coinciding with landing/stance changes still lack appropriate native command/state captures. The trainer continues its existing inactive-weapon recovery behavior; the native caller here targets the active weapon. Arbitrary input/movement histories within a long caller step cannot be recovered from a single final stance. R8-specific follow-up is excluded at the user’s request; the newly proposed extra secondary-update hook and its integration test were removed. The saved native secondary-dispatch evidence remains research only. Previously shipped R8 behavior is unchanged apart from the shared ordinary accuracy arithmetic.

Reproduce from `cs2spraylab/`:

```sh
python3 tools/reaudit-accuracy-native.py
python3 tools/reaudit-accuracy-demos.py
python3 tools/reaudit-accuracy-fixture.py
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 node tools/reaudit-accuracy-production.mjs
systemd-run --user --scope --quiet -p MemoryMax=8G -p MemorySwapMax=0 npx vitest run src/range/native-accuracy.test.ts src/range/native-reaudit-recoil.test.ts
```

The production bench fails on native grid drift or accepted cumulative index error above 1e-6 / penalty error above 1e-5; per-landing uncertainty is separately retained in the original report. Browser and deployment validation are performed separately after source freeze.

Validation before the second reboot: the focused accuracy/recoil/changelog run passed 23 tests (including the now-removed R8-only case); the landing file passed all 66 cases. The full one-worker suite reported 2,196 passes and 9 failures: the obsolete landing expectation was subsequently corrected and passed, one known missing fallback model, six bot-routing timeouts, and a deathmatch CPU-budget overrun (4,273 ms versus 4,000 ms) under heavy host load. This is not a clean final full-suite result; final serial validation follows the combined source freeze.

After removing the R8-only additions, the general native arithmetic/production replay passed again unchanged, and the final focused accuracy/scheduled-recoil/changelog run passed **22/22**.

Final integration review also caught a lazy-initialization difference: the range could create recovery after changing mode, while Duel created it in the primary mode. Both now start from the same base state and preserve its accumulated penalty through mode changes. New AWP/AUG first-lookup tests and the existing engine-parity cases cover this correction.

Final combined validation after the accuracy and footstep fixes: TypeScript passes;
2,325 unit cases pass, with only the documented missing `public/models/ak47.json`
fallback failure. All five Chromium cases across input-timing, trigger-continuity
and view-punch pass. The browser run used one worker, memory/swap/CPU caps and a
repository freeze, with auto-deploy paused. Durable logs are
`../native-audit/reports/reaudit-followup-final-{typescript,unit,browser}.log`.
