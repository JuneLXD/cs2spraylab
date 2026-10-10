# Glock mode-switch and burst clocks — pass 38

The current Glock mode switch changes the secondary attack clock by 300 ms. It does not add a primary-fire lock. SprayLab previously used a shared lock, so a tap immediately after switching modes was dropped in both Range and Duel. Duel also accepted a mode switch between pending burst rounds and delayed those rounds. This correction is restricted to Glock action timing and input dispatch.

## Current native evidence

The server artifact SHA-256 is `c7741272b76f16e936d6224dc121105e8051e1bc4d834be016c35ee3c63cac5a`. The bounded [native proof](evidence/reaudit-glock-native.json) hashes the whole current server, reads selected current instructions, and binds six concrete `CWeaponGlock` virtual entries. It also checks the schema descriptors and constructors for the two defaults used here. Raw native locations and disassembly remain in the tool and local audit output.

The [data proof](evidence/reaudit-glock-data.json) pairs the freshly exported `scripts/weapons.vdata` with the current compiled VPK entry: CRC32 `b6efe34a`, 32,731 bytes, SHA-256 `5ca094238e180376646a5cd69250c091ae5a9d937a3446c188ee5117fb6da28b`. It retains the decoded text hash, exporter hash, package-directory hash, and parsed inheritance chain:

`weapon_glock → weapon_glock_prefab → secondary → weapon_base → statted_item_base`

Neither relevant field is overridden anywhere in that decoded resource. This absence is paired with the current native constructors: `LinkedCooldowns` defaults to false, and the pending continuation count defaults to two. The value is not inferred from absent text alone. Glock's exported normal cycle is 150 ms, burst interval 50 ms, and full burst cycle 500 ms.

The accepted native path establishes these rules:

- A mode switch flips the mode and writes secondary readiness at current command time plus 300 ms. With unlinked cooldowns, the secondary setter returns without mirroring that write to primary. The accepted secondary wrapper/thunk adds no primary lock.
- A shot calls both attack-clock setters in their incremental mode. The secondary setter starts with the existing secondary tick/fraction. The clock helper raises a stale clock when the attack context needs rebasing, while a future secondary deadline is retained. In the trainer's existing scheduled-seconds representation, the bounded ordinary loaded-Glock cases use `secondary = max(scheduledShot, previousSecondary) + selectedDuration`.
- The selected durations for a three-round burst are 50 ms, 50 ms, and `max(one 64 Hz tick, 500 ms − 2 × 50 ms)` = 400 ms. Native continuation decrements its pending count after firing; the trainer passes its corresponding count before decrementing.
- Due pending burst rounds run before shared input dispatch. An eligible primary input consumes the dispatch even when semiautomatic logic rejects another shot without a new press. Otherwise an eligible held secondary input is checked again on each processed command. When primary is released and secondary remains held, no extra simulation-step delay is required.

A recent mode switch makes the two clocks visibly different. Toggle and shoot at time zero: primary schedules the burst at 0, 50, and 100 ms, then becomes ready at 500 ms. Secondary begins at 300 ms and advances by 50, 50, and 400 ms, becoming ready at 800 ms. Resetting secondary to the primary deadline would erase that authored delay. The non-tick-aligned unit fixture also checks this relationship at 1.003 seconds.

## Actual trainer measurements

The portable [probe](../tools/reaudit-glock-trainer.mjs) bundles the actual Range and Duel simulations. It records exact input edges, processed shot times, Range callback timestamps (mislabeled `scheduledAt` in the original traces), mode changes, both clocks, source hashes, and bundle hashes. It uses no substitute firing model. The original Range input guard is reproduced for the frozen baseline; the patch uses the same Simulation method called by RangeEngine. Public mouse handlers are exercised separately by the Chromium fixture.

The final [before trace](evidence/reaudit-glock-trainer-before.json) comes from clean `bfebff89319f90d7451b1dbe4e6cb9f4c9b38b79`. The [after trace](evidence/reaudit-glock-trainer-after.json) comes from the isolated checkout based on that same commit. Both use an identical probe hash and 12 fixtures in both engines. The [comparison](evidence/reaudit-glock-trainer-comparison.json) checks those identities before accepting results. Its input manifest explicitly identifies the four Glock source edits and the two separately audited Deagle metadata JSON edits in that integrated checkout; no scenario reloads or plays audio.

All times below are seconds in the simulation, with the initial action at 1.0. Held actions are processed with at most 1/128-second steps; listed times are measured trainer processing times.

| Input | Before | After |
| --- | --- | --- |
| Toggle to burst, immediately tap primary | No shot in either engine | Both: 1.0, 1.0625, 1.109375 |
| Toggle to semiauto, immediately tap primary | No shot in either engine | Both: one shot at 1.0 |
| Toggle, then hold primary at 1.03125 | Both start at 1.3125 | Both start at 1.03125, 281.25 ms earlier |
| Secondary tap at 1.03125 during a released burst | Range: normal burst; Duel: 1.0, 1.34375, 1.390625 | Both: 1.0, 1.0625, 1.109375; mode unchanged |
| Hold secondary during that burst | Range never retries; Duel switches mid-burst | Both finish the burst and switch at 1.5 |
| Hold primary and secondary, release primary at 1.5 | Both switch at 1.0 despite primary priority | Both retain semiauto until the release at 1.5 |
| Early secondary tap after a semiautomatic shot | Both accept it during the shot cycle | Both drop the tap; a held input retries after readiness |
| Normal semiautomatic taps | 1.0, 1.15, 1.3 | Unchanged in both engines |
| Normal held/released burst | 1.0, 1.0625, 1.109375 | Unchanged in both engines |

All 12 after-case pairs match in processed shot times and mode-transition times. All six normal semiautomatic/burst controls retain their before behavior. The ordered primary-then-secondary probe is supplemented by a unit test that submits both inputs in a single Duel command.

## Implementation and validation

`WeaponActions` changes only Glock's mode-switch destination and post-shot secondary-clock update. Range and Duel pass the scheduled shot time and pending burst count. RangeEngine sends the secondary edge through Simulation; Simulation retries held Glock secondary after firing and on primary release. Duel checks Glock primary/pending-shot priority before admitting secondary, and retries held secondary. Other weapons retain their previous paths.

The focused [unit suite](../src/range/glock-timing.test.ts) passes 13 tests across the actual Range and Duel simulations: both switch directions, immediate taps, future secondary clocks, pending burst cadence, dropped secondary taps, held retries, semiautomatic cadence, primary priority, same-command primary release, and an atomic Duel primary/secondary command. The [Chromium fixture](../tests/glock-timing.spec.ts) passes through the real Range mouse handlers with a controlled simulation clock, checking the immediate first shot, remaining burst, and held secondary readiness. TypeScript passes; the combined suite has 2,509 distinct unit cases and all four targeted browser cases passing, with only the known missing fallback-model unit fixture remaining. [Counts, asset/fixture rechecks and log hashes](evidence/reaudit-common-pistol-validation.json) retain the full validation history. Delivery remains pending.

Reproduce the bounded native proof with explicit artifact paths:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% python3 tools/reaudit-glock-native.py --native-root <audit-root> --server <game>/csgo/bin/linuxsteamrt64/libserver.so --out <local-raw-output> --portable-report <new-native-proof.json>
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-glock-data.mjs --vpk <game>/csgo/pak01_dir.vpk --vdata <fresh-export>/scripts/weapons.vdata --exporter <Source2Viewer-CLI> --output <new-data-proof.json>
```

The data checker reads an already exported resource; first perform the selected Source2Viewer export recorded in its evidence. It does not launch the exporter itself. The trainer probe refuses to overwrite evidence:

```sh
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-glock-trainer.mjs --repo <clean-bfebff8-checkout> --output <new-before.json>
systemd-run --user --scope --quiet -p MemoryMax=512M -p MemorySwapMax=0 -p CPUQuota=100% node tools/reaudit-glock-trainer.mjs --repo <patched-checkout> --output <new-after.json>
python3 tools/reaudit-glock-compare.py --before <new-before.json> --after <new-after.json> --output <new-comparison.json>
systemd-run --user --scope --quiet -p MemoryMax=4G -p MemorySwapMax=0 -p CPUQuota=100% npx vitest run src/range/glock-timing.test.ts --maxWorkers=1
```

Run heavy commands serially with deploy inactive and sufficient host memory. The comparison's source allowlist intentionally describes this integrated Glock/Deagle checkout; a later combined patch requires a reviewed allowlist update, not a silently broadened comparison.

## Evidence boundary

This pass establishes current static native behavior and measures the actual trainer before and after. It adds no live CS2 capture or native execution/emulation. It does not establish the producer/reset lifetime of native transition masks, physical input latency, every float32 normalization boundary, or all upstream player/equip gates. The correction leaves those broader gates in place. Empty-magazine special states, excluded weapons, reload playback, recoil/spread, and first-person animation remain outside this Glock correction.

## Pass 39 timestamp-label correction

The retained pass-38 Range trace copied `onShot.at` into a field named
`scheduledAt`. That event reports the **processing** time; the scheduled time is
`Simulation.lastShotAt`. The original evidence remains unchanged; the exact old harness is retained as
`tools/reaudit-glock-trainer-pass38.mjs`, and the historical comparator verifies
that frozen source hash. All published
shot/mode comparisons used the separate processing-time `at` field, so their
numbers are unaffected. The probe now records `scheduledAt` from `lastShotAt`
and preserves the event time as `callbackAt`. The AWP pass independently checks
both clocks. Do not use the original mislabeled field to infer native schedule
parity.

The corrected probe was rerun: all 24 shot/event traces are unchanged; 25 Range
shots now have separately named clocks, including 12 delayed shots where schedule
and callback time differ. [Comparison](evidence/reaudit-glock-label-comparison.json)
and [new trace](evidence/reaudit-glock-corrected-labels.json) retain that check.
The historical comparator still passes all 12 engine pairs and six controls.
